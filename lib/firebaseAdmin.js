import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

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

const adminDb = getFirestore();
export { adminDb };
