import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// ewoo-clinical — Firestore (임상서식 데이터)
const clinicalConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// ewoo-approval — Auth (사용자 인증 공유)
const approvalConfig = {
  apiKey:      process.env.NEXT_PUBLIC_APPROVAL_API_KEY,
  authDomain:  process.env.NEXT_PUBLIC_APPROVAL_AUTH_DOMAIN,
  projectId:   process.env.NEXT_PUBLIC_APPROVAL_PROJECT_ID,
};

const app = getApps().length ? getApps()[0] : initializeApp(clinicalConfig);

let approvalApp;
try { approvalApp = getApp('approval'); } catch { approvalApp = initializeApp(approvalConfig, 'approval'); }

const db   = getFirestore(app);
const auth = getAuth(approvalApp);

export { db, auth };
