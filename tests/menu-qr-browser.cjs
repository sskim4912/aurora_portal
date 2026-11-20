const {chromium}=require('playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
 try {
  const context=await browser.newContext({viewport:{width:1440,height:1100}});
  const page=await context.newPage(); const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://127.0.0.1:8003/');
  const buttons=page.locator('.menu-qr');
  assert.equal(await buttons.count(),8);
  assert.equal(await page.locator('.pending .menu-qr').count(),0);
  for(const image of await buttons.locator('img').all()) assert(await image.evaluate(i=>i.complete && i.naturalWidth>0));
  const first=buttons.nth(0), second=buttons.nth(1);
  await first.hover(); assert.equal(await first.getAttribute('aria-expanded'),'true');
  const rect=await first.boundingBox(), card=await page.locator('.menu-card').first().boundingBox();
  assert(Math.abs(rect.width/card.width-.8)<.02);
  await page.mouse.move(0,0); assert.equal(await first.getAttribute('aria-expanded'),'false');
  await first.click(); await page.mouse.move(0,0); assert.equal(await first.getAttribute('aria-expanded'),'true');
  await second.click(); assert.equal(await first.getAttribute('aria-expanded'),'false');
  assert.equal(await second.getAttribute('aria-expanded'),'true');
  await second.click(); assert.equal(await second.getAttribute('aria-expanded'),'false');
  await first.focus(); await page.keyboard.press('Enter'); assert.equal(await first.getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Escape'); assert.equal(await first.getAttribute('aria-expanded'),'false');
  await page.mouse.move(0,0); await first.focus(); await page.keyboard.press('Space');
  assert.equal(await first.getAttribute('aria-expanded'),'true');
  await page.locator('h1').click(); assert.equal(await first.getAttribute('aria-expanded'),'false');
  assert.equal(context.pages().length,1); // QR interaction must never open a menu tab.
  await first.hover(); await page.screenshot({path:'/tmp/aurora-menu-qr.png',fullPage:true});
  for(const width of [1024,768,600,390,320]) {
   await page.setViewportSize({width,height:1000});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   if(width<=600) assert.equal(await first.isVisible(),false);
  }
  assert.equal(await page.locator('a.card[href="https://aurora-asset-manager.sskim4912.workers.dev/"]').count(),1);
  assert.equal(await page.locator('a.card[target="_blank"]').count(),8);
  assert.deepEqual(errors,[]);
  console.log('Passed: 8 QR images; hover, 80% size, pin/toggle, switching, outside/Escape, keyboard, no navigation, mobile hiding, 5 viewport widths.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
