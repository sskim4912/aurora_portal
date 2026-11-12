import shutil
import subprocess
import unittest
from pathlib import Path

class UploadServerTest(unittest.TestCase):
    def test_server_authentication_and_atomic_upload(self):
        if not shutil.which('node'):
            self.skipTest('Node.js is needed for the Apps Script relay tests')
        subprocess.run(['node', 'tests/upload-server.cjs'], cwd=Path(__file__).resolve().parents[1], check=True)
