/**
 * 소견서 작성용 EMR 데이터 조회 API
 * POST /api/emr/opinion-data { chartNo }
 * - 환자 기본정보, 진단명, 입원이력, 치료(처방) 내역, 환자 메모
 */
import { getPool } from '../../../lib/emrPool';

// 행정/수가/기본 코드 제외 패턴
const ADMIN_CODES = new Set([
  'Y2300', 'Z0010', 'Z0011', 'Z0030', 'BED2', 'BED3', 'BED4',
  'MO3', 'MO4',
]);
const isAdminCode = (code) =>
  ADMIN_CODES.has(code) || /^A[A-Z]/.test(code);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { chartNo } = req.body;
  if (!chartNo) return res.status(400).json({ error: 'chartNo required' });

  try {
    const pool = await getPool();

    // 1) 환자 기본정보
    const basicR = await pool.request()
      .input('chartNo', chartNo)
      .query(`
        SELECT TOP 1 cham_whanja AS name, cham_jumin1 AS jumin, cham_sex AS sex,
          cham_birth AS birth
        FROM Wcham WHERE RTRIM(cham_key) = @chartNo
      `);
    const basic = basicR.recordset[0] || {};

    // 2) 입원이력 (최근 입원)
    const histR = await pool.request()
      .input('chartNo', chartNo)
      .query(`
        SELECT TOP 5 INDAT AS admitDate, OUTDAT AS dischargeDate,
          INSUCLS AS insuCls, DIAGCD AS diagCode
        FROM SILVER_PATIENT_INFO
        WHERE CHARTNO = @chartNo AND INDAT IS NOT NULL AND INDAT <> ''
        ORDER BY INDAT DESC
      `);

    // 3) 진단명 (Widis + Wdism) — 코드 기준 중복 제거
    const diagR = await pool.request()
      .input('chartNo', chartNo)
      .query(`
        SELECT d.dism_code AS code, d.dism_h_name AS name,
          MAX(i.idis_s_date) AS startDate
        FROM Widis i
        JOIN Wdism d ON RTRIM(i.idis_dism) = RTRIM(d.dism_key)
        WHERE i.idis_cham = @chartNo
        GROUP BY d.dism_code, d.dism_h_name
        ORDER BY MAX(i.idis_s_date) DESC
      `);

    // 4) 치료(처방) 내역 — 약품명은 Wmomm, 시술명은 Wmomn
    const ordersR = await pool.request()
      .input('chartNo', chartNo)
      .query(`
        SELECT i.idam_date AS dt, RTRIM(i.idam_momn) AS code,
          m.momm_h_name AS mommName, n.momn_h_name AS momnName,
          i.idam_times AS times, i.idam_day AS days,
          i.idam_dosage AS dosage
        FROM Widam i
        LEFT JOIN Wmomm m ON RTRIM(i.idam_momn) = RTRIM(m.momm_key)
        LEFT JOIN Wmomn n ON RTRIM(i.idam_momn) = RTRIM(n.momn_key)
        WHERE i.idam_cham = @chartNo
        ORDER BY i.idam_date DESC
      `);

    // 의미 있는 치료만 필터링 + 그룹핑
    const treatmentMap = {};
    for (const r of ordersR.recordset) {
      const code = (r.code || '').trim();
      if (!code || isAdminCode(code)) continue;
      const name = (r.mommName || r.momnName || code).trim();
      if (!treatmentMap[code]) {
        treatmentMap[code] = { code, name, dates: [], count: 0 };
      }
      treatmentMap[code].count++;
      const dt = (r.dt || '').trim();
      if (dt && !treatmentMap[code].dates.includes(dt)) {
        treatmentMap[code].dates.push(dt);
      }
    }
    const treatments = Object.values(treatmentMap)
      .sort((a, b) => b.count - a.count);

    // 5) 환자 메모 (주소증 등)
    const memoR = await pool.request()
      .input('chartNo', chartNo)
      .query(`
        SELECT chametc_memo AS memo FROM WchamEtc
        WHERE RTRIM(chametc_cham) = @chartNo
      `);

    // 6) 경과기록 (Wconvnote — 데이터 있으면)
    let progressNotes = [];
    try {
      const convR = await pool.request()
        .input('chartNo', chartNo)
        .query(`
          SELECT TOP 20 convnote_date AS dt, convnote_jong_name AS noteType,
            convnote_contents AS contents
          FROM Wconvnote
          WHERE convnote_cham = @chartNo
          ORDER BY convnote_date DESC
        `);
      progressNotes = convR.recordset.map(r => ({
        date: (r.dt || '').trim(),
        type: (r.noteType || '').trim(),
        contents: (r.contents || '').trim(),
      })).filter(n => n.contents);
    } catch (e) { /* 테이블 없거나 빈 경우 무시 */ }

    return res.json({
      basic: {
        chartNo,
        name: (basic.name || '').trim(),
        jumin: (basic.jumin || '').trim(),
        sex: basic.sex,
        birth: (basic.birth || '').trim(),
      },
      admissions: histR.recordset.map(r => ({
        admitDate: (r.admitDate || '').trim(),
        dischargeDate: (r.dischargeDate || '').trim(),
        insuCls: (r.insuCls || '').trim(),
        diagCode: (r.diagCode || '').trim(),
      })),
      diagnoses: diagR.recordset.map(r => ({
        code: (r.code || '').trim(),
        name: (r.name || '').trim(),
        startDate: (r.startDate || '').trim(),
      })),
      treatments,
      memo: (memoR.recordset[0]?.memo || '').trim(),
      progressNotes,
    });
  } catch (err) {
    console.error('Opinion data error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
