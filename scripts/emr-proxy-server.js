const http = require('http');
const sql = require('mssql');

const dbOpts = {
  server: '192.168.0.253', port: 1433,
  user: 'sa', password: 'brain!@#$',
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 5, idleTimeoutMillis: 30000 },
};

const pool = new sql.ConnectionPool({ ...dbOpts, database: 'BrWonmu' });
const poolReady = pool.connect();

const ocsPool = new sql.ConnectionPool({ ...dbOpts, database: 'BrOcs' });
const ocsReady = ocsPool.connect();

const API_KEY = 'ewoo-emr-2026';

const SOAP_LABELS = { 0: 'S', 1: 'O', 2: 'A', 3: 'P' };

/** RTF(EUC-KR \'xx 시퀀스) → 텍스트 변환 */
function decodeRtf(rtf) {
  if (!rtf) return '';
  // \'xx 시퀀스를 바이트 배열로 변환 후 EUC-KR 디코딩
  // 먼저 \par → \n, RTF 명령어 제거
  let text = rtf
    .replace(/\{[^{}]*\{[^{}]*\}[^{}]*\}/g, '')  // 중첩 헤더 {...{...}...} 제거
    .replace(/\\par\b\s?/g, '\n')
    .replace(/\\[a-z]+\d*\s?/gi, '')
    .replace(/[{}]/g, '');

  // \'xx 시퀀스를 EUC-KR 디코딩
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

const ADMIN_CODES = new Set(['Y2300','Z0010','Z0011','Z0030','BED2','BED3','BED4','MO3','MO4']);

async function getOpinionData(chartNo, admitDate, dischargeDate) {
  const p = await poolReady;

  const basic = await p.request().input('c', chartNo).query(
    `SELECT TOP 1 cham_whanja AS name, cham_jumin1 AS jumin,
       cham_sex AS sex, cham_birth AS birth
     FROM Wcham WHERE RTRIM(cham_key)=@c`
  );

  const diag = await p.request().input('c', chartNo).query(
    `SELECT d.dism_code AS code, d.dism_h_name AS name,
       MAX(i.idis_s_date) AS startDate
     FROM Widis i
     JOIN Wdism d ON RTRIM(i.idis_dism)=RTRIM(d.dism_key)
     WHERE i.idis_cham=@c
     GROUP BY d.dism_code, d.dism_h_name
     ORDER BY MAX(i.idis_s_date) DESC`
  );

  const hist = await p.request().input('c', chartNo).query(
    `SELECT TOP 10 INDAT AS admitDate, OUTDAT AS dischargeDate,
       INSUCLS AS insuCls, DIAGCD AS diagCode
     FROM SILVER_PATIENT_INFO
     WHERE CHARTNO=@c AND INDAT IS NOT NULL AND INDAT<>''
     ORDER BY INDAT DESC`
  );

  // 입원기간 필터 — admitDate/dischargeDate가 전달되면 해당 기간으로 한정
  const dateFrom = admitDate || '';
  const dateTo = dischargeDate || '99991231'; // 퇴원일 없으면(현재 입원) 미래까지

  // 치료(처방) 내역 — 입원기간으로 필터
  const ordersReq = p.request().input('c', chartNo);
  let ordersQuery = `SELECT i.idam_date AS dt, RTRIM(i.idam_momn) AS code,
     m.momm_h_name AS mommName, n.momn_h_name AS momnName,
     i.idam_times AS times, i.idam_day AS days, i.idam_dosage AS dosage
   FROM Widam i
   LEFT JOIN Wmomm m ON RTRIM(i.idam_momn)=RTRIM(m.momm_key)
   LEFT JOIN Wmomn n ON RTRIM(i.idam_momn)=RTRIM(n.momn_key)
   WHERE i.idam_cham=@c`;
  if (dateFrom) {
    ordersReq.input('df', dateFrom).input('dt2', dateTo);
    ordersQuery += ` AND i.idam_date >= @df AND i.idam_date <= @dt2`;
  }
  ordersQuery += ` ORDER BY i.idam_date DESC`;
  const orders = await ordersReq.query(ordersQuery);

  const tMap = {};
  for (const r of orders.recordset) {
    const code = (r.code || '').trim();
    if (!code || ADMIN_CODES.has(code) || /^A[A-Z]/.test(code)) continue;
    const name = (r.mommName || r.momnName || code).trim();
    if (!tMap[code]) tMap[code] = { code, name, dates: [], count: 0 };
    tMap[code].count++;
    const d = (r.dt || '').trim();
    if (d && !tMap[code].dates.includes(d)) tMap[code].dates.push(d);
  }

  // 처방메모 (Wmemo) — 입원기간으로 필터
  const memoReq = p.request().input('c', chartNo);
  let memoQuery = `SELECT memo_date AS dt, memo_ref AS content, memo_user AS author
    FROM Wmemo WHERE memo_cham=@c`;
  if (dateFrom) {
    memoReq.input('mdf', dateFrom).input('mdt', dateTo);
    memoQuery += ` AND memo_date >= @mdf AND memo_date <= @mdt`;
  }
  memoQuery += ` ORDER BY memo_date DESC`;
  const memoResult = await memoReq.query(memoQuery);

  // SOAP 경과기록 (BrOcs.Onote) — 입원기간으로 필터
  let notes = [];
  try {
    const ocs = await ocsReady;
    const soapReq = ocs.request().input('c', chartNo);
    let soapQuery = `SELECT TOP 100 note_date AS dt, note_gubun AS gubun, note_time AS tm,
       CAST(note_contentsRTF AS VARCHAR(4000)) AS rtf
     FROM Onote WHERE note_cham=@c`;
    if (dateFrom) {
      soapReq.input('df', dateFrom).input('dt2', dateTo);
      soapQuery += ` AND note_date >= @df AND note_date <= @dt2`;
    }
    soapQuery += ` ORDER BY note_date DESC, note_time DESC`;
    const soapResult = await soapReq.query(soapQuery);

    // 날짜별로 S/O/A/P 그룹핑
    const byDate = {};
    for (const r of soapResult.recordset) {
      const dt = (r.dt || '').trim();
      if (!byDate[dt]) byDate[dt] = { date: dt, S: '', O: '', A: '', P: '' };
      const label = SOAP_LABELS[r.gubun] || '';
      if (label) {
        const text = decodeRtf(r.rtf);
        if (text) byDate[dt][label] = text;
      }
    }
    notes = Object.values(byDate)
      .filter(n => n.S || n.O || n.A || n.P)
      .sort((a, b) => b.date.localeCompare(a.date));
  } catch (e) { console.error('SOAP query error:', e.message); }

  const b = basic.recordset[0] || {};
  return {
    basic: {
      chartNo,
      name: (b.name || '').trim(),
      jumin: (b.jumin || '').trim(),
      sex: b.sex,
      birth: (b.birth || '').trim(),
    },
    admissions: hist.recordset.map(r => ({
      admitDate: (r.admitDate || '').trim(),
      dischargeDate: (r.dischargeDate || '').trim(),
      insuCls: (r.insuCls || '').trim(),
      diagCode: (r.diagCode || '').trim(),
    })),
    diagnoses: diag.recordset.map(r => ({
      code: (r.code || '').trim(),
      name: (r.name || '').trim(),
      startDate: (r.startDate || '').trim(),
    })),
    treatments: Object.values(tMap).sort((a, b) => b.count - a.count),
    prescriptionMemos: memoResult.recordset
      .filter(r => (r.content || '').trim())
      .map(r => ({
        date: (r.dt || '').trim(),
        content: (r.content || '').trim(),
        author: (r.author || '').trim(),
      })),
    progressNotes: notes,
  };
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (req.headers['x-api-key'] !== API_KEY) {
    res.writeHead(401); res.end('{"error":"unauthorized"}'); return;
  }

  if (req.method === 'POST' && req.url === '/api/emr/opinion-data') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { chartNo, admitDate, dischargeDate } = JSON.parse(body);
        if (!chartNo) { res.writeHead(400); res.end('{"error":"chartNo required"}'); return; }
        const data = await getOpinionData(chartNo, admitDate, dischargeDate);
        res.writeHead(200); res.end(JSON.stringify(data));
      } catch (e) {
        console.error('Error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
  } else {
    res.writeHead(404); res.end('{"error":"not found"}');
  }
});

server.listen(3900, () => console.log('EMR proxy running on :3900'));
