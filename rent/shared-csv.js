import { parsePreview } from './csv-preview.js';
const $ = id => document.getElementById(id);
const configured = document.querySelector('meta[name="rent-api"]').content.trim().replace(/\/$/, '');
const base = configured || location.origin;
let token = '';
let connected = false;
let validated = null;
let current = null;
export function clearAdmin() {
  const previous = token;
  token = ''; validated = null;
  $('upload-form').reset(); $('admin-login').reset();
  $('upload-form').hidden = $('admin-logout').hidden = true;
  $('admin-login').hidden = true;
  $('admin-open').hidden = !connected;
  $('upload-submit').disabled = true;
  if (previous) fetch(`${base}/api/logout`, {method:'POST',headers:{Authorization:`Bearer ${previous}`}}).catch(()=>{});
}
async function api(path, options={}) {
  const response = await fetch(base+path, {cache:'no-store',...options,headers:{...(token?{Authorization:`Bearer ${token}`} : {}),...options.headers}});
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') clearAdmin();
    const data = await response.json().catch(()=>({}));
    throw new Error(data.error || '공용 서비스 요청에 실패했습니다.');
  }
  return response;
}
async function latest() {
  const response = await api('/api/latest');
  const meta = await response.json();
  current = meta;
  const link = $('csv-download');
  link.href = `${base}/api/download?v=${encodeURIComponent(meta.version)}`;
  link.download = meta.filename;
  $('latest-info').textContent = `${meta.filename}\n대상 월 ${meta.month} · 등록일 ${new Date(meta.registeredAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국시간)\n데이터 ${meta.count}건 · ${meta.size.toLocaleString()} B · ${meta.encoding} 원본 유지`;
  document.querySelectorAll('.guide-filename').forEach(el=>el.textContent=meta.filename);
  document.dispatchEvent(new Event('csv-latest-changed'));
}
async function connect() {
  try {
    await api('/api/session');
    connected = true;
    $('service-status').textContent = '공용 CSV 등록 서비스가 연결되었습니다.';
    $('admin-open').hidden = false;
    try { await latest(); } catch { $('service-status').textContent = '최신 등록 파일을 확인하지 못해 기존 공통 파일을 제공합니다.'; }
  } catch {
    $('service-status').textContent = '관리자 등록 서비스 미연결 · 기존 공통 CSV를 제공합니다.';
  }
}
$('admin-open').onclick = ()=>{$('admin-login').hidden = !$('admin-login').hidden;};
$('admin-login').onsubmit = async event=>{
  event.preventDefault();
  const password=$('admin-password').value; $('admin-password').value='';
  try {
    const response = await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('admin-user').value,password})});
    token=(await response.json()).token;
    $('admin-login').hidden=true; $('upload-form').hidden=$('admin-logout').hidden=false;
    $('admin-open').hidden=true; $('upload-status').textContent='관리자 인증 완료 · 파일과 대상 월을 선택해 주세요.';
  } catch(error){$('upload-status').textContent=error.message;}
};
$('admin-logout').onclick=()=>{clearAdmin();$('admin-open').hidden=false;$('upload-status').textContent='관리자 로그아웃 완료';};
$('csv-file').onchange=async()=>{
  validated=null;$('upload-submit').disabled=true;
  const files=$('csv-file').files;
  try {
    if(files.length!==1 || !files[0].name.toLowerCase().endsWith('.csv') || files[0].size>25*1024*1024) throw new Error('CSV 파일 한 개, 최대 25MB를 선택해 주세요.');
    const file=files[0]; const parsed=parsePreview(await file.arrayBuffer());
    validated=file;$('validation-status').textContent=`검증 완료 · ${parsed.count}건 · ${parsed.encoding}`;
    $('upload-submit').disabled=false;
  }catch(error){$('validation-status').textContent=error.message;}
};
$('upload-form').onsubmit=async event=>{
  event.preventDefault(); if(!validated || !token)return;
  $('upload-submit').disabled=true;
  try {
    await api('/api/upload',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Filename':encodeURIComponent(validated.name),'X-Target-Month':$('target-month').value},body:validated});
    $('upload-status').textContent='공용 CSV 저장 완료. 모든 사용자가 같은 최신 파일을 내려받습니다.';
    try {await latest();}catch{$('upload-status').textContent='저장 완료. 최신 파일 표시를 갱신하려면 새로고침해 주세요.';}
  }catch(error){$('upload-status').textContent=error.message;}
  finally{$('upload-submit').disabled=!validated;}
};
// Poll metadata while this page is visible; no CSV content is stored in browser storage.
setInterval(()=>{if(!document.hidden)refresh();},30000);
async function refresh(){if(current){try{const r=await api('/api/latest');const meta=await r.json();if(meta.version!==current.version)await latest();}catch{}}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
connect();
