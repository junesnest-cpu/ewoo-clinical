import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabase } from 'firebase-admin/database';

function parsePK(raw) {
  let k = raw || '';
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  return k;
}

// ewoo-clinical (Firestore)
if (!getApps().length) {
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  parsePK(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });
}

// ewoo-hospital-ward (Realtime DB — EMR 동기화 환자 데이터)
let hospitalApp;
try { hospitalApp = getApp('hospital'); } catch {
  hospitalApp = initializeApp({
    credential: cert({
      projectId:   process.env.HOSPITAL_FIREBASE_PROJECT_ID,
      clientEmail: process.env.HOSPITAL_FIREBASE_CLIENT_EMAIL,
      privateKey:  parsePK(process.env.HOSPITAL_FIREBASE_PRIVATE_KEY),
    }),
    databaseURL: 'https://ewoo-hospital-ward-default-rtdb.firebaseio.com',
  }, 'hospital');
}

const adminDb = getFirestore();
const hospitalRtdb = getDatabase(hospitalApp);
export { adminDb, hospitalRtdb };
