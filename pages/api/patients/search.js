/**
 * 환자 검색 API — ewoo-hospital Firebase RTDB REST API로 조회
 * GET /api/patients/search?q=이름
 *
 * Firebase Admin RTDB SDK는 WebSocket 기반 → Vercel 서버리스에서 타임아웃
 * → firebase-admin credential로 access token 발급 후 REST API 호출
 */
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';

const DB_URL = 'https://ewoo-hospital-ward-default-rtdb.firebaseio.com';

function getHospitalApp() {
  try { return getApp('hospital'); } catch {
    const pk = (process.env.HOSPITAL_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
    return initializeApp({
      credential: cert({
        projectId:   process.env.HOSPITAL_FIREBASE_PROJECT_ID,
        clientEmail: process.env.HOSPITAL_FIREBASE_CLIENT_EMAIL,
        privateKey:  pk,
      }),
    }, 'hospital');
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ patients: [] });

  try {
    const app = getHospitalApp();
    const tokenResult = await app.options.credential.getAccessToken();
    const accessToken = tokenResult.access_token;

    // RTDB REST API — orderBy + startAt/endAt prefix 검색
    const params = new URLSearchParams({
      orderBy: '"name"',
      startAt: JSON.stringify(q),
      endAt:   JSON.stringify(q + '\uf8ff'),
      limitToFirst: '20',
    });

    const r = await fetch(`${DB_URL}/patients.json?${params}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` },
    });

    if (!r.ok) {
      const body = await r.text();
      console.error('RTDB REST error:', r.status, body);
      return res.status(502).json({ error: 'Firebase query failed', detail: body });
    }

    const data = await r.json();
    const found = Object.values(data || {}).map(p => ({
      chartNo:   p.chartNo || '',
      name:      p.name || '',
      birthDate: p.birthDate || p.birthYear || '',
      gender:    p.gender || '',
      phone:     p.phone || '',
      doctor:    p.doctor || '',
      diagnosis: p.diagnosis || '',
    })).sort((a, b) => (a.name > b.name ? 1 : -1));

    return res.json({ patients: found });
  } catch (err) {
    console.error('Patient search error:', err.stack || err.message);
    return res.status(500).json({ error: err.message });
  }
}
