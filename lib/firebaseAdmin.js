import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

function parsePK(raw) {
  let k = raw || '';
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  return k;
}

function initApp(name, config) {
  const existing = admin.apps.find(a => a?.name === name);
  if (existing) return existing;
  return admin.initializeApp(config, name);
}

// ewoo-clinical (Firestore) — 기본 앱
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  parsePK(process.env.FIREBASE_PRIVATE_KEY),
    }),
  });
}

// ewoo-approval (사용자 통합 Auth)
const approvalAdminApp = initApp('approval-admin', {
  credential: admin.credential.cert({
    projectId:   process.env.APPROVAL_FIREBASE_PROJECT_ID,
    clientEmail: process.env.APPROVAL_FIREBASE_CLIENT_EMAIL,
    privateKey:  parsePK(process.env.APPROVAL_FIREBASE_PRIVATE_KEY),
  }),
  databaseURL: 'https://ewoo-approval-default-rtdb.firebaseio.com',
});

// ewoo-hospital-ward (ward Auth 동기화용)
const wardAdminApp = initApp('ward-admin', {
  credential: admin.credential.cert({
    projectId:   process.env.WARD_FIREBASE_PROJECT_ID,
    clientEmail: process.env.WARD_FIREBASE_CLIENT_EMAIL,
    privateKey:  parsePK(process.env.WARD_FIREBASE_PRIVATE_KEY),
  }),
  databaseURL: 'https://ewoo-hospital-ward-default-rtdb.firebaseio.com',
});

const adminDb = getFirestore();
export const approvalAdminAuth = approvalAdminApp.auth();
export const approvalAdminDb   = approvalAdminApp.database();
export const wardAdminAuth     = wardAdminApp.auth();
export { adminDb };
