import { parsePreview } from './csv-preview.js';

const $ = (id) => document.getElementById(id);
let previewRequest = null;
let previewLoaded = false;

const SESSION_KEY = 'aurora-rent-session-v1';
// This digest implements a prototype UI lock only, never server authorization.
const LOCK_DIGEST = '8d129f703b9851ce74cbb41cb84db46fcb6098bea25563526bb700d4a03f8812';
function status(id, message, state = '') {
  $(id).textContent = message;
  $(id).dataset.state = state;
}

function setSession(name) {
  $('user-name').textContent = `${name}님`;
  $('login-screen').hidden = true;
  $('workspace').hidden = false;
  $('user-menu').hidden = false;
  status('login-error', '');
  status('download-status', '');

}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('name').value.trim();
  let password = $('password').value;
  $('password').value = '';
  if (!name) {
    status('login-error', '공백이 아닌 이름을 입력해 주세요.');
    $('name').focus();
    password = '';
    return;
  }
  $('login-submit').disabled = true;
  try {
    const bytes = new TextEncoder().encode(password);
    password = '';
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    bytes.fill(0);
    const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== LOCK_DIGEST) {
      status('login-error', '비밀번호가 올바르지 않습니다. 다시 입력해 주세요.');
      $('password').focus();
      return;
    }
    // Store only the name/UI state in this tab, never a password or its digest.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({ name, unlocked: true }));
    setSession(name);
  } catch {
    status('login-error', '접속 상태를 저장할 수 없습니다. 브라우저 저장소 설정과 HTTPS 접속을 확인해 주세요.');
  } finally {
    password = '';
    $('login-submit').disabled = false;
  }
});

$('logout').addEventListener('click', () => {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* UI still returns to login. */ }
  previewRequest?.abort();
  previewLoaded = false;
  $('preview-section').open = false;
  $('preview-summary').textContent = '펼쳐서 확인';
  $('preview-head').replaceChildren();
  $('preview-body').replaceChildren();
  $('workspace').hidden = true;
  $('user-menu').hidden = true;
  $('login-screen').hidden = false;
  $('user-name').textContent = '';
  $('login-form').reset();
  status('login-error', '');
  $('name').focus();
});

// Account for wrapped header content at every viewport size.
const headerObserver = new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--site-header-height', `${entry.target.getBoundingClientRect().height}px`);
});
headerObserver.observe(document.querySelector('.site-header'));
const previewObserver = new ResizeObserver(([entry]) => {
  document.documentElement.style.setProperty('--preview-toolbar-height', `${entry.target.getBoundingClientRect().height}px`);
});
previewObserver.observe(document.querySelector('#preview-section > summary'));
$('preview-section').addEventListener('toggle', () => {
  if ($('preview-section').open && !previewLoaded) loadPreview();
});

async function loadPreview() {
  previewRequest?.abort();
  const request = new AbortController();
  previewRequest = request;
  $('preview-head').replaceChildren();
  $('preview-body').replaceChildren();
  $('preview-summary').textContent = '불러오는 중';
  status('preview-status', 'CSV 전체 자료를 불러오고 있습니다…');
  try {
    const response = await fetch($('csv-download').href, { signal: request.signal, cache: 'no-store' });
    if (!response.ok) throw new Error('CSV 응답 오류');
    const parsed = parsePreview(await response.arrayBuffer());
    if (request.signal.aborted) return;
    const header = document.createElement('tr');
    for (const name of parsed.headers) {
      const cell = document.createElement('th');
      cell.scope = 'col';
      cell.textContent = name;
      header.append(cell);
    }
    $('preview-head').replaceChildren(header);
    const fragment = document.createDocumentFragment();
    for (const values of parsed.rows) {
      const row = document.createElement('tr');
      for (const [index, value] of values.entries()) {
        const cell = document.createElement('td');
        cell.dataset.label = parsed.headers[index];
        cell.textContent = value;
        row.append(cell);
      }
      fragment.append(row);
    }
    $('preview-body').replaceChildren(fragment);
    previewLoaded = true;
    $('preview-summary').textContent = `전체 ${parsed.count.toLocaleString('ko-KR')}건 · ${parsed.headers.length}개 열`;
    status('preview-status', `총 ${parsed.count.toLocaleString('ko-KR')}건을 마지막 행까지 모두 표시했습니다.`, 'success');
  } catch {
    if (request.signal.aborted) return;
    $('preview-summary').textContent = '미리보기 불러오기 실패';
    status('preview-status', 'CSV 미리보기를 불러오지 못했습니다. 새로고침해 다시 시도해 주세요. 원본 CSV 다운로드는 별도로 이용할 수 있습니다.', 'error');
  }
}

// Native same-origin download preserves the static file bytes and filename.
// This is a shared file link; the UI lock does not restrict direct file access.
$('csv-download').addEventListener('click', () => {
  status('download-status', '원본 CSV 다운로드를 요청했습니다. 브라우저의 다운로드 목록을 확인해 주세요.', 'success');
});

try {
  const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  if (session?.unlocked === true && typeof session.name === 'string' && session.name.trim()) setSession(session.name.trim().slice(0, 80));
} catch {
  status('login-error', '접속 상태를 복원할 수 없습니다. 다시 접속해 주세요.');
}
