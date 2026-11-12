const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs');const crypto=require('node:crypto');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 const origin='http://127.0.0.1:8003';const output='/workspace/aurora-artifacts';fs.mkdirSync(output,{recursive:true});
 try {
  // Two separate contexts download the actual prepared original. Never log/render its data.
  const a=await browser.newContext(),b=await browser.newContext();
  const meta=await (await a.request.get(origin+'/rent/latest.json')).json();
  const bytesA=await (await a.request.get(origin+'/rent/'+meta.href)).body();
  const bytesB=await (await b.request.get(origin+'/rent/'+meta.href)).body();
  assert.deepEqual(bytesA,bytesB);assert.equal(crypto.createHash('sha256').update(bytesA).digest('hex'),meta.sha256);
  const originalPage=await a.newPage();await originalPage.goto(origin+'/rent/');
  await originalPage.evaluate(()=>sessionStorage.setItem('aurora-rent-session-v1',JSON.stringify({name:'가상 시연',unlocked:true})));
  await originalPage.reload();await originalPage.locator('#workspace').waitFor({state:'visible'});
  const [originalDownload]=await Promise.all([originalPage.waitForEvent('download'),originalPage.locator('#csv-download').click()]);
  assert.equal(originalDownload.suggestedFilename(),meta.filename);
  assert.deepEqual(fs.readFileSync(await originalDownload.path()),bytesA);
  await a.close();await b.close();
  const context=await browser.newContext();const page=await context.newPage();const errors=[];const unexpected=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith(origin))unexpected.push(r.url());});
  const order='반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28';const headers='순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형';
  const fake=Buffer.from('\ufeff'+order+'\r\n'+headers+'\r\n'+Array.from({length:60},(_,i)=>`${i+1},2026.11.01,영수증,주민번호,00001,2026.11.01,"450,000",단기 임차,임차료,숙소,"가상 숙소 ${i+1} <script>window.injected=true</script>",2026.11.01,2026.11.30,예금`).join('\r\n')+'\r\n');
  const fakeMeta={...meta,filename:'가상_20261101_1.csv',month:'2026-11',count:60,size:fake.length,sha256:crypto.createHash('sha256').update(fake).digest('hex'),registeredAt:'2026-11-12T00:00:00Z'};
  await context.route('**/rent/latest.json',r=>r.fulfill({contentType:'application/json',body:JSON.stringify(fakeMeta)}));
  await context.route('**/rent/downloads/**',r=>r.fulfill({contentType:'text/csv',headers:{'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(fakeMeta.filename)},body:fake}));
  await page.goto(origin+'/rent/');assert.equal(await page.locator('#password').getAttribute('type'),'password');
  await page.locator('#name').fill('가상 시연');await page.locator('#password').fill(process.env.RENT_TEST_UI_PASSWORD);await page.locator('#login-submit').click();await page.locator('#workspace').waitFor({state:'visible'});
  await page.reload();await page.locator('#workspace').waitFor({state:'visible'});await page.waitForFunction(()=>document.querySelector('#latest-info').textContent.includes('가상_20261101_1.csv'));
  assert.equal(await page.locator('#preview-section').getAttribute('open'),null);
  await page.locator('#admin-guide summary').click();assert((await page.locator('#github-upload').getAttribute('href')).endsWith('/upload/main/rent/downloads'));assert.equal(await page.locator('#github-upload').getAttribute('target'),'_blank');await page.locator('#admin-guide summary').click();
  assert.equal(await page.locator('#csv-download').getAttribute('download'),fakeMeta.filename);
  assert.equal(await page.locator('#program-download').getAttribute('href'),'https://1drv.ms/u/c/aada2604ee5983ad/IQCDA2ymGuNdS4yapRTnLPqLAZZSCGvDHOTKGCrTj1ouiRM?e=YSmxbV');
  for(const width of [320,390,768,1440]){
   await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));await page.screenshot({path:`${output}/github-steps-${width}.png`,fullPage:true});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('#preview-section summary').click();await page.waitForFunction(()=>document.querySelectorAll('#preview-body tr').length===60);
   assert.equal(await page.evaluate(()=>window.injected),undefined);
   await page.locator('#preview-body tr').nth(20).scrollIntoViewIfNeeded();
   const header=await page.locator('.site-header').boundingBox();const toolbar=await page.locator('#preview-section summary').boundingBox();assert(Math.abs(header.y)<1);assert(toolbar.y>=header.height-1);
   const label=await (width>800?page.locator('#preview-head th').first():page.locator('#preview-body tr').nth(20).locator('td').first()).boundingBox();assert(label.y>=toolbar.y+toolbar.height-2);
   await page.screenshot({path:`${output}/github-preview-${width}.png`});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('#preview-section summary').click();
  }
  await page.locator('#program-guide summary').click();assert.equal(await page.locator('.execution-steps li').count(),9);await page.locator('#program-guide summary').click();
  await page.locator('#logout').click();await page.reload();assert(await page.locator('#workspace').isHidden());
  await page.goto(origin+'/');assert.equal(await page.locator('a[href="rent/"]').getAttribute('target'),'_blank');assert.deepEqual(errors,[]);assert.deepEqual(unexpected.filter(url=>url!=='https://raw.githubusercontent.com/sskim4912/receipt/main/src/assets/gs-construction-logo.png'),[]);
  // Metadata outage still leaves the correct baked original download URL.
  const fallback=await browser.newContext();await fallback.route('**/latest.json',r=>r.fulfill({status:503,body:''}));const p=await fallback.newPage();await p.goto(origin+'/rent/');
  assert((await p.locator('#csv-download').getAttribute('href')).startsWith('downloads/'));await fallback.close();
  console.log('Passed: independent downloads match original hash; login/refresh/logout; GitHub links; 4 widths; preview/escape/sticky; no JS errors or external services.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
