/** Free Apps Script relay. Secrets stay in Script Properties, never in Pages. */
const REPO = 'sskim4912/aurora_portal';
const BRANCH = 'main';
const FILE_PATH = 'rent/uploads/latest.csv';
const META_PATH = 'rent/uploads/latest.json';
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
    fail('로그인이 만료되었습니다. 업로드 버튼에서 다시 인증해 주세요.');
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
function csvFile(input) {
  if (typeof input.filename !== 'string' || input.filename.length > 180 ||
      /[\/\\\x00-\x1f\x7f]/.test(input.filename) || !/\.csv$/i.test(input.filename))
    fail('CSV .csv 파일을 선택해 주세요.');
  if (typeof input.content !== 'string' || input.content.length > Math.ceil(MAX_FILE / 3) * 4 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.content)) fail('CSV 파일은 최대 5MiB입니다.');
  let bytes;
  try { bytes = Utilities.base64Decode(input.content); }
  catch (_) { fail('CSV 파일 내용을 확인해 주세요.'); }
  if (!bytes.length || bytes.length > MAX_FILE) fail('CSV 파일은 최대 5MiB입니다.');
  let text = Utilities.newBlob(bytes).getDataAsString('UTF-8');
  let encoding = 'UTF-8';
  if (text.indexOf('\ufffd') >= 0) {
    text = Utilities.newBlob(bytes).getDataAsString('MS949'); encoding = 'CP949 / EUC-KR';
  }
  text = text.replace(/^\ufeff/, '');
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd]/.test(text)) fail('CSV 인코딩 또는 제어 문자를 확인해 주세요.');
  let rows = [], row = [], cell = '', state = 'start', touched = false;
  function addCell() { row.push(cell); cell = ''; if (row.length > 14) fail('CSV는 14개 열이어야 합니다.'); }
  function addRow() { addCell(); if (row.length !== 14) fail('CSV는 14개 열이어야 합니다.'); rows.push(row); row = []; touched = false; }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (state === 'quoted') {
      if (ch === '"') {
        if (text[i+1] === '"') { cell += '"'; i++; } else state = 'closed';
      } else cell += ch;
      continue;
    }
    if (ch === ',') { addCell(); state = 'start'; touched = true; }
    else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i+1] === '\n') i++;
      addRow(); state = 'start';
    } else if (ch === '"' && state === 'start') { state = 'quoted'; touched = true; }
    else {
      if (ch === '"' || state === 'closed') fail('CSV 인용부호 형식을 확인해 주세요.');
      cell += ch; state = 'plain'; touched = true;
    }
  }
  if (state === 'quoted') fail('CSV 인용부호가 닫히지 않았습니다.');
  if (touched || row.length || cell) addRow();
  const order = '반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28'.split(',');
  const headers = '순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형'.split(',');
  if (rows.length < 3 || rows[0].some((v,i)=>v!==order[i]) || rows[1].some((v,i)=>v!==headers[i]))
    fail('CSV는 반영순서·항목명의 2줄 헤더와 데이터가 필요합니다.');
  const numbers = new Set();
  rows.slice(2).forEach(values => {
    if (!/^[1-9][0-9]*$/.test(values[0]) || numbers.has(values[0])) fail('CSV 순번은 중복 없는 양의 정수여야 합니다.');
    numbers.add(values[0]);
  });
  const date = /^(20\d{2})[.\-/](0[1-9]|1[0-2])/.exec(rows[2][5]);
  if (!date) fail('CSV 작성일자에서 대상 연월을 확인해 주세요.');
  return {bytes, count: rows.length-2, encoding, month: date[1]+'-'+date[2]};
}
function upload(input) {
  authorize(input.session);
  if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId))
    fail('업로드 요청을 다시 시작해 주세요.');
  const checked = csvFile(input);
  const bytes = checked.bytes;
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
      count: checked.count, encoding: checked.encoding, month: checked.month,
      registeredAt: new Date().toISOString(), requestId: input.requestId};
    const blob = github('/git/blobs', 'post', {content: input.content, encoding: 'base64'});
    const tree = github('/git/trees', 'post', {base_tree: parent.tree.sha, tree: [
      {path: FILE_PATH, mode: '100644', type: 'blob', sha: blob.sha},
      {path: META_PATH, mode: '100644', type: 'blob', content: JSON.stringify(meta) + '\n'}
    ]});
    const commit = github('/git/commits', 'post', {message: 'Update latest rent CSV', tree: tree.sha, parents: [ref.object.sha]});
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
    const known = /^(업로드|이름|로그인|CSV|엑셀|열 수|일반|다른|GitHub|지원하지|요청|잘못된)/;
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
