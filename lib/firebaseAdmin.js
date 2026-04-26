/**
 * Firebase Admin SDK - 서버사이드 전용
 *   default app (Firestore): clinical 자체 데이터 (vitals, rounding 등)
 *   approval-admin: 사용자 토큰 검증·users 프로필 조회 (역할 체크용)
 *   ward-admin:     ward Auth 비밀번호 동기화·custom token 발급
 *
 * safeInit 패턴 (2026-04-26):
 *   ENV 누락·PEM 파싱 실패 시 throw 대신 null 반환.
 *   import 가 죽으면 모든 라우트가 500 → 호출 시점에서 null 체크로 안전 fallback 가능.
 *   호출자(verifyAuth, /api/* 핸들러)는 null 체크 후 사용.
 */
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';

function parsePK(raw) {
  let k = raw || '';
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  return k;
}

function safeInitNamed(name, projectId, clientEmail, privateKeyRaw, databaseURL) {
  const existing = admin.apps.find(a => a?.name === name);
  if (existing) return existing;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    console.warn(`[firebaseAdmin] ${name}: ENV 미설정 — 비활성 (audit 모드에서만 안전)`);
    return null;
  }

  try {
    return admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey: parsePK(privateKeyRaw) }),
      databaseURL,
    }, name);
  } catch (e) {
    console.warn(`[firebaseAdmin] ${name}: init 실패 (${e.code || e.name}: ${e.message}) — 비활성. literal \\n 형식인지 확인 (HOTFIX 2026-04-25)`);
    return null;
  }
}

// default app (Firestore — clinical 자체)
let defaultApp = admin.apps.find(a => a?.name === '[DEFAULT]') || null;
if (!defaultApp) {
  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey  = process.env.FIREBASE_PRIVATE_KEY;
  if (projectId && clientEmail && privateKey) {
    try {
      defaultApp = admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey: parsePK(privateKey) }),
      });
    } catch (e) {
      console.warn(`[firebaseAdmin] default(Firestore) init 실패 (${e.code || e.name}: ${e.message}) — Firestore 라우트는 503 fallback 권장`);
    }
  } else {
    console.warn('[firebaseAdmin] default(Firestore) ENV 미설정 — 비활성');
  }
}

const approvalAdminApp = safeInitNamed(
  'approval-admin',
  process.env.APPROVAL_FIREBASE_PROJECT_ID,
  process.env.APPROVAL_FIREBASE_CLIENT_EMAIL,
  process.env.APPROVAL_FIREBASE_PRIVATE_KEY,
  'https://ewoo-approval-default-rtdb.firebaseio.com',
);

const wardAdminApp = safeInitNamed(
  'ward-admin',
  process.env.WARD_FIREBASE_PROJECT_ID,
  process.env.WARD_FIREBASE_CLIENT_EMAIL,
  process.env.WARD_FIREBASE_PRIVATE_KEY,
  'https://ewoo-hospital-ward-default-rtdb.firebaseio.com',
);

export const adminDb = defaultApp ? getFirestore(defaultApp) : null;
export const approvalAdminAuth = approvalAdminApp?.auth() ?? null;
export const approvalAdminDb   = approvalAdminApp?.database() ?? null;
export const wardAdminAuth     = wardAdminApp?.auth() ?? null;
