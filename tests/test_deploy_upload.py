import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('deploy_upload',ROOT/'scripts/deploy_upload.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class DeployUploadTest(unittest.TestCase):
    def test_credentials_only_sent_to_private_script_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'server').mkdir();(root/'rent').mkdir()
            for name in ('Code.js','appsscript.json'):(root/'server'/name).write_bytes((ROOT/'server'/name).read_bytes())
            state=root/'state.json';requests=[]
            class Response:
                def __init__(self,data):self.data=data
                def __enter__(self):return io.BytesIO(json.dumps(self.data).encode())
                def __exit__(self,*args):pass
            def send(request,timeout):
                requests.append(request)
                self.assertTrue(request.full_url.startswith('https://script.googleapis.com/v1/'))
                path=request.full_url.split('/v1/')[1]
                if path=='projects':return Response({'scriptId':'test-project'})
                if path.endswith('/content'):return Response({})
                if path.endswith('/versions'):return Response({'versionNumber':1})
                if path.endswith('/deployments'):
                    return Response({'deploymentId':'test-deploy','entryPoints':[{'entryPointType':'WEB_APP','webApp':{'url':'https://script.google.com/macros/s/test/exec'}}]})
                self.fail('Unexpected request')
            with patch.object(m,'ROOT',root),patch.object(m,'STATE',state),patch.dict(os.environ,{'APPS_SCRIPT_ACCESS_TOKEN':'oauth-test','GITHUB_UPLOAD_TOKEN':'github-test'}),patch.object(m.urllib.request,'urlopen',side_effect=send),contextlib.redirect_stdout(io.StringIO()) as output:
                m.deploy()
            self.assertEqual(len(requests),4)
            content=json.loads(requests[1].data)
            self.assertIn('github-test',content['files'][0]['source'])
            self.assertNotIn('github-test',(root/'rent/upload-config.json').read_text())
            self.assertNotIn('github-test',state.read_text())
            self.assertNotIn('oauth-test',output.getvalue())
    def test_missing_bindings_do_not_make_requests(self):
        with patch.dict(os.environ,{},clear=True),patch.object(m.urllib.request,'urlopen') as request:
            with self.assertRaises(ValueError):m.deploy()
            request.assert_not_called()
