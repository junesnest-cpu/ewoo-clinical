import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';
import publicConfig from './firebasePublicConfig.json';

// ewoo-clinical — Firestore (임상서식 데이터)
const clinicalConfig = {
  apiKey:            process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain:        process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId:         process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket:     process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId:             process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// ewoo-approval — Auth + Realtime DB (사용자 인증·프로필 공유)
const approvalConfig = {
  apiKey:      process.env.NEXT_PUBLIC_APPROVAL_API_KEY,
  authDomain:  process.env.NEXT_PUBLIC_APPROVAL_AUTH_DOMAIN,
  projectId:   process.env.NEXT_PUBLIC_APPROVAL_PROJECT_ID,
  databaseURL: 'https://ewoo-approval-default-rtdb.firebaseio.com',
};

// ewoo-hospital-ward — Realtime DB (치료계획·EMR 검증 데이터 읽기 전용)
// Firebase client config는 공개 식별자이므로 firebasePublicConfig.json 단일 소스
const wardConfig = publicConfig.ward;

const app = getApps().length ? getApps()[0] : initializeApp(clinicalConfig);

let approvalApp;
try { approvalApp = getApp('approval'); } catch { approvalApp = initializeApp(approvalConfig, 'approval'); }

let wardApp;
try { wardApp = getApp('ward'); } catch { wardApp = initializeApp(wardConfig, 'ward'); }

const db         = getFirestore(app);
const auth       = getAuth(approvalApp);
const approvalDb = getDatabase(approvalApp);
const wardDb     = getDatabase(wardApp);
const wardAuth   = getAuth(wardApp);  // ward RTDB rules 통과용 병행 세션

export { db, auth, approvalDb, wardDb, wardAuth };
