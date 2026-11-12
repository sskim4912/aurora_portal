import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location('workbooks', Path(__file__).resolve().parents[1] / 'scripts/workbooks.py')
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def sample():
    output = io.BytesIO()
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('[Content_Types].xml', '<Types/>')
        z.writestr('xl/workbook.xml', '<workbook/>')
    data = output.getvalue()
    return data, dict(filename='숙소 최신.xlsx', size=len(data), sha256=hashlib.sha256(data).hexdigest(), registeredAt='2026-11-13T00:00:00Z')

class WorkbooksTest(unittest.TestCase):
    def test_valid_original_and_korean_name(self):
        data, meta = sample()
        self.assertEqual(m.validate_workbook(data, meta), meta)
    def test_hash_size_and_name_must_match(self):
        data, meta = sample()
        for change in ({'sha256':'0'*64}, {'size':0}, {'filename':'../latest.xlsx'}, {'filename':'x.xlsm'}, {'registeredAt':'bad'}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                m.validate_workbook(data, {**meta, **change})
    def test_fake_xlsx_rejected(self):
        data=b'PKnot-an-excel'; _,meta=sample()
        meta.update(size=len(data), sha256=hashlib.sha256(data).hexdigest())
        with self.assertRaises(ValueError): m.validate_workbook(data,meta)
    def test_missing_pair_rejected_and_absence_supported(self):
        with tempfile.TemporaryDirectory() as tmp:
            m.validate_optional_workbook(tmp)
            p=Path(tmp)/'rent/workbooks';p.mkdir(parents=True)
            (p/'latest.xlsx').write_bytes(sample()[0])
            with self.assertRaises(ValueError):m.validate_optional_workbook(tmp)
    def test_pair_and_tampering(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)/'rent/workbooks';p.mkdir(parents=True)
            data,meta=sample();(p/'latest.xlsx').write_bytes(data);(p/'latest.json').write_text(json.dumps(meta))
            m.validate_optional_workbook(tmp)
            (p/'latest.xlsx').write_bytes(b'changed')
            with self.assertRaises(ValueError):m.validate_optional_workbook(tmp)

if __name__=='__main__':unittest.main()
