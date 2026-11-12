import { createHash, randomUUID } from 'node:crypto';
import { parsePreview } from '../../rent/csv-preview.js';
export const MAX_BYTES = 25 * 1024 * 1024;
export class RequestError extends Error {
  constructor(status, message) {super(message);this.status=status;}
}
export function validateFile(bytes, filename, month) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new RequestError(400,'CSV 파일 한 개, 최대 25MB가 필요합니다.');
  if (typeof filename !== 'string' || filename.length > 240 || !filename.toLowerCase().endsWith('.csv') || /[/\\\x00-\x1f\x7f]/u.test(filename)) throw new RequestError(400,'CSV 파일명을 확인해 주세요.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || '')) throw new RequestError(400,'대상 월을 선택해 주세요.');
  let parsed;
  try {parsed=parsePreview(bytes);}catch(error){throw new RequestError(400,error.message);}
  const numbers = new Set();
  for (const row of parsed.rows) {
    if (!/^[1-9]\d*$/.test(row[0]) || numbers.has(BigInt(row[0]).toString())) throw new RequestError(400,'순번은 중복 없는 양의 정수여야 합니다.');
    numbers.add(BigInt(row[0]).toString());
  }
  return {filename,month,count:parsed.count,size:bytes.length,encoding:parsed.encoding,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export async function publishFile({bytes,filename,month,storage,pointer}) {
  const metadata={...validateFile(bytes,filename,month),version:randomUUID(),registeredAt:new Date().toISOString()};
  const objectPath=`rent-csv/${metadata.version}.csv`;
  // Upload immutable original first; a failed write never changes the public pointer.
  await storage.save(objectPath,bytes);
  try {await pointer.set({...metadata,objectPath});}
  catch(error){await storage.remove(objectPath).catch(()=>{});throw error;}
  return metadata;
}
export async function requireAdmin(authorization, verify, allowedUids) {
  if (!authorization?.startsWith('Bearer ')) throw new RequestError(401,'관리자 인증이 필요합니다.');
  let user;
  try {user=await verify(authorization.slice(7));}catch{throw new RequestError(401,'관리자 인증이 만료됐거나 올바르지 않습니다.');}
  if (!allowedUids.has(user.uid) || user.email_verified !== true) throw new RequestError(403,'등록되고 이메일 인증된 관리자만 업로드할 수 있습니다.');
  return user;
}
