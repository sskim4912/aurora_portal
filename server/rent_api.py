"""Shared CSV API; run behind HTTPS. No third-party dependencies."""
import csv
import hashlib
import hmac
import io
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote, unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]
MAX = 25 * 1024 * 1024
HEADERS = '순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형'.split(',')
ORDER = '반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28'.split(',')

def password_hash(password, salt=None):
    salt = salt or secrets.token_hex(16)
    return salt + ':' + hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1).hex()

def validate(data, filename, month):
    if not data or len(data) > MAX:
        raise ValueError('파일은 1개, 최대 25MB입니다.')
    if not filename.lower().endswith('.csv') or len(filename) > 240 or any(c in filename for c in '/\\\r\n\x00'):
        raise ValueError('올바른 CSV 파일명을 사용해 주세요.')
    if not re.fullmatch(r'\d{4}-(0[1-9]|1[0-2])', month):
        raise ValueError('대상 월을 선택해 주세요.')
    for encoding in ('utf-8-sig', 'cp949'):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError('UTF-8 또는 CP949/EUC-KR 파일이 필요합니다.')
    if re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text):
        raise ValueError('지원하지 않는 제어 문자가 있습니다.')
    state = 'start'
    for char in text:
        if state == 'quoted':
            if char == '"': state = 'closed'
        elif state == 'closed':
            if char == '"': state = 'quoted'
            elif char in ',\r\n': state = 'start'
            else: raise ValueError('잘못된 큰따옴표 형식입니다.')
        elif char == '"':
            if state != 'start': raise ValueError('잘못된 큰따옴표 형식입니다.')
            state = 'quoted'
        elif char in ',\r\n': state = 'start'
        else: state = 'plain'
    if state == 'quoted': raise ValueError('닫히지 않은 큰따옴표입니다.')
    try:
        reader = csv.reader(io.StringIO(text, newline=''), strict=True)
        if next(reader, None) != ORDER or next(reader, None) != HEADERS:
            raise ValueError('지정된 14개 열의 2줄 헤더가 필요합니다.')
        count = 0
        numbers = set()
        for row in reader:
            if len(row) != 14 or not any(v.strip() for v in row):
                raise ValueError('데이터 행은 14개 열이어야 합니다.')
            if not re.fullmatch(r'[1-9]\d*', row[0]) or int(row[0]) in numbers:
                raise ValueError('순번은 중복 없는 양의 정수여야 합니다.')
            numbers.add(int(row[0]))
            count += 1
        if not count:
            raise ValueError('데이터가 한 건 이상 필요합니다.')
    except csv.Error:
        raise ValueError('CSV 큰따옴표 형식이 올바르지 않습니다.') from None
    return {'filename': filename, 'month': month, 'count': count, 'size': len(data), 'encoding': encoding,
            'sha256': hashlib.sha256(data).hexdigest()}

