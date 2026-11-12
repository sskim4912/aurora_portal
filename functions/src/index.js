import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { publishFile, requireAdmin, RequestError } from './core.js';
initializeApp();
const adminUids=defineString('RENT_ADMIN_UIDS',{description:'Comma-separated Firebase Authentication UIDs allowed to upload CSV'});
const allowedOrigin='https://sskim4912.github.io';
export const rentCsvApi=onRequest({region:'asia-northeast3',memory:'512MiB',timeoutSeconds:120,maxInstances:3,invoker:'public'},async(req,res)=>{
  res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');
  const origin=req.get('Origin');
  if(origin && origin!==allowedOrigin)return res.status(403).json({error:'허용되지 않은 출처입니다.'});
  if(origin){res.set('Access-Control-Allow-Origin',origin);res.set('Vary','Origin');}
  if(req.method==='OPTIONS'){
    res.set('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers','Authorization, Content-Type, X-Filename, X-Target-Month');
    return res.status(204).send('');
  }
  const path=req.path;
  const pointer=getFirestore().doc('rentCsv/latest');
  const bucket=getStorage().bucket('accommodation-fee.firebasestorage.app');
  try {
    if(req.method==='GET' && path==='/api/session'){
      if(!req.get('Authorization'))return res.json({admin:false});
      await requireAdmin(req.get('Authorization'),t=>getAuth().verifyIdToken(t,true),new Set(adminUids.value().split(',').map(s=>s.trim()).filter(Boolean)));
      return res.json({admin:true});
    }
    if(req.method==='POST' && path==='/api/upload'){
      await requireAdmin(req.get('Authorization'),t=>getAuth().verifyIdToken(t,true),new Set(adminUids.value().split(',').map(s=>s.trim()).filter(Boolean)));
      if(!req.is('application/octet-stream'))throw new RequestError(400,'CSV 원본 파일 한 개가 필요합니다.');
      let filename;try{filename=decodeURIComponent(req.get('X-Filename')||'');}catch{throw new RequestError(400,'파일명을 확인해 주세요.');}
      const metadata=await publishFile({bytes:req.rawBody,filename,month:req.get('X-Target-Month'),pointer,
        storage:{save:(path,bytes)=>bucket.file(path).save(bytes,{resumable:false,validation:'crc32c',preconditionOpts:{ifGenerationMatch:0},metadata:{contentType:'text/csv',cacheControl:'private, no-store'}}),remove:path=>bucket.file(path).delete()}});
      return res.json(metadata);
    }
    if(req.method==='GET' && ['/api/latest','/api/download'].includes(path)){
      const snapshot=await pointer.get();
      if(!snapshot.exists)throw new RequestError(404,'등록된 CSV가 없습니다. 기존 공통 CSV를 이용해 주세요.');
      const {objectPath,...metadata}=snapshot.data();
      if(path==='/api/latest')return res.json(metadata);
      if(req.query.v && req.query.v!==metadata.version)throw new RequestError(409,'최신 파일이 변경됐습니다. 새로고침해 주세요.');
      const [bytes]=await bucket.file(objectPath).download({validation:'crc32c'});
      res.set('Content-Type','text/csv');res.set('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(metadata.filename)}`);
      return res.send(bytes);
    }
    return res.status(404).json({error:'요청한 경로가 없습니다.'});
  }catch(error){
    // Never log credentials, file content or raw SDK errors.
    return res.status(error instanceof RequestError?error.status:503).json({error:error instanceof RequestError?error.message:'처리하지 못했습니다. 기존 정상 파일은 유지됩니다.'});
  }
});
