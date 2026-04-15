/**
 * 환자 검색 API — ewoo-hospital Firebase RTDB REST API로 조회
 * GET /api/patients/search?q=이름
 *
 * ewoo-hospital-ward Firebase Auth(email/password)로 로그인 후
 * RTDB REST API로 전체 환자 데이터를 가져와서 서버에서 이름 필터링
 */

const DB_URL = 'https://ewoo-hospital-ward-default-rtdb.firebaseio.com';
const API_KEY = 'AIzaSyAgr-alU71ZZj12S3MvCQKJQVdS6w-G3E4';

// 서비스 계정용 고정 로그인 (환경변수)
const LOGIN_EMAIL = process.env.HOSPITAL_LOGIN_EMAIL;
const LOGIN_PW    = process.env.HOSPITAL_LOGIN_PW;

// 토큰 + 환자 데이터 캐시
let cachedToken = null;
let tokenExpiry = 0;
let cachedPatients = null;
let patientsExpiry = 0;

async function getIdToken() {
  if (cachedToken && Date.now() < tokenExpiry) return cachedToken;

  const body = JSON.stringify({
    email: LOGIN_EMAIL,
    password: LOGIN_PW,
    returnSecureToken: true,
  });

  const r = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${API_KEY}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }
  );

  if (!r.ok) {
    const err = await r.text();
    throw new Error(`Auth failed: ${err}`);
  }

  const data = await r.json();
  cachedToken = data.idToken;
  tokenExpiry = Date.now() + (parseInt(data.expiresIn, 10) - 300) * 1000;
  return cachedToken;
}

async function getPatients() {
  // 5분 캐시
  if (cachedPatients && Date.now() < patientsExpiry) return cachedPatients;

  const token = await getIdToken();
  const r = await fetch(`${DB_URL}/patients.json?auth=${token}`);
  if (!r.ok) throw new Error(`RTDB fetch failed: ${r.status}`);

  const data = await r.json();
  cachedPatients = Object.values(data || {}).map(p => ({
    chartNo:   p.chartNo || '',
    name:      p.name || '',
    birthDate: p.birthDate || p.birthYear || '',
    gender:    p.gender || '',
    phone:     p.phone || '',
    doctor:    p.doctor || '',
    diagnosis: p.diagnosis || '',
  }));
  patientsExpiry = Date.now() + 5 * 60 * 1000;
  return cachedPatients;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ patients: [] });

  try {
    const all = await getPatients();
    const found = all
      .filter(p => p.name?.includes(q))
      .sort((a, b) => (a.name > b.name ? 1 : -1))
      .slice(0, 20);

    return res.json({ patients: found });
  } catch (err) {
    console.error('Patient search error:', err.stack || err.message);
    return res.status(500).json({ error: err.message });
  }
}
