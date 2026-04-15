/**
 * 환자 검색 API — ewoo-hospital Firebase (EMR 동기화 데이터)에서 조회
 * GET /api/patients/search?q=이름
 */
import { hospitalRtdb } from '../../../lib/firebaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ patients: [] });

  try {
    const snap = await hospitalRtdb.ref('patients').once('value');
    const all = snap.val() || {};
    const found = Object.values(all)
      .filter(p => p.name?.includes(q))
      .map(p => ({
        chartNo:   p.chartNo || '',
        name:      p.name || '',
        birthDate: p.birthDate || p.birthYear || '',
        gender:    p.gender || '',
        phone:     p.phone || '',
        doctor:    p.doctor || '',
        diagnosis: p.diagnosis || '',
      }))
      .sort((a, b) => (a.name > b.name ? 1 : -1));

    return res.json({ patients: found });
  } catch (err) {
    console.error('Patient search error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
