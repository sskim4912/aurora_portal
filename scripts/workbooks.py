"""Validate and publish the optional latest workbook without changing its bytes."""
import hashlib
import io
import json
import re
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

MAX_BYTES = 5 * 1024 * 1024
MAX_EXPANDED = 20 * 1024 * 1024

def validate_workbook(data, meta):
    if not isinstance(meta, dict):
        raise ValueError('Invalid workbook metadata')
    name = meta.get('filename', '')
    if not isinstance(name, str) or len(name) > 180 or not name.lower().endswith('.xlsx') or re.search(r'[/\\\x00-\x1f\x7f]', name):
        raise ValueError('Invalid workbook filename')
    if not data or len(data) > MAX_BYTES or type(meta.get('size')) is not int or meta['size'] != len(data):
        raise ValueError('Invalid workbook size')
    if meta.get('sha256') != hashlib.sha256(data).hexdigest():
        raise ValueError('Workbook checksum mismatch')
    from datetime import datetime
    try:
        date = datetime.fromisoformat(meta['registeredAt'].replace('Z', '+00:00'))
        if date.tzinfo is None:
            raise ValueError()
    except (KeyError, TypeError, ValueError, AttributeError):
        raise ValueError('Invalid workbook timestamp') from None
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            files = archive.infolist()
            names = [f.filename for f in files]
            if len(names) != len(set(names)) or any(f.flag_bits & 1 for f in files) or sum(f.file_size for f in files) > MAX_EXPANDED:
                raise ValueError('Invalid workbook archive')
            if any(n.lower().endswith('vbaproject.bin') for n in names):
                raise ValueError('Macro workbooks are unsupported')
            for name in ('[Content_Types].xml', 'xl/workbook.xml'):
                content = archive.read(name)
                if b'<!DOCTYPE' in content.upper() or b'<!ENTITY' in content.upper():
                    raise ValueError('Invalid workbook XML')
                ET.fromstring(content)
            if archive.testzip() is not None:
                raise ValueError('Corrupt workbook archive')
    except (zipfile.BadZipFile, KeyError, ET.ParseError, RuntimeError, NotImplementedError):
        raise ValueError('Invalid .xlsx workbook') from None
    return meta

def validate_optional_workbook(root):
    directory = Path(root) / 'rent/workbooks'
    if not directory.exists():
        return
    if directory.is_symlink():
        raise ValueError('Workbook symlinks are unsupported')
    paths = [directory / name for name in ('latest.xlsx', 'latest.json')]
    if any(p.is_symlink() or not p.is_file() for p in paths):
        raise ValueError('Workbook and metadata must be registered together')
    validate_workbook(paths[0].read_bytes(), json.loads(paths[1].read_text(encoding='utf-8')))
