"""Select an authenticated CSV upload and verify its committed original bytes."""
import hashlib
import json
import re
from pathlib import Path
from datetime import datetime

def select_upload(root, git, validate):
    directory = root / 'rent/uploads'
    if not directory.exists(): return None
    paths = [directory / n for n in ('latest.csv', 'latest.json')]
    if directory.is_symlink() or any(p.is_symlink() or not p.is_file() for p in paths):
        raise ValueError('CSV와 등록 정보를 함께 저장해야 합니다.')
    meta = json.loads(paths[1].read_text(encoding='utf-8'))
    name = meta.get('filename', '')
    if not isinstance(name,str) or len(name)>180 or not name.lower().endswith('.csv') or re.search(r'[/\\\x00-\x1f\x7f]',name):
        raise ValueError('CSV 파일명을 확인해 주세요.')
    if not re.fullmatch(r'20\d{2}-(0[1-9]|1[0-2])',meta.get('month','')):
        raise ValueError('CSV 대상 월을 확인해 주세요.')
    date=datetime.fromisoformat(meta['registeredAt'].replace('Z','+00:00'))
    if date.tzinfo is None: raise ValueError('등록 시각을 확인해 주세요.')
    commit=git(root,'log','-1','--format=%H','--','rent/uploads').decode().strip()
    if not commit: raise ValueError('CSV 등록 커밋이 없습니다.')
    for path in paths:
        if git(root,'show',f'{commit}:{path.relative_to(root).as_posix()}') != path.read_bytes():
            raise ValueError('커밋되지 않은 CSV 변경은 반영하지 않습니다.')
    data=paths[0].read_bytes()
    if not data or len(data)>5*1024*1024: raise ValueError('업로드 CSV는 최대 5MiB입니다.')
    checked=validate(data,'upload_'+meta['month'].replace('-','')+'.csv')
    if meta.get('sha256')!=hashlib.sha256(data).hexdigest() or meta.get('size')!=len(data) or meta.get('count')!=checked['count']:
        raise ValueError('CSV 원본과 등록 정보가 일치하지 않습니다.')
    checked.update(filename=name,registeredAt=meta['registeredAt'],version=commit,href='downloads/'+name)
    return paths[0],checked
