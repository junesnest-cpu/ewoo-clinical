/**
 * 바이탈 데이터 API (Firestore 기반)
 * GET  /api/vitals?date=2026-04-14              — 해당 날짜 전체 바이탈 조회
 * GET  /api/vitals?chartNo=12345&days=14        — 특정 환자 최근 N일 바이탈 이력
 * POST /api/vitals { date, session, chartNo, vitals, userId } — 바이탈 저장
 */
import { adminDb } from '../../lib/firebaseAdmin';
import { requireAuth } from '../../lib/verifyAuth';

export default async function handler(req, res) {
  const a = await requireAuth(req, res);
  if (!a.ok && !a.audited) return;

  try {
    if (req.method === 'GET') {
      const { date, chartNo, days } = req.query;

      // 특정 환자 이력 조회
      if (chartNo && days) {
        const n = Math.min(parseInt(days) || 14, 30);
        const dates = [];
        for (let i = 0; i < n; i++) {
          const d = new Date();
          d.setDate(d.getDate() - i);
          dates.push(d.toISOString().slice(0, 10));
        }
        const snaps = await Promise.all(dates.map(dk => adminDb.doc(`vitals/${dk}`).get()));
        const history = [];
        snaps.forEach((snap, i) => {
          if (!snap.exists) return;
          const data = snap.data();
          const pv = data[chartNo];
          if (!pv) return;
          if (pv.am) history.push({ date: dates[i], session: 'am', ...pv.am });
          if (pv.pm) history.push({ date: dates[i], session: 'pm', ...pv.pm });
        });
        return res.json({ history });
      }

      // 해당 날짜 전체 바이탈
      const dateKey = date || new Date().toISOString().slice(0, 10);
      const snap = await adminDb.doc(`vitals/${dateKey}`).get();
      return res.json({ vitals: snap.exists ? snap.data() : {} });
    }

    if (req.method === 'POST') {
      const { date, session, chartNo, vitals, userId } = req.body;
      if (!date || !session || !chartNo) return res.status(400).json({ error: 'date, session, chartNo required' });

      const docRef = adminDb.doc(`vitals/${date}`);
      await docRef.set({
        [chartNo]: {
          [session]: { ...vitals, by: userId || '', at: new Date().toISOString() },
        },
      }, { merge: true });
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Vitals API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
