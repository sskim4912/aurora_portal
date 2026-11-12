const {chromium}=require('playwright');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],env:{...process.env,XDG_CONFIG_HOME:'/workspace/.cloud-setup/config',XDG_CACHE_HOME:'/workspace/.cloud-setup/cache'}});
 const context=await browser.newContext();const page=await context.newPage();const errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const endpoint='https://script.google.com/macros/s/test-relay/exec';
 const fake=Buffer.from('PK browser upload fixture');
 const sha256=crypto.createHash('sha256').update(fake).digest('hex');
 const commit='b'.repeat(40);
 const meta={filename:'가상 숙소.xlsx',size:fake.length,sha256,registeredAt:'2026-11-13T01:00:00Z',commit,downloadUrl:`https://raw.githubusercontent.com/sskim4912/aurora_portal/${commit}/rent/workbooks/latest.xlsx`};
 const requests=[];let rejectUpload=true;
 await context.route('**/rent/upload-config.json',r=>r.fulfill({json:{endpoint}}));
 await context.route('**/rent/workbooks/latest.json',r=>r.fulfill({status:404,body:''}));
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
  await page.locator('#workbook-file').setInputFiles({name:meta.filename,mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',buffer:fake});
  await page.locator('#workbook-submit').click();await page.getByText('GitHub 저장 연결에 실패했습니다.',{exact:true}).waitFor();
  assert(await page.locator('#workbook-download').isHidden());
  await page.locator('#workbook-submit').click();await page.locator('#workbook-upload-status[data-state="success"]').waitFor();
  const uploads=requests.filter(x=>x.action==='upload');assert.equal(uploads.length,2);assert.equal(uploads[0].requestId,uploads[1].requestId);
  assert((await page.locator('#workbook-info').innerText()).includes(meta.filename));
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:7000}),page.locator('#workbook-download').click()]).catch(async e=>{console.error('Download status:',await page.locator('#workbook-download-status').innerText());throw e;});
  assert.equal(download.suggestedFilename(),meta.filename);assert.deepEqual(fs.readFileSync(await download.path()),fake);
  for(const width of [320,390,768,1440]){
    await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
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
