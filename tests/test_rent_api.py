import concurrent.futures
import hashlib
import http.client
import importlib.util
import json
from pathlib import Path
import tempfile
import threading
import unittest
from unittest.mock import patch
import sqlite3

spec=importlib.util.spec_from_file_location('rent_api',Path(__file__).resolve().parents[1]/'server/rent_api.py')
api=importlib.util.module_from_spec(spec);spec.loader.exec_module(api)
def fixture(encoding='utf-8-sig', number='1'):
    import csv, io
    out=io.StringIO(newline='');w=csv.writer(out)
    w.writerow(api.ORDER);w.writerow(api.HEADERS)
    w.writerow([number,'2026.11.01','영수증','주민번호','00001','2026.11.01','450,000','단기 임차','임차료','숙소','가상 "숙소",\n<script>alert(1)</script>','2026.11.01','2026.11.30','예금'])
    return out.getvalue().encode(encoding)
class ApiTest(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.password='fixture-only-'+__import__('secrets').token_hex(12)
        self.server=api.make_server(port=0,database=self.tmp.name+'/db.sqlite',admin_user='demo-admin',admin_hash=api.password_hash(self.password))
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.addCleanup(self.server.server_close);self.addCleanup(self.server.shutdown)
    def request(self,path,body=None,headers=None,method=None):
        c=http.client.HTTPConnection('127.0.0.1',self.server.server_port)
        c.request(method or ('POST' if body is not None else 'GET'),path,body=body,headers=headers or {})
        r=c.getresponse();result=(r.status,r.read(),dict(r.getheaders()));c.close();return result
    def login(self):
        status,data,_=self.request('/api/login',json.dumps({'username':'demo-admin','password':self.password}))
        self.assertEqual(status,200);return json.loads(data)['token']
    def upload(self,data,token,filename='가상.csv'):
        from urllib.parse import quote
        return self.request('/api/upload',data,{'Authorization':'Bearer '+token,'X-Filename':quote(filename),'X-Target-Month':'2026-11'})
    def test_auth_replace_bytes_shared_and_logout(self):
        self.assertEqual(self.upload(fixture(),'forged')[0],401)
        self.assertEqual(self.request('/api/login',json.dumps({'username':'demo-admin','password':'incorrect'}))[0],401)
        token=self.login()
        for encoding in ('utf-8','utf-8-sig','cp949','euc-kr'):
            data=fixture(encoding);status,meta,_=self.upload(data,token);self.assertEqual(status,200)
            for _ in range(2):
                code,download,headers=self.request('/api/download');self.assertEqual(code,200);self.assertEqual(download,data)
                self.assertIn('filename*=',headers['Content-Disposition'])
            self.assertEqual(json.loads(meta)['count'],1)
        self.assertEqual(self.request('/api/logout',b'',{'Authorization':'Bearer '+token})[0],200)
        self.assertEqual(self.upload(fixture(),token)[0],401)
    def test_failed_validation_and_storage_preserve_previous(self):
        token=self.login();original=fixture();self.upload(original,token)
        for invalid in (b'bad',original+b'"unclosed',original+original, original.replace(b'00001', b'ab"cd')):
            self.assertEqual(self.upload(invalid,token)[0],400)
            self.assertEqual(self.request('/api/download')[1],original)
        with patch.object(self.server.store,'put',side_effect=sqlite3.OperationalError('fixture')):
            self.assertEqual(self.upload(fixture(number='2'),token)[0],503)
        self.assertEqual(self.request('/api/download')[1],original)
        with self.assertRaises(ValueError):api.validate(b'x'*(api.MAX+1),'x.csv','2026-11')
    def test_origin_expiry_and_static_boundary(self):
        token=self.login();self.server.sessions[token]=0
        self.assertEqual(self.upload(fixture(),token)[0],401)
        self.assertEqual(self.request('/api/login',b'{}',{'Origin':'https://evil.invalid'})[0],403)
        for path in ('/server/rent_api.py','/.git/config','/rent/../server/rent_api.py','/rent/%2e%2e/server/rent_api.py'):
            self.assertEqual(self.request(path)[0],404)
    def test_persistence_and_version(self):
        token=self.login();self.upload(fixture(),token)
        meta=json.loads(self.request('/api/latest')[1]);self.upload(fixture(number='2'),token)
        self.assertEqual(self.request('/api/download?v='+meta['version'])[0],409)
        self.assertEqual(api.Store(self.server.store.path).get()[1],fixture(number='2'))
if __name__=='__main__':unittest.main()
