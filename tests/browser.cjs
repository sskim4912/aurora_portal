const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('fs');const assert=require('node:assert/strict');
(async()=>{
 fs.mkdirSync('/tmp/aurora-artifacts',{recursive:true});
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext();const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const auth=JSON.parse(fs.readFileSync(process.env.RENT_TEST_AUTH_FILE));
 const r=await context.request.post('http://127.0.0.1:8000/api/login',{data:auth});assert.equal(r.status(),200);const token=(await r.json()).token;
 const order='반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28';const headers='순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형';
 const data=Buffer.from('\ufeff'+order+'\r\n'+headers+'\r\n'+Array.from({length:60},(_,i)=>`${i+1},2026.11.01,영수증,주민번호,00001,2026.11.01,"450,000",단기 임차,임차료,숙소,"가상 숙소 ${i+1} <script>window.injected=true</script>",2026.11.01,2026.11.30,예금`).join('\r\n')+'\r\n');
 const upload=await context.request.post('http://127.0.0.1:8000/api/upload',{headers:{Authorization:'Bearer '+token,'X-Filename':encodeURIComponent('가상_시연.csv'),'X-Target-Month':'2026-11','Content-Type':'application/octet-stream'},data});assert.equal(upload.status(),200);
 await page.goto('http://127.0.0.1:8000/rent/');
 assert.equal(await page.locator('#password').getAttribute('type'),'password');
 await page.locator('#name').fill('시연 사용자');await page.locator('#password').fill(process.env.RENT_TEST_UI_PASSWORD);await page.locator('#login-submit').click();await page.locator('#workspace').waitFor({state:'visible'});
 await page.reload();await page.locator('#workspace').waitFor({state:'visible'});
 assert.equal(await page.locator('#preview-section').getAttribute('open'),null);
 await page.locator('#preview-section > summary').click();await page.waitForFunction(()=>document.querySelectorAll('#preview-body tr').length===60);
 assert.equal(await page.evaluate(()=>window.injected),undefined);
 assert.equal(await page.locator('#program-download').getAttribute('target'),'_blank');
 const [download]=await Promise.all([page.waitForEvent('download'),page.locator('#csv-download').click()]);assert.equal(download.suggestedFilename(),'가상_시연.csv');assert.deepEqual(fs.readFileSync(await download.path()),data);
 const results=[];
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.waitForTimeout(150);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'overflow '+width);
  await page.locator('#preview-body tr').nth(10).scrollIntoViewIfNeeded();
  const header=await page.locator('.site-header').boundingBox();const summary=await page.locator('#preview-section > summary').boundingBox();assert(Math.abs(header.y)<1);assert(summary.y>=header.height-1);
  await page.screenshot({path:`/tmp/aurora-artifacts/preview-${width}.png`});results.push({width,overflow:false,sticky:true,rows:60});
 }
 await page.evaluate(()=>window.scrollTo(0,0));await page.locator('#admin-open').click();await page.locator('#admin-user').fill(auth.username);await page.locator('#admin-password').fill(auth.password);await page.locator('#admin-login button').click();await page.locator('#upload-form').waitFor({state:'visible'});
 await page.locator('#target-month').fill('2026-12');await page.locator('#csv-file').setInputFiles({name:'가상_다음달.csv',mimeType:'text/csv',buffer:data});await page.locator('#upload-submit').waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('#upload-submit').disabled);await page.locator('#upload-submit').click();await page.waitForFunction(()=>document.querySelector('#upload-status').textContent.includes('저장 완료'));
 const second=await browser.newContext();const another=await second.request.get('http://127.0.0.1:8000/api/latest');assert.equal((await another.json()).filename,'가상_다음달.csv');assert.deepEqual(await (await second.request.get('http://127.0.0.1:8000/api/download')).body(),data);
 await page.locator('#admin-logout').click();assert.equal(await page.locator('#upload-form').isHidden(),true);
 await page.locator('#logout').click();await page.locator('#login-screen').waitFor({state:'visible'});await page.reload();assert.equal(await page.locator('#workspace').isHidden(),true);
 assert.equal(errors.length,0,JSON.stringify(errors));
 fs.writeFileSync('/tmp/aurora-artifacts/browser-results.json',JSON.stringify({viewports:results,errors,downloadBytes:data.length,adminUpload:true,separateBrowserShared:true,refreshLogout:true},null,2));
 console.log('Browser checks passed:',JSON.stringify(results));await browser.close();
})().catch(e=>{console.error(e);process.exit(1)});
