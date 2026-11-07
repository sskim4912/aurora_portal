const $ = (id) => document.getElementById(id);
const SESSION_KEY = 'aurora-rent-session-v1';
// This digest implements a prototype UI lock only, never server authorization.
const LOCK_DIGEST = '8d129f703b9851ce74cbb41cb84db46fcb6098bea25563526bb700d4a03f8812';
const HEADERS = ['순번', '입력번호', '증빙종류', '거래처구분', '거래처', '작성일자', '금액', '리스예외사유', '비용구분', '계정과목', '사용내역', '발생일자', '만기일자', '지불유형'];
const ORDER = ['반영순서', '1', '3', '4', '5', '6', '7', '16', '19', '20', '22', '23', '24', '28'];
const MAX_BYTES = 25 * 1024 * 1024;
let latest = null;
let busy = false;
let loggedIn = false;
let viewGeneration = 0;

function status(id, message, state = '') {
  $(id).textContent = message;
  $(id).dataset.state = state;
}

function setSession(name) {
  loggedIn = true;
  $('user-name').textContent = `${name}님`;
  $('login-screen').hidden = true;
  $('workspace').hidden = false;
  $('user-menu').hidden = false;
  status('login-error', '');
  $('page-title').tabIndex = -1;
  $('page-title').focus();
  loadLatest();
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
  loggedIn = false;
  viewGeneration++;
  latest = null;
  $('workspace').hidden = true;
  $('user-menu').hidden = true;
  $('login-screen').hidden = false;
  $('user-name').textContent = '';
  $('preview-head').replaceChildren();
  $('preview-body').replaceChildren();
  $('preview-section').hidden = true;
  $('csv-download').disabled = true;
  $('login-form').reset();
  status('login-error', '');
  $('name').focus();
});

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('aurora-rent-csv', 1);
    let settled = false;
    request.onupgradeneeded = () => request.result.createObjectStore('files');
    request.onblocked = () => { settled = true; reject(new Error('다른 탭을 닫고 다시 시도해 주세요.')); };
    request.onerror = () => reject(new Error('브라우저 저장소에 접근할 수 없습니다.'));
    request.onsuccess = () => {
      if (settled) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
}

async function readSaved() {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const request = tx.objectStore('files').get('latest');
    tx.oncomplete = () => { db.close(); resolve(request.result || null); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('저장된 CSV를 읽지 못했습니다.')); };
  });
}

async function saveFile(record) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put(record, 'latest');
    // The success UI follows the transaction commit, not the request success.
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onabort = tx.onerror = () => { db.close(); reject(new Error('CSV 저장에 실패했습니다. 브라우저 저장 공간·설정을 확인해 주세요. 이전 정상 파일은 유지됩니다.')); };
  });
}

function decodeCSV(bytes) {
  let text;
  let encoding;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    encoding = 'UTF-8';
  } catch {
    try {
      // The WHATWG euc-kr decoder includes the CP949 extension.
      text = new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
      encoding = 'CP949 / EUC-KR';
    } catch {
      throw new Error('UTF-8 또는 CP949/EUC-KR 인코딩의 CSV를 선택해 주세요.');
    }
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) {
    throw new Error('CSV에 지원하지 않는 제어 문자가 있습니다.');
  }
  return { text, encoding };
}

