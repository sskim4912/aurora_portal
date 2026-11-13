const $ = id => document.getElementById(id);
let current = '';
let pending = false;
let currentDate = 0;
function applyCsv(meta,url) {
  if (Date.parse(meta.registeredAt) < currentDate) return;
  $('csv-download').href=url; $('csv-download').download=meta.filename;
  $('latest-info').textContent=`${meta.filename}\n대상 월 ${meta.month} · 등록일 ${new Date(meta.registeredAt).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})} (한국시간)\n데이터 ${meta.count.toLocaleString()}건 · ${meta.size.toLocaleString()} B · ${meta.encoding} 원본 유지`;
  document.querySelectorAll('.guide-filename').forEach(el=>{el.textContent=meta.filename;});
  current=meta.version || meta.commit;currentDate=Date.parse(meta.registeredAt);
  document.dispatchEvent(new Event('csv-latest-changed'));
}
document.addEventListener('csv-uploaded',event=>applyCsv(event.detail.meta,event.detail.url));
async function refresh() {
  if (pending) return;
  pending = true;
  try {
    const response = await fetch(new URL('latest.json', import.meta.url), {cache:'no-store'});
    if (!response.ok) throw new Error('메타데이터 응답 오류');
    const meta = await response.json();
    if (!meta || typeof meta.filename !== 'string' || /[/\\\x00-\x1f]/u.test(meta.filename) || !meta.filename.toLowerCase().endsWith('.csv') || !/^[a-f0-9]{40}$/.test(meta.version) || !/^[a-f0-9]{64}$/.test(meta.sha256) || !Number.isSafeInteger(meta.count) || meta.count < 1 || !/^\d{4}-\d{2}$/.test(meta.month) || !Number.isFinite(Date.parse(meta.registeredAt))) throw new Error('메타데이터 형식 오류');
    if (current === meta.version) return;
    applyCsv(meta,new URL(`downloads/${encodeURIComponent(meta.filename)}`, import.meta.url).href);
  } catch {
    // The deployed page always has the last validated download; never simulate upload success.
  } finally { pending=false; }
}
refresh();
setInterval(()=>{if(!document.hidden)refresh();},60000);
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
