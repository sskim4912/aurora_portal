const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');
const props = new Map([['GITHUB_TOKEN','test-token-not-real'], ['ADMIN_NAME','김성석'], ['ADMIN_PASSWORD_SHA256',crypto.createHash('sha256').update('test-password').digest('hex')]]);
const sessions = new Map();
let writes = 0, release = 0, committedMeta = null;
const routes = [];
const context = {
  Date, JSON, Error,
  Utilities: {
    DigestAlgorithm:{SHA_256:'sha256'},
    computeDigest:(_,data)=>Array.from(crypto.createHash('sha256').update(typeof data==='string'?data:Buffer.from(data)).digest()),
    getUuid:()=>crypto.randomUUID(),
    base64Decode:s=>Array.from(Buffer.from(s,'base64')),
    newBlob:(bytes)=>({getDataAsString:encoding=>new TextDecoder(encoding==='MS949'?'euc-kr':'utf-8').decode(Buffer.from(bytes))}),
    unzip:()=>['[Content_Types].xml','xl/workbook.xml'].map(name=>({getName:()=>name,getBytes:()=>[1,2,3]}))
  },
  PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v)})},
  CacheService:{getScriptCache:()=>({get:k=>sessions.get(k),put:(k,v)=>sessions.set(k,v)})},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>release++})},
  ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({setMimeType:()=>JSON.parse(s)})},
  UrlFetchApp:{fetch:(url, options)=>{
    assert(url.startsWith('https://api.github.com/repos/sskim4912/aurora_portal/'));
    assert.equal(options.headers.Authorization,'Bearer test-token-not-real');
    const path=url.split('aurora_portal')[1];routes.push(path);
    let body,code=200;
    if(path==='/git/ref/heads/main')body={object:{sha:'a'.repeat(40)}};
    else if(path==='/git/commits/'+'a'.repeat(40))body={tree:{sha:'tree'}};
    else if(path.startsWith('/contents/')){
      code=committedMeta?200:404;body=committedMeta?{content:Buffer.from(committedMeta).toString('base64')}:{message:'not found'};
    } else {
      writes++;
      if(path==='/git/blobs')body={sha:'blob'};
      else if(path==='/git/trees'){
        const tree=JSON.parse(options.payload);
        assert.deepEqual(tree.tree.map(t=>t.path),['rent/uploads/latest.csv','rent/uploads/latest.json']);
        committedMeta=tree.tree[1].content;body={sha:'new-tree'};
      }else if(path==='/git/commits')body={sha:'b'.repeat(40)};
      else if(path==='/git/refs/heads/main'){
        assert.equal(JSON.parse(options.payload).force,false);body={};
      }else throw Error('Unexpected route '+path);
    }
    return {getResponseCode:()=>code,getContentText:()=>JSON.stringify(body)};
  }}
};
vm.createContext(context);vm.runInContext(fs.readFileSync('server/Code.js','utf8'),context);
function post(input){return context.doPost({postData:{contents:JSON.stringify(input)}})}
assert.equal(post({action:'login',name:'김성석',password:'bad'}).ok,false);
assert.equal(post({action:'login',name:'other',password:'test-password'}).ok,false);
assert.equal(post({action:'upload',session:'0'.repeat(64)}).ok,false);
assert.equal(writes,0);
const login=post({action:'login',name:'김성석',password:'test-password'});
assert(login.ok);assert.equal(login.data.session.length,64);
const sample='반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28\n순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형\n1,2026.11.13,영수증,주민번호,00001,2026.11.13,1000,단기,임차료,숙소,가상자료,2026.11.13,2026.11.30,예금\n';
const input={action:'upload',session:login.data.session,filename:'숙소.csv',content:Buffer.from(sample).toString('base64'),requestId:crypto.randomUUID()};
const legacy=context.csvFile({...input,content:'ud2/tbz4vK0sMSwzLDQsNSw2LDcsMTYsMTksMjAsMjIsMjMsMjQsMjgKvPi5+CzA1LfCufjIoyzB9br5wb63+Sywxbehw7OxuLrQLLDFt6HDsyzA27y6wM/A2iyx3b7XLLiuvbq/ub/cu+fAryy68b/rsbi60Cyw6MGksPq48Sy757/rs7u/qiy537v9wM/A2iy4uLHiwM/A2izB9rrSwK/H/AoxLDIwMjYuMTEuMTMsv7W89sH1LMHWuc65+MijLDAwMDAxLDIwMjYuMTEuMTMsMTAwMCy03LHiLMDTwve34Sy897zSLLChu/PA2rfhLDIwMjYuMTEuMTMsMjAyNi4xMS4zMCy/ubHdCg=='});
assert.equal(legacy.encoding,'CP949 / EUC-KR');assert.equal(legacy.count,1);
assert.equal(context.csvFile({...input,content:Buffer.from(sample.replace('1000','\"1,000\"')).toString('base64')}).count,1);
assert.equal(post({...input,filename:'../x.csv'}).ok,false);
assert.equal(post({...input,filename:'x.xlsm'}).ok,false);
assert.equal(writes,0);
assert.equal(post({...input,content:Buffer.from('bad CSV').toString('base64')}).ok,false);
assert.equal(post({...input,content:Buffer.from(sample+sample.split('\n')[2]+'\n').toString('base64')}).ok,false);
const result=post(input);assert(result.ok,JSON.stringify(result));assert.equal(writes,4);assert.equal(release,1);
assert.equal(result.data.filename,input.filename);assert(result.data.downloadUrl.includes('b'.repeat(40)));
assert.equal(post(input).data.commit,result.data.commit);assert.equal(writes,4);
assert.equal(post({...input,content:Buffer.from('changed').toString('base64')}).ok,false);
assert.equal(writes,4);
props.delete('LAST_UPLOAD');
const recovered=post(input);assert(recovered.ok);assert.equal(writes,4);
assert(!JSON.stringify(result).includes('test-token-not-real'));
assert.equal(post({action:'delete',session:login.data.session}).ok,false);
console.log('Passed: server authentication, invalid files, fixed paths, atomic commit, non-force update, lock release, retry recovery, token redaction.');
