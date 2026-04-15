const http = require('http');
const sql = require('mssql');

const pool = new sql.ConnectionPool({
  server: '192.168.0.253', port: 1433,
  user: 'sa', password: 'brain!@#$',
  database: 'BrWonmu',
  options: { encrypt: false, trustServerCertificate: true },
  pool: { max: 5, idleTimeoutMillis: 30000 }
});
const poolReady = pool.connect();

const API_KEY = 'ewoo-emr-2026';

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

  const memo = await p.request().input('c', chartNo).query(
    `SELECT chametc_memo AS memo FROM WchamEtc WHERE RTRIM(chametc_cham)=@c`
  );

  // 경과기록 — 입원기간으로 필터
  let notes = [];
  try {
    const convReq = p.request().input('c', chartNo);
    let convQuery = `SELECT TOP 50 convnote_date AS dt, convnote_jong_name AS noteType,
       convnote_contents AS contents
     FROM Wconvnote WHERE convnote_cham=@c`;
    if (dateFrom) {
      convReq.input('df', dateFrom).input('dt2', dateTo);
      convQuery += ` AND convnote_date >= @df AND convnote_date <= @dt2`;
    }
    convQuery += ` ORDER BY convnote_date DESC`;
    const conv = await convReq.query(convQuery);
    notes = conv.recordset
      .filter(r => (r.contents || '').trim())
      .map(r => ({
        date: (r.dt || '').trim(),
        type: (r.noteType || '').trim(),
        contents: (r.contents || '').trim(),
      }));
  } catch (e) { /* 테이블 없으면 무시 */ }

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
    memo: (memo.recordset[0]?.memo || '').trim(),
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
