/**
 * EMR → Firestore 간호 라운딩 데이터 동기화
 *
 * 사용법:
 *   node scripts/syncRounding.js          # 현재 입원환자 동기화
 *
 * Cron (라즈베리파이):
 *   0,30 8-20 * * * cd /home/pi/ewoo-clinical && node scripts/syncRounding.js >> sync-rounding.log 2>&1
 */
require('dotenv').config({ path: '.env.local' });
const sql = require('mssql');
const { initializeApp, cert, getApps } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

if (!getApps().length) {
  let privateKey = process.env.FIREBASE_PRIVATE_KEY || '';
  if (privateKey.includes('\\n')) privateKey = privateKey.replace(/\\n/g, '\n');
  initializeApp({
    credential: cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    }),
  });
}
const db = getFirestore();

const sqlConfig = {
  user:     process.env.EMR_DB_USER,
  password: process.env.EMR_DB_PASSWORD,
  database: 'BrWonmu',
  server:   '192.168.0.253',
  port:     1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 60000,
};

const ROOM_MAP = {
   1:'201',  2:'202',  3:'203',  4:'204',  5:'205',  6:'206',
   7:'301',  8:'302',  9:'303', 10:'304', 11:'305', 12:'306',
  13:'501', 14:'502', 15:'503', 16:'504', 17:'505', 18:'506',
  19:'601', 20:'602', 21:'603',
};

async function main() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

  console.log(`[${now.toLocaleString('ko-KR')}] 라운딩 동기화 시작 (${dateKey})`);

  const pool = await sql.connect(sqlConfig);
  const result = await pool.request().query(`
    SELECT
      b.bedm_dong   AS dong,
      b.bedm_room   AS room,
      b.bedm_key    AS bedKey,
      b.bedm_cham   AS chartNo,
      b.bedm_in_date AS admitDate,
      (SELECT TOP 1 chamWhanja FROM VIEWJUBLIST WHERE chamKey = b.bedm_cham) AS name,
      ISNULL(e.chametc_memo, '') AS memo
    FROM Wbedm b
    JOIN (
      SELECT CHARTNO, INSUCLS,
        ROW_NUMBER() OVER (PARTITION BY CHARTNO ORDER BY INDAT DESC) AS rn
      FROM SILVER_PATIENT_INFO
      WHERE OUTDAT IS NULL OR OUTDAT = ''
    ) cp ON cp.CHARTNO = b.bedm_cham AND cp.rn = 1 AND cp.INSUCLS <> '50'
    LEFT JOIN WchamEtc e ON e.chametc_cham = b.bedm_cham
    WHERE b.bedm_cham IS NOT NULL AND b.bedm_cham <> ''
    ORDER BY b.bedm_dong, b.bedm_room, b.bedm_key
  `);

  const patients = result.recordset.map(r => {
    const roomLabel = ROOM_MAP[r.room] || `${r.dong}0${r.room}`;
    return {
      chartNo: String(r.chartNo).trim(),
      name: String(r.name || '').trim(),
      dong: roomLabel.charAt(0),
      room: r.room,
      bed: r.bedKey,
      roomLabel,
      admitDate: r.admitDate,
      memo: String(r.memo || '').trim().replace(/(\r?\n){2,}/g, '\n'),
    };
  });

  // Firestore에 저장: roundingSync/{dateKey}
  await db.doc(`roundingSync/${dateKey}`).set({
    patients,
    lastSync: new Date().toISOString(),
    count: patients.length,
  });

  console.log(`  ✅ ${patients.length}명 동기화 완료 → roundingSync/${dateKey}`);

  await sql.close();
  process.exit(0);
}

main().catch(err => {
  console.error('❌', err.message);
  sql.close().catch(() => {});
  process.exit(1);
});
