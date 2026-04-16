/**
 * 환자 벌크 조회 API — ewoo-hospital-ward RTDB에서 주치의/진단명/생년 조회
 * POST /api/patients/bulk { chartNos: ['5546', ...] }
 *
 * 주치의는 lastDoctor 필드 (EMR dctrName 동기화)에서 강국형/이숙경만 인정
 */
import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';

function parsePK(raw) {
  let k = raw || '';
  if (k.includes('\\n')) k = k.replace(/\\n/g, '\n');
  return k;
}

const APP_NAME = 'hospital-ward';

function getHospitalDb() {
  let app;
  try { app = getApp(APP_NAME); } catch {
    app = initializeApp({
      credential: cert({
        projectId:   process.env.HOSPITAL_FIREBASE_PROJECT_ID,
        clientEmail: process.env.HOSPITAL_FIREBASE_CLIENT_EMAIL,
        privateKey:  parsePK(process.env.HOSPITAL_FIREBASE_PRIVATE_KEY),
      }),
      databaseURL: 'https://ewoo-hospital-ward-default-rtdb.firebaseio.com',
    }, APP_NAME);
  }
  return getDatabase(app);
}

// 캐시 (5분)
let cachedPatients = null;
let patientsExpiry = 0;

async function getAllPatients() {
  if (cachedPatients && Date.now() < patientsExpiry) return cachedPatients;

  const db = getHospitalDb();
  const snap = await db.ref('patients').once('value');
  const data = snap.val() || {};

  cachedPatients = {};
  for (const [key, p] of Object.entries(data)) {
    const c = String(p.chartNo || '').trim();
    if (!c) continue;

    // 주치의: lastDoctor에서 강국형/이숙경만 추출
    const lastDoc = (p.lastDoctor || '').trim();
    let attending = '';
    if (lastDoc.includes('강국형')) attending = '강국형';
    else if (lastDoc.includes('이숙경')) attending = '이숙경';

    cachedPatients[c] = {
      attending,
      lastDoctor: lastDoc,
      diagnosis:  p.diagName || p.diagnosis || '',
      birthDate:  p.birthDate || '',
      birthYear:  p.birthYear || '',
      chiefComplaint: p.chiefComplaint || '',
    };
    // internalId 기준으로도 매핑 (slots.current.patientId → internalId)
    if (p.internalId) cachedPatients[`_id:${p.internalId}`] = cachedPatients[c];
  }

  patientsExpiry = Date.now() + 5 * 60 * 1000;
  return cachedPatients;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { chartNos } = req.body;
  if (!chartNos?.length) return res.json({ patients: {} });

  try {
    const all = await getAllPatients();
    const result = {};
    for (const c of chartNos) {
      // chartNo 직접 매칭, 선행 0 제거 매칭, internalId 매칭
      result[c] = all[c] || all[c.replace(/^0+/, '')] || all[`_id:${c}`] || null;
    }
    return res.json({ patients: result });
  } catch (err) {
    console.error('Patient bulk error:', err.stack || err.message);
    return res.status(500).json({ error: err.message });
  }
}
