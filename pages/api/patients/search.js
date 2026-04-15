/**
 * 환자 검색 API — ewoo-hospital Firebase (EMR 동기화 데이터)에서 조회
 * GET /api/patients/search?q=이름
 *
 * RTDB는 부분 문자열 검색을 지원하지 않으므로
 * orderByChild('name') + startAt/endAt로 prefix 검색 수행
 */
import { hospitalRtdb } from '../../../lib/firebaseAdmin';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ patients: [] });

  try {
    // prefix 검색: "홍" → "홍" ~ "홍\uf8ff"
    const snap = await hospitalRtdb.ref('patients')
      .orderByChild('name')
      .startAt(q)
      .endAt(q + '\uf8ff')
      .limitToFirst(20)
      .once('value');

    const found = [];
    snap.forEach(child => {
      const p = child.val();
      found.push({
        chartNo:   p.chartNo || '',
        name:      p.name || '',
        birthDate: p.birthDate || p.birthYear || '',
        gender:    p.gender || '',
        phone:     p.phone || '',
        doctor:    p.doctor || '',
        diagnosis: p.diagnosis || '',
      });
    });

    found.sort((a, b) => (a.name > b.name ? 1 : -1));
    return res.json({ patients: found });
  } catch (err) {
    console.error('Patient search error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
