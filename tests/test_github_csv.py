import csv
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
spec=importlib.util.spec_from_file_location('prepare_rent',Path(__file__).resolve().parents[1]/'scripts/prepare_rent.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

def sample(encoding='utf-8-sig'):
    out=io.StringIO(newline='');writer=csv.writer(out);writer.writerow(module.ORDER);writer.writerow(module.HEADERS)
    for n in range(1,4):
        writer.writerow([str(n),'2026.11.01','영수증','주민번호','00001','2026.11.01','450,000','단기 임차','임차료','숙소','가상 "숙소",\r\n<script>alert(1)</script>','2026.11.01','2026.11.30','예금'])
    return out.getvalue().encode(encoding)

class GitHubCsvTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)/'repo';self.root.mkdir();self.output=Path(self.temp.name)/'site'
        self.run_git('init','-q');self.run_git('config','user.name','Fixture');self.run_git('config','user.email','fixture@example.invalid')
        (self.root/'rent/downloads').mkdir(parents=True);(self.root/'assets').mkdir();(self.root/'assets/fake.txt').write_text('synthetic')
        (self.root/'index.html').write_text('<a href="rent/" target="_blank">rent</a>')
        (self.root/'rent/index.html').write_text('<div class="card-detail file-info" id="latest-info">old</div><a id="csv-download" href="downloads/old.csv" download="old.csv">download</a><span class="guide-filename">old.csv</span>')
        self.name='가상_20261101_1.csv';(self.root/'rent/downloads'/self.name).write_bytes(sample());self.commit()
    def run_git(self,*args):
        return subprocess.check_output(['git','-C',str(self.root),*args],stderr=subprocess.DEVNULL)
    def commit(self):
        self.run_git('add','.');self.run_git('commit','--allow-empty','-qm','synthetic fixture')
    def test_initial_and_shared_byte_preserving_replacement(self):
        for encoding in ('utf-8','utf-8-sig','cp949','euc-kr'):
            name='가상_20261201_1.csv';data=sample(encoding)
            (self.root/'rent/downloads'/name).write_bytes(data);self.commit()
            meta=module.prepare(self.output,self.root)
            self.assertEqual(meta['filename'],name);self.assertEqual(meta['count'],3);self.assertEqual(meta['month'],'2026-12')
            self.assertEqual((self.output/'rent/downloads'/name).read_bytes(),data)
            self.assertEqual(json.loads((self.output/'rent/latest.json').read_text())['sha256'],meta['sha256'])
            self.assertNotIn('old.csv',(self.output/'rent/index.html').read_text())
            self.assertEqual(len(list((self.output/'rent/downloads').glob('*.csv'))),1)
    def test_invalid_and_multiple_uploads_leave_previous_output(self):
        module.prepare(self.output,self.root);previous=(self.output/'rent/latest.json').read_bytes()
        path=self.root/'rent/downloads/가상_20261201_1.csv';path.write_bytes(b'bad');self.commit()
        with self.assertRaises(ValueError):module.prepare(self.output,self.root)
        self.assertEqual((self.output/'rent/latest.json').read_bytes(),previous)
        path.write_bytes(sample());(self.root/'rent/downloads/가상_20260101_2.csv').write_bytes(sample());self.commit()
        with self.assertRaises(ValueError):module.prepare(self.output,self.root)
        self.assertEqual((self.output/'rent/latest.json').read_bytes(),previous)
    def test_uncommitted_change_deletion_and_symlink_rejected(self):
        path=self.root/'rent/downloads'/self.name
        path.write_bytes(b'not committed')
        with self.assertRaises(ValueError):module.select_latest(self.root)
        path.unlink();self.commit()
        with self.assertRaises(ValueError):module.select_latest(self.root)
    def test_malformed_quotes_duplicates_headers_size_and_month_rejected(self):
        data=sample()
        for content in (b'bad',data+b'"unclosed',data.replace(b'00001',b'ab"cd'),data+data):
            with self.assertRaises(ValueError):module.validate(content,self.name)
        with self.assertRaises(ValueError):module.validate(data,'no-month.csv')
        with self.assertRaises(ValueError):module.validate(b'x'*(module.MAX_BYTES+1),self.name)

if __name__=='__main__':unittest.main()