// Strict RFC-style comma/quote parsing; keep only five data rows in memory.
// Original bytes are stored separately and are never rebuilt from parsed values.
function parseCSV(text) {
  let row = [];
  let cell = '';
  let state = 'start';
  let rowNumber = 0;
  let count = 0;
  let rowTouched = false;
  const preview = [];
  function addCell() {
    row.push(cell);
    cell = '';
    if (row.length > 14) throw new Error(`CSV ${rowNumber + 1}행의 열 수가 14개를 초과합니다.`);
  }
  function addRow() {
    addCell();
    rowNumber++;
    if (row.length !== 14) throw new Error(`CSV ${rowNumber}행은 14개 열이어야 합니다. 현재 ${row.length}개입니다.`);
    if (rowNumber <= 2) {
      const expected = rowNumber === 1 ? ORDER : HEADERS;
      if (row.some((value, i) => value !== expected[i])) {
        throw new Error(rowNumber === 1 ? '첫 줄의 자동입력 반영순서가 지정된 14개 열과 일치하지 않습니다.' : '둘째 줄의 항목명이 지정된 14개 열과 일치하지 않습니다.');
      }
    } else {
      if (row.every((value) => !value.trim())) throw new Error(`CSV ${rowNumber}행에 데이터가 없습니다.`);
      count++;
      if (preview.length < 5) preview.push(row);
    }
    row = [];
    rowTouched = false;
  }
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (state === 'quoted') {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; }
        else state = 'closed';
      } else cell += char;
      continue;
    }
    if (char === ',') { addCell(); state = 'start'; rowTouched = true; }
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      addRow(); state = 'start';
    } else if (char === '"' && state === 'start') { state = 'quoted'; rowTouched = true; }
    else {
      if (char === '"' || state === 'closed') throw new Error(`CSV ${rowNumber + 1}행의 큰따옴표 형식이 올바르지 않습니다.`);
      cell += char; state = 'plain'; rowTouched = true;
    }
  }
  if (state === 'quoted') throw new Error('닫히지 않은 큰따옴표가 있습니다. CSV 형식을 확인해 주세요.');
  if (rowTouched || row.length || cell) addRow();
  if (rowNumber < 2) throw new Error('반영순서와 항목명으로 구성된 2줄 헤더가 필요합니다.');
  if (!count) throw new Error('헤더 외에 전표 데이터가 한 건 이상 있어야 합니다.');
  return { count, preview };
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
function displayDate(value) { return `${dateFormat.format(new Date(value))} (한국 시간)`; }
function displayBytes(value) { return value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KB (${value.toLocaleString('ko-KR')} B)` : `${(value / 1024 ** 2).toFixed(2)} MB (${value.toLocaleString('ko-KR')} B)`; }

function render(record) {
  $('latest-info').replaceChildren();
  if (!record) {
    const title = document.createElement('strong'); title.textContent = '등록된 CSV가 없습니다';
    const info = document.createElement('p'); info.textContent = 'STEP 02에서 정상 CSV를 먼저 업로드해 주세요.';
    $('latest-info').append(title, info);
    $('preview-section').hidden = true;
    $('csv-download').disabled = true;
    status('upload-status', '아직 등록된 CSV가 없습니다.');
    return;
  }
  const title = document.createElement('strong'); title.textContent = record.name;
  const metadata = document.createElement('dl');
  for (const [label, value] of [['파일 용량', displayBytes(record.bytes.byteLength)], ['업로드 시각', displayDate(record.uploadedAt)], ['데이터', `${record.count.toLocaleString('ko-KR')}건 · 14개 열 · ${record.encoding}`]]) {
    const term = document.createElement('dt'); term.textContent = label;
    const definition = document.createElement('dd'); definition.textContent = value;
    metadata.append(term, definition);
  }
  $('latest-info').append(title, metadata);
  const header = document.createElement('tr');
  HEADERS.forEach((label) => { const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = label; header.append(cell); });
  $('preview-head').replaceChildren(header);
  const rows = record.preview.map((values) => {
    const row = document.createElement('tr');
    values.forEach((value) => { const cell = document.createElement('td'); cell.textContent = value; row.append(cell); });
    return row;
  });
  $('preview-body').replaceChildren(...rows);
  $('preview-summary').textContent = `전체 ${record.count.toLocaleString('ko-KR')}건 · 14개 열`;
  $('preview-section').hidden = false;
  $('csv-download').disabled = false;
}

async function loadLatest() {
  const generation = ++viewGeneration;
  status('download-status', '');
  try {
    const record = await readSaved();
    if (!loggedIn || generation !== viewGeneration) return;
    latest = record;
    render(latest);
    if (latest) status('upload-status', '이 브라우저에 저장된 최신 CSV를 불러왔습니다.', 'success');
  } catch (error) {
    if (loggedIn && generation === viewGeneration) status('upload-status', error.message, 'error');
  }
}

async function upload(files) {
  if (busy || !loggedIn) return;
  if (!files.length) return;
  if (files.length !== 1) { status('upload-status', 'CSV 파일은 한 번에 한 개만 선택해 주세요. 이전 정상 파일은 유지됩니다.', 'error'); return; }
  busy = true;
  // Ignore an older pending read so it cannot replace a newly committed file.
  const generation = ++viewGeneration;
  $('csv-file').disabled = true;
  status('download-status', '');
  status('upload-status', 'CSV 확인 및 브라우저 저장 중입니다…');
  try {
    const file = files[0];
    if (!/\.csv$/i.test(file.name)) throw new Error('확장자가 .csv인 파일을 선택해 주세요.');
    if (!file.size) throw new Error('빈 파일은 업로드할 수 없습니다.');
    if (file.size > MAX_BYTES) throw new Error('CSV는 최대 25MB까지 업로드할 수 있습니다.');
    const bytes = await file.arrayBuffer();
    const { text, encoding } = decodeCSV(bytes);
    const { count, preview } = parseCSV(text);
    const record = { name: file.name, uploadedAt: Date.now(), bytes, encoding, count, preview };
    await saveFile(record);
    if (!loggedIn || generation !== viewGeneration) return;
    latest = record;
    render(latest);
    status('upload-status', `업로드 완료 · ${file.name} · ${displayBytes(file.size)} · ${count.toLocaleString('ko-KR')}건 · ${displayDate(record.uploadedAt)}`, 'success');
  } catch (error) {
    if (loggedIn && generation === viewGeneration) status('upload-status', `${error.message} 새 파일로 교체하지 않았습니다.`, 'error');
  } finally {
    busy = false;
    $('csv-file').disabled = false;
    $('csv-file').value = '';
  }
}

$('csv-file').addEventListener('change', (event) => upload(Array.from(event.target.files)));
for (const type of ['dragenter', 'dragover']) $('drop-zone').addEventListener(type, (event) => { event.preventDefault(); $('drop-zone').classList.add('dragover'); });
$('drop-zone').addEventListener('dragleave', (event) => { if (!$('drop-zone').contains(event.relatedTarget)) $('drop-zone').classList.remove('dragover'); });
$('drop-zone').addEventListener('drop', (event) => { event.preventDefault(); $('drop-zone').classList.remove('dragover'); upload(Array.from(event.dataTransfer.files)); });
// Prevent a missed drop from navigating away from the page.
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

$('csv-download').addEventListener('click', () => {
  if (!latest || !loggedIn) return;
  try {
    const url = URL.createObjectURL(new Blob([latest.bytes], { type: 'text/csv' }));
    const link = document.createElement('a'); link.href = url; link.download = latest.name;
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    status('download-status', '원본 CSV 다운로드를 시작했습니다. 브라우저의 다운로드 목록을 확인해 주세요.', 'success');
  } catch {
    status('download-status', '다운로드를 시작하지 못했습니다. 브라우저 설정을 확인해 주세요.', 'error');
  }
});

try {
  const session = JSON.parse(sessionStorage.getItem(SESSION_KEY));
  if (session?.unlocked === true && typeof session.name === 'string' && session.name.trim()) setSession(session.name.trim().slice(0, 80));
} catch {
  status('login-error', '접속 상태를 복원할 수 없습니다. 다시 접속해 주세요.');
}