class Store:
    def __init__(self, path):
        self.path = path
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute('CREATE TABLE IF NOT EXISTS latest (id INTEGER PRIMARY KEY CHECK(id=1), metadata TEXT NOT NULL, data BLOB NOT NULL)')
    def connect(self):
        return sqlite3.connect(self.path, timeout=20)
    def put(self, metadata, data):
        metadata = dict(metadata, registeredAt=time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), version=secrets.token_hex(16))
        with self.connect() as db:
            db.execute('INSERT OR REPLACE INTO latest VALUES (1, ?, ?)', (json.dumps(metadata), data))
        return metadata
    def get(self):
        with self.connect() as db:
            row = db.execute('SELECT metadata,data FROM latest WHERE id=1').fetchone()
        return (json.loads(row[0]), row[1]) if row else None

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)
    def setup(self):
        super().setup()
        self.connection.settimeout(30)
    def log_message(self, *args):
        pass  # Never log file contents, credentials, tokens or request headers.
    def end_headers(self):
        self.send_header('X-Content-Type-Options', 'nosniff')
        if self.path.startswith('/api/'):
            self.send_header('Cache-Control', 'no-store')
            origin = self.headers.get('Origin')
            if origin in self.server.origins:
                self.send_header('Access-Control-Allow-Origin', origin)
                self.send_header('Vary', 'Origin')
        super().end_headers()
    def reply(self, code, body):
        payload = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)
    def allowed(self):
        origin = self.headers.get('Origin')
        return not origin or origin in self.server.origins
    def token(self):
        token = self.headers.get('Authorization', '').removeprefix('Bearer ')
        with self.server.lock:
            now = time.time()
            self.server.sessions = {k: v for k,v in self.server.sessions.items() if v > now}
            return token if token in self.server.sessions else None
    def do_OPTIONS(self):
        if not self.allowed():
            return self.reply(403, {'error': '허용되지 않은 출처입니다.'})
        self.send_response(204)
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-Filename, X-Target-Month')
        self.end_headers()
    def do_HEAD(self):
        return self.reply(405, {'error': 'Method not allowed'})
    def list_directory(self, path):
        return self.reply(404, {'error': 'Not found'})
    def do_GET(self):
        path = urlparse(self.path).path
        if path in ('/api/latest', '/api/download'):
            latest = self.server.store.get()
            if not latest:
                return self.reply(404, {'error': '등록된 공용 CSV가 없습니다.'})
            meta, data = latest
            version = urlparse(self.path).query
            if path == '/api/latest':
                return self.reply(200, meta)
            if version and version != 'v=' + meta['version']:
                return self.reply(409, {'error': '최신 파일이 변경됐습니다. 새로고침해 주세요.'})
            self.send_response(200)
            self.send_header('Content-Type', 'text/csv')
            self.send_header('Content-Disposition', "attachment; filename*=UTF-8''" + quote(meta['filename']))
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        if path == '/api/session':
            return self.reply(200, {'admin': bool(self.token())})
        # Expose only the same public tree as Pages, never server/test/config files.
        if path != '/' and path != '/index.html' and not path.startswith(('/rent/', '/assets/')):
            return self.reply(404, {'error': 'Not found'})
        if any(p.startswith('.') for p in unquote(path).split('/') if p):
            return self.reply(404, {'error': 'Not found'})
        resolved = Path(self.translate_path(path)).resolve()
        if resolved != ROOT / 'index.html' and resolved != ROOT and not any(resolved.is_relative_to(ROOT / folder) for folder in ('rent', 'assets')):
            return self.reply(404, {'error': 'Not found'})
        return super().do_GET()
    def do_POST(self):
        if not self.allowed():
            return self.reply(403, {'error': '허용되지 않은 출처입니다.'})
        path = urlparse(self.path).path
        if path not in ('/api/login', '/api/logout', '/api/upload'):
            return self.reply(404, {'error': 'Not found'})
        if path != '/api/login' and not self.token():
            return self.reply(401, {'error': '관리자 인증이 필요합니다.'})
        try:
            size = int(self.headers.get('Content-Length', '-1'))
            if size < 0 or size > (4096 if path == '/api/login' else MAX):
                return self.reply(413, {'error': '파일 크기 제한을 확인해 주세요.'})
            if path == '/api/logout':
                active_token = self.token()
                with self.server.lock:
                    self.server.sessions.pop(active_token, None)
                return self.reply(200, {'ok': True})
            if path == '/api/login':
                key = self.client_address[0]
                with self.server.lock:
                    attempts = [t for t in self.server.attempts.get(key, []) if t > time.time()-300]
                    if len(attempts) >= 10:
                        return self.reply(429, {'error': '잠시 후 다시 시도해 주세요.'})
                    self.server.attempts[key] = attempts + [time.time()]
                credentials = json.loads(self.rfile.read(size))
                if not isinstance(credentials, dict):
                    return self.reply(400, {'error': '인증 요청 형식을 확인해 주세요.'})
                configured = self.server.admin_hash
                valid = configured and hmac.compare_digest(str(credentials.get('username', '')), self.server.admin_user)
                candidate = password_hash(str(credentials.get('password', '')), configured.split(':')[0]) if configured else ''
                if not valid or not hmac.compare_digest(candidate, configured):
                    return self.reply(401, {'error': '관리자 인증에 실패했습니다.'})
                token = secrets.token_urlsafe(32)
                with self.server.lock:
                    self.server.sessions[token] = time.time() + 1800
                return self.reply(200, {'token': token})
            data = self.rfile.read(size)
            if len(data) != size:
                raise ValueError('파일 전송이 완료되지 않았습니다.')
            meta = validate(data, unquote(self.headers.get('X-Filename','')), self.headers.get('X-Target-Month',''))
            return self.reply(200, self.server.store.put(meta, data))
        except (ValueError, TypeError, KeyError):
            return self.reply(400, {'error': '파일 형식, 헤더, 순번, 대상 월을 확인해 주세요.'})
        except (sqlite3.Error, OSError):
            return self.reply(503, {'error': '저장하지 못했습니다. 기존 파일은 유지됩니다.'})

def make_server(host='127.0.0.1', port=8000, database=None, admin_user=None, admin_hash=None, origins=None):
    server = ThreadingHTTPServer((host, port), Handler)
    server.store = Store(database or os.environ.get('RENT_DATABASE', '/workspace/rent-data/latest.sqlite3'))
    server.admin_user = admin_user or os.environ.get('RENT_ADMIN_USER', '')
    server.admin_hash = admin_hash or os.environ.get('RENT_ADMIN_PASSWORD_HASH', '')
    server.origins = origins or set(filter(None, os.environ.get('RENT_ALLOWED_ORIGINS', f'http://{host}:{server.server_port}').split(',')))
    server.sessions, server.attempts, server.lock = {}, {}, threading.RLock()
    return server

if __name__ == '__main__':
    if '--hash-password' in __import__('sys').argv:
        import getpass
        print(password_hash(getpass.getpass('Admin password: ')))
    else:
        make_server(port=int(os.environ.get('PORT', '8000'))).serve_forever()
