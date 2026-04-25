/**
 * 병동 라운딩 요약 API
 * GET /api/emr/rounding-summary
 *
 * Firestore roundingSummary/{YYYY-MM-DD} 에서 읽기 (30분 주기 동기화 데이터)
 * Firestore에 없으면 EMR 프록시로 fallback
 */
import { adminDb } from '../../../lib/firebaseAdmin';
import { requireAuth } from '../../../lib/verifyAuth';

const EMR_PROXY_URL = process.env.EMR_PROXY_URL;
const EMR_PROXY_KEY = process.env.EMR_PROXY_KEY || 'ewoo-emr-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const a = await requireAuth(req, res);
  if (!a.ok && !a.audited) return;

  const dateKey = new Date().toISOString().slice(0, 10);

  // 1) Firestore에서 읽기
  try {
    const snap = await adminDb.doc(`roundingSummary/${dateKey}`).get();
    if (snap.exists) {
      const data = snap.data();
      return res.json({ patients: data.patients || [], lastSync: data.lastSync });
    }
  } catch (e) {
    console.error('Firestore read error:', e.message);
  }

  // 2) Firestore에 없으면 EMR 프록시 fallback
  if (!EMR_PROXY_URL) {
    return res.json({ patients: [], lastSync: null });
  }

  try {
    const r = await fetch(`${EMR_PROXY_URL}/api/emr/rounding-summary`, {
      headers: { 'x-api-key': EMR_PROXY_KEY },
    });
    if (r.ok) {
      const data = await r.json();
      return res.json(data);
    }
  } catch (e) {
    console.error('EMR proxy fallback error:', e.message);
  }

  return res.json({ patients: [], lastSync: null });
}
