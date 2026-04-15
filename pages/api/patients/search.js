/**
 * 환자 검색 API — ewoo-hospital Firebase RTDB REST API로 조회
 * GET /api/patients/search?q=이름
 *
 * 1) ewoo-clinical Admin SDK로 custom token 발급
 * 2) Firebase Auth REST API로 ID token 교환
 * 3) RTDB REST API로 환자 prefix 검색
 */

const DB_URL = 'https://ewoo-hospital-ward-default-rtdb.firebaseio.com';
const HOSPITAL_API_KEY = 'AIzaSyAgr-alU71ZZj12S3MvCQKJQVdS6w-G3E4';

// ewoo-hospital-ward Firebase Auth로 ID 토큰 발급
let cachedIdToken = null;
let tokenExpiry = 0;

async function getIdToken() {
  if (cachedIdToken && Date.now() < tokenExpiry) return cachedIdToken;

  // firebase-admin (ewoo-clinical)에서 custom token 생성은 불가 (다른 프로젝트)
  // 대신 ewoo-hospital-ward의 Anonymous Auth 또는 REST API sign-in 사용
  // Anonymous sign-in으로 ID token 획득
  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${HOSPITAL_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ returnSecureToken: true }),
    }
  );

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Auth failed: ${err}`);
  }

  const data = await r.json();
  cachedIdToken = data.idToken;
  // expiresIn is in seconds, cache with 5min buffer
  tokenExpiry = Date.now() + (parseInt(data.expiresIn, 10) - 300) * 1000;
  return cachedIdToken;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ patients: [] });

  try {
    const token = await getIdToken();

    // RTDB REST API — orderBy + startAt/endAt prefix 검색
    const params = new URLSearchParams({
      orderBy: '"name"',
      startAt: JSON.stringify(q),
      endAt:   JSON.stringify(q + '\uf8ff'),
      limitToFirst: '20',
      auth: token,
    });

    const r = await fetch(`${DB_URL}/patients.json?${params}`);
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
