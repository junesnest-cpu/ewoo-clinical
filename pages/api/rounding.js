/**
 * 라운딩 데이터 API (Firestore 기반)
 * GET  /api/rounding?date=2026-04-13              — 환자 목록 조회
 * POST /api/rounding { date, userId, chartNo, note } — 참고사항 저장
 * GET  /api/rounding?date=2026-04-13&notes=userId  — 참고사항 조회
 */
import { adminDb } from '../../lib/firebaseAdmin';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { date, notes: userId } = req.query;
      const dateKey = date || new Date().toISOString().slice(0, 10);

      if (userId) {
        // 특정 사용자의 참고사항 조회
        const snap = await adminDb.doc(`roundingNotes/${dateKey}_${userId}`).get();
        return res.json({ notes: snap.exists ? snap.data() : {} });
      }

      // 환자 목록 조회 (Firestore에서)
      const snap = await adminDb.doc(`roundingSync/${dateKey}`).get();
      if (!snap.exists) return res.json({ patients: [], lastSync: null });
      const data = snap.data();
      return res.json({ patients: data.patients || [], lastSync: data.lastSync, count: data.count });
    }

    if (req.method === 'POST') {
      const { date, userId, chartNo, note } = req.body;
      if (!date || !userId || !chartNo) return res.status(400).json({ error: 'date, userId, chartNo required' });

      const docRef = adminDb.doc(`roundingNotes/${date}_${userId}`);
      await docRef.set({ [chartNo]: note || '', updatedAt: new Date().toISOString() }, { merge: true });
      return res.json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('Rounding API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
