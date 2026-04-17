/**
 * EMR → Firestore 병동 라운딩 상세 동기화
 *
 * 저장 경로: roundingSummary/{YYYY-MM-DD}
 * 내용: 전체 입원환자 + 주치의 + 주소증 + 최근 SOAP S + 업무메모
 *
 * Cron (라즈베리파이):
 *   5,35 8-20 * * * cd /home/pi/ewoo-clinical && node scripts/syncRoundingSummary.js >> sync-rounding-summary.log 2>&1
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

const wonmuConfig = {
  user: process.env.EMR_DB_USER, password: process.env.EMR_DB_PASSWORD,
  database: 'BrWonmu', server: '192.168.0.253', port: 1433,
  options: { encrypt: false, trustServerCertificate: true },
  requestTimeout: 60000,
};

const ROOM_MAP = {
   1:'201',  2:'202',  3:'203',  4:'204',  5:'205',  6:'206',
   7:'301',  8:'302',  9:'303', 10:'304', 11:'305', 12:'306',
  13:'501', 14:'502', 15:'503', 16:'504', 17:'505', 18:'506',
  19:'601', 20:'602', 21:'603',
};

const SOAP_LABELS = { 0: 'S', 1: 'O', 2: 'A', 3: 'P' };

/** RTF → 텍스트 (fonttbl/colortbl 헤더 제거 포함) */
function removeRtfGroup(rtf, keyword) {
  const idx = rtf.indexOf(keyword);
  if (idx < 0) return rtf;
  let start = rtf.lastIndexOf('{', idx);
  if (start < 0) return rtf;
  let depth = 1, i = start + 1;
  while (i < rtf.length && depth > 0) {
    if (rtf[i] === '{') depth++;
    else if (rtf[i] === '}') depth--;
    i++;
  }
  return rtf.slice(0, start) + rtf.slice(i);
}

