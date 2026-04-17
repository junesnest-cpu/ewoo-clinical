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

/** 중괄호 깊이를 고려하여 RTF 그룹 제거 ({\fonttbl ...}, {\colortbl ...} 등) */
function removeRtfGroup(rtf, keyword) {
  const idx = rtf.indexOf(keyword);
  if (idx < 0) return rtf;
  // keyword 직전의 '{' 찾기
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

/** RTF(EUC-KR \'xx 시퀀스) → 텍스트 변환 */
function decodeRtf(rtf) {
  if (!rtf) return '';

  // 1) RTF 헤더 그룹 제거 (폰트테이블, 색상테이블, 스타일시트 등)
  let text = rtf;
  text = removeRtfGroup(text, '\\fonttbl');
  text = removeRtfGroup(text, '\\colortbl');
  text = removeRtfGroup(text, '\\stylesheet');
  // {\*\...} destination 그룹 제거
  text = text.replace(/\{\\\*\\[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
  // 나머지 중첩 헤더 제거
  text = text.replace(/\{[^{}]*\{[^{}]*\}[^{}]*\}/g, '');

  // 2) RTF 명령어 → 텍스트
  text = text
    .replace(/\\par\b\s?/g, '\n')
    .replace(/\\[a-z]+\d*\s?/gi, '')
    .replace(/[{}]/g, '');

  // 3) \'xx 시퀀스를 EUC-KR 디코딩
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

  // 경과기록 메모 (BrOcs.Onotem) — 주치의 요약 메모
  let doctorMemo = [];
  try {
    const ocs = await ocsReady;
    const notemResult = await ocs.request().input('c', chartNo).query(
      `SELECT notem_date AS dt, notem_user AS author, notem_time AS tm,
         CAST(notem_contentsRTF AS VARCHAR(MAX)) AS rtf
       FROM Onotem WHERE notem_cham=@c ORDER BY notem_date DESC`
    );
    doctorMemo = notemResult.recordset
      .map(r => {
        const text = decodeRtf(r.rtf);
        return text ? {
          date: (r.dt || '').trim(),
          author: (r.author || '').trim(),
          content: text,
        } : null;
      })
      .filter(Boolean);
  } catch (e) { console.error('Onotem query error:', e.message); }

  // 업무메모 (BrOcs.Oworkmemo) — 입원기간으로 필터
  let workMemos = [];
  try {
    const ocs = await ocsReady;
    const wmReq = ocs.request().input('c', chartNo);
    let wmQuery = `SELECT workmemo_date AS dt, workmemo_indate AS indate,
       workmemo_cnt AS cnt, workmemo_memo AS memo, workmemo_user AS author
     FROM Oworkmemo WHERE workmemo_cham=@c AND LTRIM(RTRIM(workmemo_memo)) != ''`;
    if (dateFrom) {
      wmReq.input('wdf', dateFrom).input('wdt', dateTo);
      wmQuery += ` AND workmemo_date >= @wdf AND workmemo_date <= @wdt`;
    }
    wmQuery += ` ORDER BY workmemo_date DESC, workmemo_cnt DESC`;
    const wmResult = await wmReq.query(wmQuery);
    workMemos = wmResult.recordset.map(r => ({
      date: (r.dt || '').trim(),
      memo: (r.memo || '').trim(),
      author: (r.author || '').trim(),
    }));
  } catch (e) { console.error('Oworkmemo query error:', e.message); }

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
    doctorMemo,
    workMemos,
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

  // 진단용: 특정 환자의 메모/노트 데이터가 있는 테이블 조사
  if (req.method === 'POST' && req.url === '/api/emr/find-memos') {
    let body = '';
    req.on('data', c => body += c);
    req.on('end', async () => {
      try {
        const { chartNo } = JSON.parse(body);
        if (!chartNo) { res.writeHead(400); res.end('{"error":"chartNo required"}'); return; }
        const p = await poolReady;
        const ocs = await ocsReady;
        const results = {};

        // BrWonmu에서 메모/노트 관련 테이블 검색
        const tables = await p.request().query(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_TYPE='BASE TABLE'
             AND (TABLE_NAME LIKE '%memo%' OR TABLE_NAME LIKE '%note%'
               OR TABLE_NAME LIKE '%Memo%' OR TABLE_NAME LIKE '%Note%'
               OR TABLE_NAME LIKE '%MEMO%' OR TABLE_NAME LIKE '%NOTE%'
               OR TABLE_NAME LIKE '%ref%' OR TABLE_NAME LIKE '%Ref%'
               OR TABLE_NAME LIKE '%conv%' OR TABLE_NAME LIKE '%word%'
               OR TABLE_NAME LIKE '%text%' OR TABLE_NAME LIKE '%remark%')
           ORDER BY TABLE_NAME`
        );
        results.brWonmuMemoTables = tables.recordset.map(r => r.TABLE_NAME);

        // BrOcs에서 메모/노트 관련 테이블 검색
        const ocsTables = await ocs.request().query(
          `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
           WHERE TABLE_TYPE='BASE TABLE'
             AND (TABLE_NAME LIKE '%memo%' OR TABLE_NAME LIKE '%note%'
               OR TABLE_NAME LIKE '%Memo%' OR TABLE_NAME LIKE '%Note%'
               OR TABLE_NAME LIKE '%MEMO%' OR TABLE_NAME LIKE '%NOTE%'
               OR TABLE_NAME LIKE '%conv%' OR TABLE_NAME LIKE '%word%'
               OR TABLE_NAME LIKE '%text%' OR TABLE_NAME LIKE '%remark%')
           ORDER BY TABLE_NAME`
        );
        results.brOcsMemoTables = ocsTables.recordset.map(r => r.TABLE_NAME);

        // 각 테이블에서 해당 환자의 데이터 건수 확인
        results.patientData = {};
        const allTables = [
          ...results.brWonmuMemoTables.map(t => ({ db: 'BrWonmu', table: t, pool: p })),
          ...results.brOcsMemoTables.map(t => ({ db: 'BrOcs', table: t, pool: ocs })),
        ];

        for (const { db, table, pool: tp } of allTables) {
          try {
            // 먼저 cham 관련 컬럼 찾기
            const cols = await tp.request().query(
              `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
               WHERE TABLE_NAME='${table}'
                 AND (COLUMN_NAME LIKE '%cham%' OR COLUMN_NAME LIKE '%chart%'
                   OR COLUMN_NAME LIKE '%CHAM%' OR COLUMN_NAME LIKE '%CHART%')`
            );
            if (cols.recordset.length === 0) continue;

            const chamCol = cols.recordset[0].COLUMN_NAME;
            const countResult = await tp.request().input('c', chartNo).query(
              `SELECT COUNT(*) AS cnt FROM [${table}] WHERE RTRIM([${chamCol}])=@c`
            );
            const cnt = countResult.recordset[0].cnt;
            if (cnt > 0) {
              // 샘플 데이터 가져오기 (최근 5건, 컬럼 구조 파악용)
              const sample = await tp.request().input('c', chartNo).query(
                `SELECT TOP 5 * FROM [${table}] WHERE RTRIM([${chamCol}])=@c ORDER BY 1 DESC`
              );
              results.patientData[`${db}.${table}`] = {
                count: cnt,
                chamColumn: chamCol,
                columns: Object.keys(sample.recordset[0] || {}),
                sample: sample.recordset.map(r => {
                  // RTF 내용은 잘라서 표시
                  const row = {};
                  for (const [k, v] of Object.entries(r)) {
                    if (typeof v === 'string' && v.length > 200) row[k] = v.slice(0, 200) + '...';
                    else row[k] = v;
                  }
                  return row;
                }),
              };
            }
          } catch (e) {
            results.patientData[`${db}.${table}`] = { error: e.message };
          }
        }

        res.writeHead(200); res.end(JSON.stringify(results, null, 2));
      } catch (e) {
        console.error('Find memos error:', e.message);
        res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
      }
    });
    return;
  }

  // 병동 라운딩 요약 — 전체 입원환자 데이터를 SQL 3건으로 벌크 조회
  if (req.method === 'GET' && req.url === '/api/emr/rounding-summary') {
    try {
      const p = await poolReady;
      const ocs = await ocsReady;

      // 1) 현재 입원환자 목록 + 기본정보 + 주치의 + 주상병(주소증)
      //    INSUCLS '50'(퇴원), '100'(일반100) 제외 — ewoo-hospital 병동현황 규칙과 동일
      //    OUTER APPLY TOP 1로 환자당 1행 보장
      const bedResult = await p.request().query(`
        SELECT
          b.bedm_cham AS chartNo,
          b.bedm_dong AS dong, b.bedm_room AS room, b.bedm_key AS bedKey,
          b.bedm_in_date AS admitDate,
          pv.name, pv.jumin, pv.doctor,
          md.diagName
        FROM Wbedm b
        OUTER APPLY (
          SELECT TOP 1 chamWhanja AS name, chamJumin1 AS jumin, dctrName AS doctor
          FROM VIEWJUBLIST WHERE chamKey = b.bedm_cham
        ) pv
        OUTER APPLY (
          SELECT TOP 1 d.dism_h_name AS diagName
          FROM Widis i
          JOIN Wdism d ON RTRIM(i.idis_dism)=RTRIM(d.dism_key)
          WHERE i.idis_cham = b.bedm_cham
          ORDER BY i.idis_s_date DESC
        ) md
        WHERE b.bedm_cham IS NOT NULL AND b.bedm_cham <> ''
          AND NOT EXISTS (
            SELECT 1 FROM SILVER_PATIENT_INFO sp
            WHERE sp.CHARTNO = b.bedm_cham
              AND sp.INSUCLS IN ('50','100')
              AND sp.INDAT = (SELECT MAX(INDAT) FROM SILVER_PATIENT_INFO WHERE CHARTNO = b.bedm_cham)
          )
        ORDER BY b.bedm_dong, b.bedm_room, b.bedm_key
      `);

      const chartNos = bedResult.recordset.map(r => String(r.chartNo).trim()).filter(Boolean);
      if (!chartNos.length) { res.writeHead(200); res.end(JSON.stringify({ patients: [] })); return; }

      // 2) 최근 SOAP S (각 환자별 최신 1건, SQL 1건으로 벌크)
      //    주치의(강국형=2, 이숙경=5)가 작성한 S만 — 협진(김민준=1, 진영문=3) 제외
      const soapMap = {};
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
      } catch (e) { console.error('Rounding SOAP error:', e.message); }

      // 3) 최근 업무메모 (각 환자별 최신 1건, SQL 1건으로 벌크)
      const memoMap = {};
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
      } catch (e) { console.error('Rounding workMemo error:', e.message); }

      // 4) 병합
      const ROOM_MAP = {
        1:'201', 2:'202', 3:'203', 4:'204', 5:'205', 6:'206',
        7:'301', 8:'302', 9:'303',10:'304',11:'305',12:'306',
       13:'501',14:'502',15:'503',16:'504',17:'505',18:'506',
       19:'601',20:'602',21:'603',
      };

      const patients = bedResult.recordset.map(r => {
        const c = String(r.chartNo).trim();
        const roomLabel = ROOM_MAP[r.room] || `${r.dong}0${r.room}`;
        // 주치의: 강국형/이숙경만 인정
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

      res.writeHead(200); res.end(JSON.stringify({ patients }));
    } catch (e) {
      console.error('Rounding summary error:', e.message);
      res.writeHead(500); res.end(JSON.stringify({ error: e.message }));
    }
    return;
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
