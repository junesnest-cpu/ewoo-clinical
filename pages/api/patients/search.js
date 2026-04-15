/**
 * 환자 검색 API — ewoo-hospital Firebase RTDB REST API로 조회
 * GET /api/patients/search?q=이름
 *
 * Vercel 서버리스에서 Firebase Admin RTDB SDK는 WebSocket 연결 문제로
 * 타임아웃 발생 → REST API(HTTP)로 대체
 */
import { GoogleAuth } from 'google-auth-library';

const DB_URL = 'https://ewoo-hospital-ward-default-rtdb.firebaseio.com';

let cachedAuth;
function getAuth() {
  if (cachedAuth) return cachedAuth;
  const pk = (process.env.HOSPITAL_FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n');
  cachedAuth = new GoogleAuth({
    credentials: {
      client_email: process.env.HOSPITAL_FIREBASE_CLIENT_EMAIL,
      private_key:  pk,
    },
    scopes: ['https://www.googleapis.com/auth/firebase.database'],
  });
  return cachedAuth;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ patients: [] });

  try {
    const auth = getAuth();
    const client = await auth.getClient();
    const token = await client.getAccessToken();

    // RTDB REST API — orderBy + startAt/endAt prefix 검색
    const params = new URLSearchParams({
      orderBy: '"name"',
      startAt: JSON.stringify(q),
      endAt:   JSON.stringify(q + '\uf8ff'),
      limitToFirst: '20',
      auth: token.token,
    });

    const r = await fetch(`${DB_URL}/patients.json?${params}`);
    if (!r.ok) {
      const body = await r.text();
      console.error('RTDB REST error:', r.status, body);
      return res.status(502).json({ error: 'Firebase query failed' });
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
