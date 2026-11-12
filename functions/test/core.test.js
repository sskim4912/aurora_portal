import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requireAdmin, validateFile, publishFile, MAX_BYTES } from '../src/core.js';
const headers='순번,입력번호,증빙종류,거래처구분,거래처,작성일자,금액,리스예외사유,비용구분,계정과목,사용내역,발생일자,만기일자,지불유형';
const order='반영순서,1,3,4,5,6,7,16,19,20,22,23,24,28';
const body='1,2026.11.01,영수증,주민번호,00001,2026.11.01,"450,000",단기 임차,임차료,숙소,"가상 ""숙소"",\r\n<script>alert(1)</script>",2026.11.01,2026.11.30,예금';
const bytes=Buffer.from('\ufeff'+order+'\r\n'+headers+'\r\n'+body+'\r\n');
const args={bytes,filename:'가상.csv',month:'2026-11'};
test('authentication rejects absent, forged, non-admin and unverified tokens', async()=>{
  const allowed=new Set(['admin']);
  await assert.rejects(requireAdmin('',()=>{},allowed),{status:401});
  await assert.rejects(requireAdmin('Bearer forged',async()=>{throw Error();},allowed),{status:401});
  await assert.rejects(requireAdmin('Bearer user',async()=>({uid:'user',email_verified:true}),allowed),{status:403});
  await assert.rejects(requireAdmin('Bearer admin',async()=>({uid:'admin',email_verified:false}),allowed),{status:403});
  assert.equal((await requireAdmin('Bearer admin',async()=>({uid:'admin',email_verified:true}),allowed)).uid,'admin');
});
test('BOM, quotes, commas, embedded newlines and original bytes preserved',async()=>{
  const meta=validateFile(bytes,args.filename,args.month);assert.equal(meta.count,1);assert.equal(meta.size,bytes.length);
  let stored,pointer;
  const result=await publishFile({...args,storage:{save:async(path,b)=>{stored=Buffer.from(b);}},pointer:{set:async value=>{pointer=value;}}});
  assert.deepEqual(stored,bytes);assert.equal(pointer.version,result.version);assert.equal(pointer.filename,args.filename);
});
test('invalid header, duplicate sequence, bad quotes, filename, month and size rejected',()=>{
  for(const data of [Buffer.from('bad'),Buffer.concat([bytes,Buffer.from(body+'\r\n')]),Buffer.from(bytes.toString().replace('00001','ab"cd'))])assert.throws(()=>validateFile(data,args.filename,args.month));
  for(const filename of ['../x.csv','x.exe','x\r\n.csv'])assert.throws(()=>validateFile(bytes,filename,args.month));
  assert.throws(()=>validateFile(bytes,'x.csv','2026-13'));
  assert.throws(()=>validateFile(Buffer.alloc(MAX_BYTES+1),'x.csv',args.month));
});
test('storage failure never advances pointer',async()=>{
  let changed=false;
  await assert.rejects(publishFile({...args,storage:{save:async()=>{throw Error('failed');}},pointer:{set:async()=>{changed=true;}}}));
  assert.equal(changed,false);
});
test('pointer failure removes orphan and leaves previous pointer',async()=>{
  let previous={version:'old'},removed=false;
  await assert.rejects(publishFile({...args,storage:{save:async()=>{},remove:async()=>{removed=true;}},pointer:{set:async()=>{throw Error('failed');}}}));
  assert.equal(previous.version,'old');assert.equal(removed,true);
});
test('sequential publication points to the corresponding immutable original',async()=>{
  const objects=new Map();let current;
  const storage={save:async(p,b)=>objects.set(p,Buffer.from(b))};const pointer={set:async m=>{current=m;}};
  const first=await publishFile({...args,storage,pointer});
  const next=Buffer.from(bytes.toString().replace('00001','00002'));
  const second=await publishFile({...args,bytes:next,storage,pointer});
  assert.notEqual(first.version,second.version);assert.equal(current.version,second.version);assert.deepEqual(objects.get(current.objectPath),next);
});

test('UTF-8, CP949 and EUC-KR originals remain unchanged through publication',async()=>{
 const fixtures=JSON.parse(readFileSync(new URL('./encodings.json',import.meta.url)));
 for(const [encoding,base64] of Object.entries(fixtures)){
  const original=Buffer.from(base64,'base64');let stored;
  const meta=await publishFile({...args,bytes:original,storage:{save:async(path,data)=>{stored=Buffer.from(data);}},pointer:{set:async()=>{}}});
  assert.equal(meta.count,1,encoding);assert.deepEqual(stored,original,encoding);
 }
});
