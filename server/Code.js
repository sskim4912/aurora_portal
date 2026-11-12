/** Free Apps Script relay. Secrets stay in Script Properties, never in Pages. */
const REPO = 'sskim4912/aurora_portal';
const BRANCH = 'main';
const FILE_PATH = 'rent/workbooks/latest.xlsx';
const META_PATH = 'rent/workbooks/latest.json';
const MAX_FILE = 5 * 1024 * 1024;
const SESSION_SECONDS = 21600;
function digest(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value)
    .map(b => ((b + 256) % 256).toString(16).padStart(2, '0')).join('');
}
function properties() { return PropertiesService.getScriptProperties(); }
function fail(message) { throw new Error(message); }
function configuration() {
  const p = properties();
  if (!p.getProperty('GITHUB_TOKEN') || !p.getProperty('ADMIN_PASSWORD_SHA256'))
    fail('업로드 연결 설정이 완료되지 않았습니다.');
  return p;
}
function github(path, method, body) {
  const response = UrlFetchApp.fetch('https://api.github.com/repos/' + REPO + path, {
    method: method || 'get', muteHttpExceptions: true,
    headers: {Authorization: 'Bearer ' + configuration().getProperty('GITHUB_TOKEN'),
      Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'},
    contentType: 'application/json', payload: body ? JSON.stringify(body) : undefined
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) fail(code === 409 || code === 422
    ? '다른 파일이 먼저 저장되었습니다. 최신 상태를 확인하고 다시 시도해 주세요.'
    : 'GitHub 저장 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  return JSON.parse(response.getContentText());
}
function authorize(session) {
  if (typeof session !== 'string' || !/^[a-f0-9]{64}$/.test(session) ||
      !CacheService.getScriptCache().get('session:' + digest(session)))
    fail('로그인이 만료되었습니다. 로그아웃 후 다시 접속해 주세요.');
}
function login(input) {
  const p = configuration();
  if (input.name !== (p.getProperty('ADMIN_NAME') || '김성석') ||
      typeof input.password !== 'string' || digest(input.password) !== p.getProperty('ADMIN_PASSWORD_SHA256'))
    fail('이름 또는 비밀번호가 올바르지 않습니다.');
  const session = digest(Utilities.getUuid() + Utilities.getUuid());
  CacheService.getScriptCache().put('session:' + digest(session), 'yes', SESSION_SECONDS);
  return {session, expiresAt: Date.now() + SESSION_SECONDS * 1000};
}
function workbook(input) {
  if (typeof input.filename !== 'string' || input.filename.length > 180 ||
      /[\/\\\x00-\x1f\x7f]/.test(input.filename) || !/\.xlsx$/i.test(input.filename))
    fail('엑셀 .xlsx 파일을 선택해 주세요.');
  if (typeof input.content !== 'string' || input.content.length > Math.ceil(MAX_FILE / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.content)) fail('엑셀 파일은 최대 5MiB입니다.');
  let bytes, parts;
  try {
    bytes = Utilities.base64Decode(input.content);
    if (!bytes.length || bytes.length > MAX_FILE) fail('size');
    parts = Utilities.unzip(Utilities.newBlob(bytes, 'application/zip', 'workbook.zip'));
  } catch (_) { fail('열 수 있는 .xlsx 엑셀 파일인지 확인해 주세요.'); }
  const names = parts.map(p => p.getName());
  if (!['[Content_Types].xml', 'xl/workbook.xml'].every(n => names.includes(n)) ||
      names.some(n => /(^|\/)vbaProject\.bin$/i.test(n)) ||
      parts.reduce((sum, p) => sum + p.getBytes().length, 0) > 20 * 1024 * 1024)
    fail('일반 .xlsx 파일만 지원하며 압축 해제 크기는 최대 20MiB입니다.');
  return bytes;
}
function upload(input) {
  authorize(input.session);
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId))
    fail('업로드 요청을 다시 시작해 주세요.');
  const bytes = workbook(input);
  const sha256 = digest(bytes);
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) fail('다른 파일을 저장 중입니다. 잠시 후 다시 시도해 주세요.');
  try {
    const p = properties();
    const previous = JSON.parse(p.getProperty('LAST_UPLOAD') || 'null');
    if (previous && previous.requestId === input.requestId) {
      if (previous.sha256 !== sha256 || previous.filename !== input.filename) fail('업로드 요청이 변경되었습니다.');
      return previous;
    }
    const ref = github('/git/ref/heads/' + BRANCH);
    const parent = github('/git/commits/' + ref.object.sha);
    // Check the committed metadata as well: response loss / property failure cannot duplicate a request.
    let committed;
    try { committed = github('/contents/' + META_PATH + '?ref=' + ref.object.sha); }
    catch (_) { committed = null; }
    if (committed && committed.content) {
      const meta = JSON.parse(Utilities.newBlob(Utilities.base64Decode(committed.content.replace(/\s/g, ''))).getDataAsString());
      if (meta.requestId === input.requestId) {
        if (meta.sha256 !== sha256 || meta.filename !== input.filename) fail('업로드 요청이 변경되었습니다.');
        return Object.assign(meta, {commit: ref.object.sha, downloadUrl: rawUrl(ref.object.sha)});
      }
    }
    const meta = {filename: input.filename, size: bytes.length, sha256,
      registeredAt: new Date().toISOString(), requestId: input.requestId};
    const blob = github('/git/blobs', 'post', {content: input.content, encoding: 'base64'});
    const tree = github('/git/trees', 'post', {base_tree: parent.tree.sha, tree: [
      {path: FILE_PATH, mode: '100644', type: 'blob', sha: blob.sha},
      {path: META_PATH, mode: '100644', type: 'blob', content: JSON.stringify(meta) + '\n'}
    ]});
    const commit = github('/git/commits', 'post', {message: 'Update latest rent workbook', tree: tree.sha, parents: [ref.object.sha]});
    github('/git/refs/heads/' + BRANCH, 'patch', {sha: commit.sha, force: false});
    const result = Object.assign(meta, {commit: commit.sha, downloadUrl: rawUrl(commit.sha)});
    p.setProperty('LAST_UPLOAD', JSON.stringify(result));
    return result;
  } finally { lock.releaseLock(); }
}
function rawUrl(commit) { return 'https://raw.githubusercontent.com/' + REPO + '/' + commit + '/' + FILE_PATH; }
function doPost(event) {
  let result;
  try {
    if (!event || !event.postData || event.postData.contents.length > 8 * 1024 * 1024) fail('요청 크기를 확인해 주세요.');
    const input = JSON.parse(event.postData.contents);
    if (!input || typeof input !== 'object') fail('잘못된 요청입니다.');
    if (input.action === 'login') result = login(input);
    else if (input.action === 'upload') result = upload(input);
    else fail('지원하지 않는 요청입니다.');
    result = {ok: true, data: result};
  } catch (error) {
    // Do not echo arbitrary exception text: credentials or upstream content must never reach the client.
    const known = /^(업로드|이름|로그인|엑셀|열 수|일반|다른|GitHub|지원하지|요청|잘못된)/;
    result = {ok: false, error: known.test(error.message) ? error.message : '저장에 실패했습니다. 잠시 후 다시 시도해 주세요.'};
  }
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

/** Run once from the owner's editor to approve UrlFetch, without writing any files. */
function authorizeRelay() {
  const repo = github('');
  if (repo.full_name !== REPO || !repo.permissions || !repo.permissions.push)
    fail('GitHub 저장 권한을 확인해 주세요.');
  return 'GitHub connection verified. No files were changed.';
}
