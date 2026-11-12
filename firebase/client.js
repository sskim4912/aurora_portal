import { initializeApp } from 'firebase/app';
import { getAuth, inMemoryPersistence, setPersistence, signInWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
const config = {
  apiKey: 'AIzaSyAmxPPDpKUXT9t_wsoM29f_jmtF1CFDvsw',
  authDomain: 'accommodation-fee.firebaseapp.com',
  projectId: 'accommodation-fee',
  storageBucket: 'accommodation-fee.firebasestorage.app',
  messagingSenderId: '415509159444',
  appId: '1:415509159444:web:c529480a42c1d483651101'
};
const base = 'https://asia-northeast3-accommodation-fee.cloudfunctions.net/rentCsvApi';
const auth = getAuth(initializeApp(config));
const initialized = setPersistence(auth, inMemoryPersistence);
export const firebaseService = {
  base,
  async login(username, password) {
    await initialized;
    const { user } = await signInWithEmailAndPassword(auth, username, password);
    if (!user.emailVerified) {
      try { await sendEmailVerification(user); } finally { await signOut(auth); }
      const error = new Error('관리자 이메일로 보낸 인증 메일을 확인한 후 다시 로그인해 주세요.');
      error.userMessage = error.message;
      throw error;
    }
    const response = await fetch(`${base}/api/session`, {headers:{Authorization:`Bearer ${await user.getIdToken()}`},cache:'no-store'});
    if (!response.ok || !(await response.json()).admin) {
      await signOut(auth);
      throw new Error('등록된 관리자만 업로드할 수 있습니다.');
    }
    return 'firebase';
  },
  async token() { return auth.currentUser ? auth.currentUser.getIdToken() : ''; },
  logout() { return signOut(auth); }
};
