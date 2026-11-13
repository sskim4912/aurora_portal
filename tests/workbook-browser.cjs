const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],env:{...process.env,XDG_CONFIG_HOME:'/workspace/.cloud-setup/config',XDG_CACHE_HOME:'/workspace/.cloud-setup/cache'}});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const endpoint='https://script.google.com/macros/s/test-relay/exec';
 const fake=Buffer.from('반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28\n순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형\n1,2026.11.13,영수증,주민번호,00001,2026.11.13,1000,단기,임차료,숙소,가상자료,2026.11.13,2026.11.30,예금\n');
 const sha256=crypto.createHash('sha256').update(fake).digest('hex');
 const commit='b'.repeat(40);
 const meta={filename:'가상 숙소.csv',count:1,month:'2026-11',encoding:'UTF-8',size:fake.length,sha256,registeredAt:'2026-11-13T01:00:00Z',commit,downloadUrl:`https://raw.githubusercontent.com/sskim4912/aurora_portal/${commit}/rent/uploads/latest.csv`};
 const requests=[];let rejectUpload=true;
 await context.route('**/rent/upload-config.json',r=>r.fulfill({json:{endpoint}}));
 await context.route('**/rent/uploads/latest.json',r=>r.fulfill({status:404,body:''}));
 await context.route(endpoint,async r=>{
  const body=r.request().postDataJSON();requests.push(body);
  if(body.action==='login')return r.fulfill({json:{ok:true,data:{session:'a'.repeat(64),expiresAt:Date.now()+3600000}}});
  assert.equal(body.session,'a'.repeat(64));assert.equal(body.content,fake.toString('base64'));
  if(rejectUpload){rejectUpload=false;return r.fulfill({json:{ok:false,error:'GitHub 저장 연결에 실패했습니다.'}})}
  return r.fulfill({json:{ok:true,data:meta}});
 });
 await context.route(meta.downloadUrl,r=>r.fulfill({body:fake,contentType:'application/octet-stream',headers:{'Access-Control-Allow-Origin':'*'}}));
 try{
  await page.goto('http://127.0.0.1:8003/rent/');
  await page.locator('#name').fill('김성석');await page.locator('#password').fill(process.env.RENT_TEST_UI_PASSWORD);
  await page.locator('#login-submit').click();await page.locator('#workspace').waitFor({state:'visible'});
  assert(await page.locator('#workbook-upload-form').isVisible());assert.equal(requests[0].action,'login');
  assert.equal(await page.locator('#password').inputValue(),'');
  const stored=await page.evaluate(()=>JSON.stringify({...sessionStorage}));assert(!stored.includes(process.env.RENT_TEST_UI_PASSWORD));
  await page.reload();assert(await page.locator('#workbook-upload-form').isVisible());
  await page.locator('#workbook-file').setInputFiles({name:meta.filename,mimeType:'text/csv',buffer:fake});
  await page.locator('#workbook-submit').click();await page.getByText('GitHub 저장 연결에 실패했습니다.',{exact:true}).waitFor();
  assert(await page.locator('#workbook-download').isHidden());
  await page.locator('#workbook-submit').click();await page.locator('#workbook-upload-status[data-state="success"]').waitFor();
  const uploads=requests.filter(x=>x.action==='upload');assert.equal(uploads.length,2);assert.equal(uploads[0].requestId,uploads[1].requestId);
  assert((await page.locator('#workbook-info').innerText()).includes(meta.filename));
  assert.equal(await page.locator('#csv-download').getAttribute('download'),meta.filename);
  assert.equal(await page.locator('#csv-download').getAttribute('href'),meta.downloadUrl);
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:7000}),page.locator('#workbook-download').click()]).catch(async e=>{console.error('Download status:',await page.locator('#workbook-download-status').innerText());throw e;});
  assert.equal(download.suggestedFilename(),meta.filename);assert.deepEqual(fs.readFileSync(await download.path()),fake);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.setViewportSize({width:1440,height:1000});
  const aligned = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.step-card')];
    const rect = el => {const r=el.getBoundingClientRect();return {y:r.y,height:r.height,width:r.width};};
    return {
      cards: cards.map(rect),
      headers: cards.map(c=>rect(c.querySelector('.step-top'))),
      titles: cards.map(c=>rect(c.querySelector('h2'))),
      details: cards.map(c=>rect(c.querySelector(':scope > .card-detail'))),
      actions: [document.querySelector('#workbook-submit'),document.querySelector('#csv-download'),document.querySelector('#program-download')].map(rect)
    };
  });
  for(const key of ['cards','headers','titles','details','actions']){
    const rows=aligned[key];
    assert(Math.max(...rows.map(r=>r.y))-Math.min(...rows.map(r=>r.y))<1, key+' top alignment');
    assert(Math.max(...rows.map(r=>r.height))-Math.min(...rows.map(r=>r.height))<1,key+' equal height');
    assert(Math.max(...rows.map(r=>r.width))-Math.min(...rows.map(r=>r.width))<1,key+' equal width');
  }
  assert(aligned.actions.every(r=>r.height===52));
  await page.evaluate(()=>window.scrollTo(0,0));
  fs.mkdirSync('/workspace/aurora-artifacts',{recursive:true});await page.screenshot({path:'/workspace/aurora-artifacts/workbook-upload.png',fullPage:true});
  await page.locator('#logout').click();assert(await page.locator('#workbook-upload-form').isHidden());
  assert.equal(await page.evaluate(()=>sessionStorage.getItem('aurora-workbook-upload-session')),null);
  await page.locator('#name').fill('일반 사용자');await page.locator('#password').fill(process.env.RENT_TEST_UI_PASSWORD);await page.locator('#login-submit').click();
  await page.locator('#workspace').waitFor({state:'visible'});assert(await page.locator('#workbook-upload-form').isHidden());assert(await page.locator('#workbook-download').isVisible());
  // A user who logged in before uploads were deployed must still see an upload entry.
  await page.evaluate(()=>{sessionStorage.removeItem('aurora-workbook-upload-session');sessionStorage.setItem('aurora-rent-session-v1',JSON.stringify({name:'김성석',unlocked:true}));});
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});
  assert(await page.locator('#workbook-upload-form').isHidden());
  assert(await page.locator('#workbook-login').isVisible());
  await page.locator('#workbook-login').click();
  await page.locator('#workbook-auth-password').fill(process.env.RENT_TEST_UI_PASSWORD);
  await page.locator('#workbook-auth-submit').click();
  await page.locator('#workbook-upload-form').waitFor({state:'visible'});
  assert(await page.locator('#workbook-login').isHidden());
  assert.equal(await page.locator('#workbook-auth-password').inputValue(),'');
  assert.equal(await page.locator('#workbook-submit').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(121, 80, 180)');
  assert.deepEqual(errors,[]);console.log('Passed: admin login, reload session, failure/retry idempotence, confirmed save, original download, 4 widths, logout, ordinary user read-only, no JS errors.');
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
