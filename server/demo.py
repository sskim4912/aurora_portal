"""Local-only demo with synthetic CSV and temporary credentials; never production."""
import csv
import io
import json
from pathlib import Path
import secrets
import tempfile
from rent_api import HEADERS, ORDER, make_server, password_hash, validate

if __name__ == '__main__':
    directory = Path(tempfile.mkdtemp(prefix='aurora-rent-demo-'))
    password = secrets.token_urlsafe(24)
    auth_file = directory / 'admin.json'
    auth_file.write_text(json.dumps({'username': 'demo-admin', 'password': password}))
    auth_file.chmod(0o600)
    server = make_server(port=8000, database=str(directory / 'latest.sqlite3'),
                         admin_user='demo-admin', admin_hash=password_hash(password))
    text = io.StringIO(newline='')
    writer = csv.writer(text)
    writer.writerow(ORDER)
    writer.writerow(HEADERS)
    for number in range(1, 61):
        writer.writerow([str(number), '2026.11.01', '영수증', '주민번호', '00001', '2026.11.01',
                         '450,000', '단기 임차', '임차료', '숙소', f'가상 숙소 {number}',
                         '2026.11.01', '2026.11.30', '예금'])
    data = text.getvalue().encode('utf-8-sig')
    server.store.put(validate(data, '가상_시연.csv', '2026-11'), data)
    print(f'Temporary demo only. Private test credential file: {auth_file}', flush=True)
    server.serve_forever()
