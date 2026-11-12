"""Validate the latest GitHub CSV upload and prepare a byte-preserving Pages tree."""
import argparse
import csv
from datetime import datetime
import hashlib
import html
from urllib.parse import quote
import io
import json
from pathlib import Path
import re
import shutil
import subprocess

# Work both as a CLI and when loaded by the existing tests.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from workbooks import validate_optional_workbook

ROOT = Path(__file__).resolve().parents[1]
MAX_BYTES = 25 * 1024 * 1024
ORDER = '반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28'.split(',')
HEADERS = '순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형'.split(',')


def validate(data, filename):
    if not data or len(data) > MAX_BYTES:
        raise ValueError('CSV 파일은 1개, 최대 25MiB여야 합니다.')
    if not filename.lower().endswith('.csv') or any(c in filename for c in '/\\\r\n\x00'):
        raise ValueError('CSV 파일명을 확인해 주세요.')
    match = re.search(r'(?<!\d)(20\d{2})[-_.]?(0[1-9]|1[0-2])(?:[0-3]\d)?(?!\d)', filename)
    if not match:
        raise ValueError('파일명에 대상 연월(예: 202611)을 포함해 주세요.')
    for encoding in ('utf-8-sig', 'cp949'):
        try:
            text = data.decode(encoding)
            break
        except UnicodeDecodeError:
            continue
    else:
        raise ValueError('UTF-8 또는 CP949/EUC-KR CSV가 필요합니다.')
    if re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]', text):
        raise ValueError('지원하지 않는 제어 문자가 있습니다.')
    state = 'start'
    for char in text:
        if state == 'quoted':
            if char == '"': state = 'closed'
        elif state == 'closed':
            if char == '"': state = 'quoted'
            elif char in ',\r\n': state = 'start'
            else: raise ValueError('CSV 인용부호 형식을 확인해 주세요.')
        elif char == '"':
            if state != 'start': raise ValueError('CSV 인용부호 형식을 확인해 주세요.')
            state = 'quoted'
        elif char in ',\r\n': state = 'start'
        else: state = 'plain'
    if state == 'quoted': raise ValueError('닫히지 않은 인용부호가 있습니다.')
    try:
        reader = csv.reader(io.StringIO(text, newline=''), strict=True)
        if next(reader, None) != ORDER or next(reader, None) != HEADERS:
            raise ValueError('지정된 14열의 2줄 헤더가 필요합니다.')
        count, numbers = 0, set()
        for row in reader:
            if len(row) != 14:
                raise ValueError('데이터 행은 14개 열이어야 합니다.')
            if not re.fullmatch('[1-9][0-9]*', row[0]) or row[0] in numbers:
                raise ValueError('순번은 중복 없는 양의 정수여야 합니다.')
            numbers.add(row[0])
            count += 1
        if not count: raise ValueError('데이터가 한 건 이상 필요합니다.')
    except csv.Error:
        raise ValueError('CSV 인용부호 형식을 확인해 주세요.') from None
    return dict(filename=filename, month=f'{match[1]}-{match[2]}', count=count, size=len(data),
                encoding='UTF-8' if encoding == 'utf-8-sig' else 'CP949 / EUC-KR',
                sha256=hashlib.sha256(data).hexdigest())


def git(root, *args):
    return subprocess.check_output(['git', '-C', str(root), *args])


def select_latest(root=ROOT):
    commit = git(root, 'log', '--first-parent', '-1', '--format=%H', '--', 'rent/downloads').decode().strip()
    if not commit: raise ValueError('CSV 등록 기록이 없습니다.')
    parents = git(root, 'rev-list', '--parents', '-n', '1', commit).decode().split()
    if len(parents) > 1:
        names = git(root, 'diff', '--name-only', '-z', parents[1], commit, '--', 'rent/downloads')
    else:
        names = git(root, 'ls-tree', '-r', '--name-only', '-z', commit, '--', 'rent/downloads')
    changed = [p for p in names.decode().split('\0') if p.lower().endswith('.csv')]
    if len(changed) != 1:
        raise ValueError('한 번에 CSV 파일 한 개만 등록해 주세요. 삭제·여러 파일 등록은 반영하지 않습니다.')
    path = root / changed[0]
    if path.is_symlink() or not path.is_file() or path.parent != root / 'rent/downloads':
        raise ValueError('CSV 파일은 rent/downloads 바로 아래에 등록해 주세요.')
    # Never let a later unrelated commit silently publish an uncommitted replacement.
    expected = git(root, 'show', f'{commit}:{changed[0]}')
    if path.read_bytes() != expected:
        raise ValueError('커밋되지 않은 CSV 변경은 반영하지 않습니다.')
    registered = git(root, 'show', '-s', '--format=%cI', commit).decode().strip()
    return path, commit, registered


def prepare(output, root=ROOT):
    path, commit, registered = select_latest(root)
    data = path.read_bytes()
    metadata = validate(data, path.name)
    metadata.update(registeredAt=registered, version=commit, href='downloads/' + path.name)
    validate_optional_workbook(root)
    output = output.resolve()
    # Validate everything before touching an existing successful output.
    if output == root or output.is_relative_to(root / 'rent') or root.is_relative_to(output):
        raise ValueError('사이트 출력 경로를 확인해 주세요.')
    output.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(root / 'index.html', output / 'index.html')
    shutil.copytree(root / 'assets', output / 'assets', dirs_exist_ok=True)
    # Old uploads remain in Git history; publish only the selected, validated original.
    shutil.copytree(root / 'rent', output / 'rent', dirs_exist_ok=True, ignore=shutil.ignore_patterns('downloads', 'latest.json'))
    downloads = output / 'rent/downloads'
    if downloads.exists(): shutil.rmtree(downloads)
    downloads.mkdir(parents=True)
    shutil.copyfile(path, downloads / path.name)
    (output / 'rent/latest.json').write_text(json.dumps(metadata, ensure_ascii=False) + '\n', encoding='utf-8')
    # Bake the selected link into HTML too: downloads survive metadata/network failure.
    page = output / 'rent/index.html'
    source = page.read_text(encoding='utf-8')
    href = 'downloads/' + quote(path.name)
    source = re.sub(r'(id="csv-download" href=")[^"]*(" download=")[^"]*',
                    lambda m: m[1] + href + m[2] + html.escape(path.name, quote=True), source)
    source = re.sub(r'(<span class="guide-filename">).*?(</span>)',
                    lambda m: m[1] + html.escape(path.name) + m[2], source)
    info = (f"<strong>{html.escape(path.name)}</strong><p>대상 월 {metadata['month']} · "
            f"등록일 {html.escape(registered)}<br>데이터 {metadata['count']}건 · "
            f"{metadata['size']:,} B · {metadata['encoding']} 원본 유지</p>")
    source = re.sub(r'(<div class="card-detail file-info" id="latest-info">).*?(</div>)',
                    lambda m: m[1] + info + m[2], source)
    page.write_text(source, encoding='utf-8')
    (output / '.nojekyll').touch()
    assert hashlib.sha256((downloads / path.name).read_bytes()).hexdigest() == metadata['sha256']
    return metadata


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / '_site')
    args = parser.parse_args()
    try:
        metadata = prepare(args.output)
        print(f"CSV 검증 및 사이트 준비 완료: {metadata['count']}건, {metadata['size']} bytes. 원본 바이트 일치.")
    except (ValueError, OSError, subprocess.CalledProcessError):
        raise SystemExit('CSV 검증/사이트 준비 실패. 파일 한 개·25MiB·파일명 연월·2줄 헤더·14열·순번을 확인하세요. 운영 사이트는 교체하지 않습니다.')
