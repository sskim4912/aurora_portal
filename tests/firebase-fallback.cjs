// Simulates an unavailable Firebase API; never uploads or displays original CSV data.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH || '/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const context=await browser.newContext();const page=await context.newPage();const errors=[];let sdkLoaded=false;
  page.on('pageerror',error=>errors.push(error.message));
  await context.route('https://sskim4912.github.io/aurora_portal/**',async route=>{
   const pathname=new URL(route.request().url()).pathname.replace('/aurora_portal','');
   if(pathname.includes('/vendor/firebase-client.js'))sdkLoaded=true;
   const response=await context.request.get('http://127.0.0.1:8000'+pathname);
   await route.fulfill({status:response.status(),headers:response.headers(),body:await response.body()});
  });
  await context.route('https://asia-northeast3-accommodation-fee.cloudfunctions.net/**',route=>route.fulfill({status:503,contentType:'application/json',headers:{'Access-Control-Allow-Origin':'https://sskim4912.github.io'},body:JSON.stringify({error:'Synthetic unavailable API'})}));
  await page.goto('https://sskim4912.github.io/aurora_portal/rent/');
  await page.evaluate(()=>sessionStorage.setItem('aurora-rent-session-v1',JSON.stringify({name:'가상 시연',unlocked:true})));
  await page.reload();
  await page.waitForFunction(()=>document.querySelector('#service-status').textContent.includes('미연결'));
  assert(sdkLoaded);assert(await page.locator('#admin-open').isHidden());assert(await page.locator('#upload-form').isHidden());
  assert((await page.locator('#csv-download').getAttribute('href')).startsWith('downloads/'));
  assert.equal(await page.locator('#preview-section').getAttribute('open'),null);
  assert.deepEqual(errors,[]);console.log('Firebase SDK loads; unavailable API preserves original download and hides upload. No JS errors.');
 } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exit(1);});
