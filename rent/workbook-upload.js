const $ = id => document.getElementById(id);
const KEY = 'aurora-workbook-upload-session';
const MAX_BYTES = 5 * 1024 * 1024;
let session = null;
let busy = false;
let revision = 0;
let retry = null;
let latest = null;
let configPromise;
async function endpoint() {
  configPromise ||= fetch(new URL('upload-config.json', import.meta.url), {cache: 'no-store'})
    .then(r => { if (!r.ok) throw Error(); return r.json(); });
  const config = await configPromise;
  if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(config.endpoint))
    throw Error('업로드 연결을 준비 중입니다. 기존 파일 다운로드는 계속 사용할 수 있습니다.');
  return config.endpoint;
}
async function request(body) {
  const url = await endpoint();
  let response;
  try {
    response = await fetch(url, {method: 'POST', credentials: 'omit', redirect: 'follow',
      headers: {'Content-Type': 'text/plain;charset=UTF-8'}, body: JSON.stringify(body), signal: AbortSignal.timeout(90000)});
  } catch (_) { throw Error('연결을 확인하지 못했습니다. 저장되었을 수 있으니 잠시 후 같은 파일로 다시 시도해 주세요.'); }
  if (!response.ok) throw Error('업로드 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.');
  const result = await response.json();
  if (!result.ok) throw Error(result.error || '저장에 실패했습니다.');
  return result.data;
}
export async function authenticateUpload(name, password) {
  if (name !== '김성석') return;
  const ticket = revision;
  const data = await request({action: 'login', name, password});
  if (ticket !== revision) return;
  if (!/^[a-f0-9]{64}$/.test(data.session) || !Number.isFinite(data.expiresAt)) throw Error('로그인 응답을 확인할 수 없습니다.');
  session = data;
  try { sessionStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* Current tab still works. */ }
  $('workbook-upload-form').hidden = false;
}
export function clearUploadSession() {
  revision++;
  session = null;
  retry = null;
  $('workbook-upload-form').reset();
  $('workbook-upload-form').hidden = true;
  $('workbook-upload-status').textContent = '';
  try { sessionStorage.removeItem(KEY); } catch (_) { /* Memory is cleared. */ }
}
export function restoreUploadSession(name) {
  if (name !== '김성석') return;
  try {
    const data = JSON.parse(sessionStorage.getItem(KEY));
    if (/^[a-f0-9]{64}$/.test(data?.session) && data.expiresAt > Date.now()) {
      session = data;
      $('workbook-upload-form').hidden = false;
    }
  } catch (_) { /* Login again to upload. */ }
}
function validMeta(meta) {
  return meta && typeof meta.filename === 'string' && meta.filename.length <= 180 &&
    !/[/\\\x00-\x1f\x7f]/.test(meta.filename) && /\.xlsx$/i.test(meta.filename) &&
    Number.isSafeInteger(meta.size) && meta.size > 0 && meta.size <= MAX_BYTES &&
    /^[a-f0-9]{64}$/.test(meta.sha256) && Number.isFinite(Date.parse(meta.registeredAt));
}
function showLatest(meta, url) {
  if (!validMeta(meta)) throw Error('최신 엑셀 정보를 확인할 수 없습니다.');
  latest = {meta, url};
  $('workbook-info').textContent = `${meta.filename}\n등록일 ${new Date(meta.registeredAt).toLocaleString('ko-KR', {timeZone: 'Asia/Seoul'})} (한국시간) · ${meta.size.toLocaleString('ko-KR')} B`;
  $('workbook-download').hidden = false;
}
let refreshing = false;
async function refreshLatest() {
  if (refreshing || busy || document.hidden) return;
  refreshing = true;
  try {
    const response = await fetch(new URL('workbooks/latest.json', import.meta.url), {cache: 'no-store'});
    if (response.status === 404) return;
    if (!response.ok) throw Error();
    const meta = await response.json();
    // Do not replace a just-uploaded result with a Pages version still deploying.
    if (latest && Date.parse(meta.registeredAt) <= Date.parse(latest.meta.registeredAt)) return;
    showLatest(meta, new URL('workbooks/latest.xlsx', import.meta.url).href);
  } catch (_) { /* Retain the last successful download. */ }
  finally { refreshing = false; }
}
async function hash(bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
function base64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}
$('workbook-file').addEventListener('change', () => { retry = null; });
$('workbook-upload-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (busy) return;
  const status = $('workbook-upload-status');
  const file = $('workbook-file').files[0];
  if (!session || session.expiresAt <= Date.now()) { status.textContent = '로그아웃 후 다시 접속해 주세요.'; return; }
  if (!file || !/\.xlsx$/i.test(file.name) || /[/\\\x00-\x1f\x7f]/.test(file.name) || file.name.length > 180 || !file.size || file.size > MAX_BYTES) {
    status.textContent = '최대 5MiB의 엑셀 .xlsx 파일을 선택해 주세요.'; return;
  }
  busy = true;
  const ticket = revision;
  $('workbook-submit').disabled = true;
  $('workbook-file').disabled = true;
  status.textContent = '엑셀 파일을 확인하고 저장하고 있습니다…';
  status.dataset.state = '';
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw Error('일반 .xlsx 엑셀 파일을 선택해 주세요.');
    const sha256 = await hash(bytes);
    retry ||= {requestId: crypto.randomUUID(), sha256, filename: file.name};
    if (retry.sha256 !== sha256 || retry.filename !== file.name) throw Error('파일을 다시 선택해 주세요.');
    const result = await request({action: 'upload', session: session.session, filename: file.name,
      content: base64(bytes), requestId: retry.requestId});
    if (ticket !== revision) return;
    if (!validMeta(result) || result.sha256 !== sha256 || result.size !== bytes.length || result.filename !== file.name ||
        !/^[a-f0-9]{40}$/.test(result.commit) || result.downloadUrl !== `https://raw.githubusercontent.com/sskim4912/aurora_portal/${result.commit}/rent/workbooks/latest.xlsx`)
      throw Error('저장 결과를 확인하지 못했습니다. 같은 파일로 다시 시도해 주세요.');
    showLatest(result, result.downloadUrl);
    status.textContent = 'GitHub에 저장했습니다. 지금 내려받을 수 있으며, 다른 PC에는 사이트 배포 후 반영됩니다.';
    status.dataset.state = 'success';
    retry = null;
    $('workbook-upload-form').reset();
  } catch (error) {
    if (ticket === revision) { status.textContent = error.message; status.dataset.state = 'error'; }
  } finally {
    busy = false;
    $('workbook-submit').disabled = false;
    $('workbook-file').disabled = false;
  }
});
$('workbook-download').addEventListener('click', async () => {
  if (!latest) return;
  const status = $('workbook-download-status');
  const selected = latest;
  $('workbook-download').disabled = true;
  status.textContent = '엑셀 파일을 준비하고 있습니다…';
  try {
    const response = await fetch(selected.url, {cache: 'no-store'});
    if (!response.ok) throw Error();
    const data = await response.arrayBuffer();
    if (data.byteLength !== selected.meta.size || await hash(data) !== selected.meta.sha256) throw Error();
    const href = URL.createObjectURL(new Blob([data], {type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link = document.createElement('a'); link.href = href; link.download = selected.meta.filename;
    document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(href), 60000);
    status.textContent = '다운로드를 요청했습니다. 브라우저 다운로드 목록을 확인해 주세요.';
  } catch (_) { status.textContent = '최신 엑셀을 내려받지 못했습니다. 잠시 후 다시 시도해 주세요.'; }
  finally { $('workbook-download').disabled = false; }
});
refreshLatest();
setInterval(refreshLatest, 60000);
document.addEventListener('visibilitychange', refreshLatest);