function decodeRtf(rtf) {
  if (!rtf) return '';
  let text = rtf;
  text = removeRtfGroup(text, '\\fonttbl');
  text = removeRtfGroup(text, '\\colortbl');
  text = removeRtfGroup(text, '\\stylesheet');
  text = text.replace(/\{\\\*\\[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  text = text.replace(/\{[^{}]*\{[^{}]*\}[^{}]*\}/g, '');
  text = text.replace(/\\par\b\s?/g, '\n').replace(/\\[a-z]+\d*\s?/gi, '').replace(/[{}]/g, '');

  const parts = text.split(/((?:\\'[0-9a-f]{2})+)/gi);
  let result = '';
  for (const part of parts) {
    if (part.startsWith("\\'")) {
      const hexPairs = part.match(/\\'([0-9a-f]{2})/gi) || [];
      const bytes = hexPairs.map(h => parseInt(h.slice(2), 16));
      try { result += new TextDecoder('euc-kr').decode(Buffer.from(bytes)); } catch { result += '?'; }
    } else {
      result += part;
    }
  }
  return result.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const now = new Date();
  const dateKey = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  console.log(`[${now.toLocaleString('ko-KR')}] 라운딩 상세 동기화 시작 (${dateKey})`);

  const wonmu = await sql.connect(wonmuConfig);

  // 1) 입원환자 목록 + 기본정보 + 주치의 + 주소증
  const bedResult = await wonmu.request().query(`
    SELECT
      b.bedm_cham AS chartNo, b.bedm_dong AS dong, b.bedm_room AS room,
      b.bedm_key AS bedKey, b.bedm_in_date AS admitDate,
      pv.name, pv.jumin, pv.doctor,
      md.diagName
    FROM Wbedm b
    OUTER APPLY (
      SELECT TOP 1 chamWhanja AS name, chamJumin1 AS jumin, dctrName AS doctor
      FROM VIEWJUBLIST WHERE chamKey = b.bedm_cham
    ) pv
    OUTER APPLY (
      SELECT TOP 1 d.dism_h_name AS diagName
      FROM Widis i JOIN Wdism d ON RTRIM(i.idis_dism)=RTRIM(d.dism_key)
      WHERE i.idis_cham = b.bedm_cham ORDER BY i.idis_s_date DESC
    ) md
    WHERE b.bedm_cham IS NOT NULL AND b.bedm_cham <> ''
      AND NOT EXISTS (
        SELECT 1 FROM SILVER_PATIENT_INFO sp
        WHERE sp.CHARTNO = b.bedm_cham AND sp.INSUCLS IN ('50','100')
          AND sp.INDAT = (SELECT MAX(INDAT) FROM SILVER_PATIENT_INFO WHERE CHARTNO = b.bedm_cham)
      )
    ORDER BY b.bedm_dong, b.bedm_room, b.bedm_key
  `);

  const chartNos = bedResult.recordset.map(r => String(r.chartNo).trim()).filter(Boolean);
  console.log(`  환자 ${chartNos.length}명`);

  // 2) BrOcs 연결 → SOAP S + 업무메모 벌크 조회
  const ocsConfig = { ...wonmuConfig, database: 'BrOcs' };
  await wonmu.close();
  const ocs = await sql.connect(ocsConfig);

  const soapMap = {};
  if (chartNos.length) {
    try {
      const inList = chartNos.map(c => `'${c}'`).join(',');
      const soapResult = await ocs.request().query(`
        SELECT x.note_cham, x.note_date, x.rtf FROM (
          SELECT note_cham, note_date,
            CAST(note_contentsRTF AS VARCHAR(4000)) AS rtf,
            ROW_NUMBER() OVER (PARTITION BY note_cham ORDER BY note_date DESC, note_time DESC) AS rn
          FROM Onote WHERE note_gubun = 0 AND note_dctr IN (2, 5)
            AND RTRIM(note_cham) IN (${inList})
        ) x WHERE x.rn = 1
      `);
      for (const r of soapResult.recordset) {
        soapMap[String(r.note_cham).trim()] = { date: (r.note_date || '').trim(), text: decodeRtf(r.rtf) };
      }
      console.log(`  SOAP S: ${Object.keys(soapMap).length}명`);
    } catch (e) { console.error('  SOAP error:', e.message); }
  }

  const memoMap = {};
  if (chartNos.length) {
    try {
      const inList = chartNos.map(c => `'${c}'`).join(',');
      const wmResult = await ocs.request().query(`
        SELECT x.workmemo_cham, x.dt, x.memo, x.author FROM (
          SELECT workmemo_cham, workmemo_date AS dt, workmemo_memo AS memo,
            workmemo_user AS author,
            ROW_NUMBER() OVER (PARTITION BY workmemo_cham ORDER BY workmemo_date DESC, workmemo_cnt DESC) AS rn
          FROM Oworkmemo
          WHERE LTRIM(RTRIM(workmemo_memo)) != '' AND RTRIM(workmemo_cham) IN (${inList})
        ) x WHERE x.rn = 1
      `);
      for (const r of wmResult.recordset) {
        memoMap[String(r.workmemo_cham).trim()] = { date: (r.dt || '').trim(), memo: (r.memo || '').trim(), author: (r.author || '').trim() };
      }
      console.log(`  업무메모: ${Object.keys(memoMap).length}명`);
    } catch (e) { console.error('  WorkMemo error:', e.message); }
  }

  await ocs.close();

  // 3) 병합 + Firestore 저장
  const patients = bedResult.recordset.map(r => {
    const c = String(r.chartNo).trim();
    const roomLabel = ROOM_MAP[r.room] || `${r.dong}0${r.room}`;
    const rawDoc = (r.doctor || '').trim();
    let attending = '';
    if (rawDoc.includes('강국형')) attending = '강국형';
    else if (rawDoc.includes('이숙경')) attending = '이숙경';

    return {
      chartNo: c,
      name: (r.name || '').trim(),
      dong: String(roomLabel).charAt(0),
      roomLabel,
      bed: r.bedKey,
      admitDate: (r.admitDate || '').trim(),
      jumin: (r.jumin || '').trim(),
      attending,
      diagName: (r.diagName || '').trim(),
      soapS: soapMap[c] || null,
      workMemo: memoMap[c] || null,
    };
  });

  await db.doc(`roundingSummary/${dateKey}`).set({
    patients,
    lastSync: new Date().toISOString(),
    count: patients.length,
  });

  console.log(`  ✅ ${patients.length}명 → roundingSummary/${dateKey}\n`);
  process.exit(0);
}

main().catch(err => {
  console.error('❌', err.message);
  sql.close().catch(() => {});
  process.exit(1);
});
