const {chromium}=require('playwright');
const assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
(async()=>{
 const b=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],env:{...process.env,XDG_CONFIG_HOME:'/workspace/.cloud-setup/config',XDG_CACHE_HOME:'/workspace/.cloud-setup/cache'}});
 try{
  const context=await b.newContext();const p=await context.newPage();const errors=[];p.on('pageerror',e=>errors.push(e.message));
  const headers='순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형';
  const rows=[['1','00010','10,000','다'],['2','00002','900','나'],['3','00001','1,200','가'],['4','00001','1,200','가']];
  const fake=Buffer.from('\ufeff반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28\r\n'+headers+'\r\n'+rows.map(([n,client,amount,use])=>`${n},2026.11.13,영수증,주민번호,${client},2026.11.13,"${amount}",단기,임차료,숙소,${use},2026.11.13,2026.11.30,예금`).join('\r\n')+'\r\n');
  const meta={filename:'정렬_202611.csv',version:'a'.repeat(40),sha256:crypto.createHash('sha256').update(fake).digest('hex'),count:4,month:'2026-11',size:fake.length,encoding:'UTF-8',registeredAt:'2026-11-13T01:00:00Z'};
  await context.route('**/rent/latest.json',r=>r.fulfill({json:meta}));
  await context.route('**/rent/uploads/latest.json',r=>r.fulfill({status:404,body:''}));
  fs.writeFileSync('/workspace/aurora_portal/_site/rent/downloads/'+meta.filename,fake);
  await context.addInitScript(()=>sessionStorage.setItem('aurora-rent-session-v1',JSON.stringify({name:'정렬검증',unlocked:true})));
  await p.goto('http://127.0.0.1:8003/rent/');await p.locator('#preview-section summary').click();await p.locator('#preview-body tr').nth(3).waitFor();
  const ids=()=>p.locator('#preview-body tr td:first-child').allTextContents();
  for(const [name,up,down] of [['거래처',['3','4','2','1'],['1','2','3','4']],['금액',['2','3','4','1'],['1','3','4','2']],['사용내역',['3','4','2','1'],['1','2','3','4']]]){
   await p.getByRole('button',{name:name+' 오름차순',exact:true}).click();assert.deepEqual(await ids(),up);
   await p.getByRole('button',{name:name+' 내림차순',exact:true}).click();assert.deepEqual(await ids(),down);
  }
  await p.locator('#preview-reset').click();assert.deepEqual(await ids(),['1','2','3','4']);
  const [download]=await Promise.all([p.waitForEvent('download'),p.locator('#csv-download').click()]);assert.deepEqual(fs.readFileSync(await download.path()),fake);
  await p.setViewportSize({width:390,height:900});await p.locator('#preview-mobile-sort').selectOption('6:ascending');assert.deepEqual(await ids(),['2','3','4','1']);
  assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
  console.log('Passed: six sort directions, numeric amounts, leading zeros, stable ties, original order reset, unchanged CSV download, mobile sorting.');
 }finally{await b.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
