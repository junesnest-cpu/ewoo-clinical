/**
 * 양방향 Auth 동기화 (ewoo-clinical 버전)
 * approval·ward 중 한쪽만 인증되면 반대쪽 계정 생성/비밀번호 업데이트
 */
import { approvalAdminAuth, approvalAdminDb, wardAdminAuth } from '../../../lib/firebaseAdmin';

const APPROVAL_API_KEY = 'AIzaSyCajixUUY0le1NhvO2hMCJoPA_pffjs1rE';
const WARD_API_KEY     = 'AIzaSyAgr-alU71ZZj12S3MvCQKJQVdS6w-G3E4';

async function signInREST(apiKey, email, password) {
  const res = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    }
  );
  if (!res.ok) return null;
  return res.json();
}

async function ensureAccount(adminAuth, email, password, preferredUid) {
  let user;
  try {
    user = await adminAuth.getUserByEmail(email);
    await adminAuth.updateUser(user.uid, { password });
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    try {
      user = await adminAuth.createUser({ uid: preferredUid, email, password });
    } catch {
      user = await adminAuth.createUser({ email, password });
    }
  }
  return user;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email·password required' });

  try {
    const [approvalAuth, wardAuthRes] = await Promise.all([
      signInREST(APPROVAL_API_KEY, email, password),
      signInREST(WARD_API_KEY, email, password),
    ]);

    if (!approvalAuth && !wardAuthRes) {
      return res.status(401).json({ error: 'invalid credentials' });
    }

    if (approvalAuth && !wardAuthRes) {
      await ensureAccount(wardAdminAuth, email, password, approvalAuth.localId);
    } else if (!approvalAuth && wardAuthRes) {
      const user = await ensureAccount(approvalAdminAuth, email, password, wardAuthRes.localId);
      const emailKey = email.replace(/\./g, ',').replace(/@/g, '_at_');
      const profRef = approvalAdminDb.ref(`users/${emailKey}`);
      const snap = await profRef.once('value');
      if (snap.exists()) await profRef.update({ uid: user.uid });
    }

    return res.status(200).json({ ok: true, approvalOk: !!approvalAuth, wardOk: !!wardAuthRes });
  } catch (e) {
    console.error('sync error:', e.message);
    return res.status(500).json({ error: e.message });
  }
}
