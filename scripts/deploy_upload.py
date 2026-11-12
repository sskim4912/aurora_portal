"""Deploy the free private Apps Script relay; write only its public URL to Pages.

Credentials must be injected as environment variables, never command arguments.
APPS_SCRIPT_ACCESS_TOKEN: owner OAuth with script.projects and script.deployments.
GITHUB_UPLOAD_TOKEN: fine-grained token, this repo only, Contents read/write.
"""
import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
API = 'https://script.googleapis.com/v1'
STATE = Path('/workspace/.cloud-setup/aurora-upload-deployment.json')
PASSWORD_SHA256 = '8d129f703b9851ce74cbb41cb84db46fcb6098bea25563526bb700d4a03f8812'


def private_source(source, github_token):
    # This source is sent only to the owner's private Apps Script project.
    # It is never written to the public checkout or to deployment-state files.
    initial = json.dumps({'GITHUB_TOKEN': github_token, 'ADMIN_NAME': '김성석',
                          'ADMIN_PASSWORD_SHA256': PASSWORD_SHA256}, ensure_ascii=False)
    original = 'function properties() { return PropertiesService.getScriptProperties(); }'
    replacement = ('function properties() { const p = PropertiesService.getScriptProperties(); '
                   'if (!p.getProperty("GITHUB_TOKEN")) p.setProperties(' + initial + '); return p; }')
    if original not in source:
        raise ValueError('Relay template does not match')
    return source.replace(original, replacement, 1)


def deploy():
    oauth = os.environ.get('APPS_SCRIPT_ACCESS_TOKEN')
    github = os.environ.get('GITHUB_UPLOAD_TOKEN')
    missing = [name for name, value in [('APPS_SCRIPT_ACCESS_TOKEN', oauth), ('GITHUB_UPLOAD_TOKEN', github)] if not value]
    if missing:
        raise ValueError('Missing secure environment bindings: ' + ', '.join(missing))

    def api(path, method, data):
        request = urllib.request.Request(API + path, method=method,
            headers={'Authorization': 'Bearer ' + oauth, 'Content-Type': 'application/json'},
            data=json.dumps(data).encode())
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            # Remote response bodies may contain sensitive request information.
            raise ValueError('Apps Script API returned HTTP ' + str(error.code) + '. Check owner OAuth scopes and Apps Script API access.') from None
        except urllib.error.URLError:
            raise ValueError('Apps Script API connection failed; check allowed domains and OAuth access.') from None

    state = json.loads(STATE.read_text()) if STATE.exists() else {}
    project = state.get('projectId')
    if not project:
        project = api('/projects', 'POST', {'title': 'AURORA workbook upload relay'})['scriptId']
        STATE.parent.mkdir(parents=True, exist_ok=True)
        state['projectId'] = project
        STATE.write_text(json.dumps(state))
    if not re.fullmatch(r'[A-Za-z0-9_-]+', project):
        raise ValueError('Invalid Apps Script project ID')
    api('/projects/' + project + '/content', 'PUT', {'files': [
        {'name': 'Code', 'type': 'SERVER_JS', 'source': (ROOT/'server/Code.js').read_text() if state.get('initialized') else private_source((ROOT/'server/Code.js').read_text(), github)},
        {'name': 'appsscript', 'type': 'JSON', 'source': (ROOT/'server/appsscript.json').read_text()}
    ]})
    version = api('/projects/' + project + '/versions', 'POST', {'description': 'Workbook upload relay'})['versionNumber']
    config = {'versionNumber': version, 'manifestFileName': 'appsscript', 'description': 'AURORA workbook upload'}
    deployment_id = state.get('deploymentId')
    if deployment_id:
        result = api('/projects/' + project + '/deployments/' + deployment_id, 'PUT', {'deploymentConfig': config})
    else:
        result = api('/projects/' + project + '/deployments', 'POST', config)
    state['deploymentId'] = result['deploymentId']
    STATE.write_text(json.dumps(state))
    urls = [entry['webApp']['url'] for entry in result.get('entryPoints', []) if entry.get('entryPointType') == 'WEB_APP']
    if len(urls) != 1 or not re.fullmatch(r'https://script\.google\.com/macros/s/[A-Za-z0-9_-]+/exec', urls[0]):
        raise ValueError('Public web app endpoint was not returned; verify owner deployment permission')
    (ROOT/'rent/upload-config.json').write_text(json.dumps({'endpoint': urls[0]}) + '\n')
    print('Private upload relay deployed; public endpoint configured. Live authentication/upload still needs validation before Pages publication.')


if __name__ == '__main__':
    try:
        deploy()
    except (ValueError, OSError, KeyError):
        # No traceback or arbitrary response text, credentials remain private.
        if not os.environ.get('APPS_SCRIPT_ACCESS_TOKEN') or not os.environ.get('GITHUB_UPLOAD_TOKEN'):
            sys.exit('Deployment blocked: securely configure APPS_SCRIPT_ACCESS_TOKEN and GITHUB_UPLOAD_TOKEN. Do not send credentials in chat.')
        sys.exit('Deployment failed. Check owner OAuth scopes, Apps Script API access, and network access to script.googleapis.com. No credentials were logged.')
