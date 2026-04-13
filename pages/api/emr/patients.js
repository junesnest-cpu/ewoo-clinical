/**
 * EMR 환자 목록/상세 조회 API
 * GET  /api/emr/patients              — 현재 입원환자 목록
 * POST /api/emr/patients { chartNo }  — 특정 환자 상세 (입원이력, 처방, 검사결과)
 */
import { getPool } from '../../../lib/emrPool';

export default async function handler(req, res) {
  try {
    const pool = await getPool();

    if (req.method === 'GET') {
      // 현재 입원환자 목록
      const result = await pool.request().query(`
        SELECT
          b.bedm_dong AS dong, b.bedm_room AS room, b.bedm_key AS bedKey,
          b.bedm_cham AS chartNo, b.bedm_in_date AS admitDate,
          (SELECT TOP 1 chamWhanja FROM VIEWJUBLIST WHERE chamKey = b.bedm_cham) AS name,
          p.INSUCLS AS insuCls, p.INDAT AS inDate, p.OUTDAT AS outDate,
          (SELECT TOP 1 chamJumin FROM VIEWJUBLIST WHERE chamKey = b.bedm_cham) AS birthInfo
        FROM Wbedm b
        JOIN SILVER_PATIENT_INFO p ON p.CHARTNO = b.bedm_cham
          AND p.INDAT = (SELECT MAX(INDAT) FROM SILVER_PATIENT_INFO WHERE CHARTNO = b.bedm_cham)
          AND p.INSUCLS NOT IN ('50')
        WHERE b.bedm_cham IS NOT NULL AND b.bedm_cham <> ''
        ORDER BY b.bedm_dong, b.bedm_room, b.bedm_key
      `);

      const patients = result.recordset.map(r => ({
        chartNo: String(r.chartNo).trim(),
        name: String(r.name || '').trim(),
        room: `${r.dong}-${r.room}-${r.bedKey}`,
        admitDate: r.admitDate || r.inDate,
        insuCls: r.insuCls,
      }));
      return res.json({ patients });
    }

    if (req.method === 'POST') {
      const { chartNo } = req.body;
      if (!chartNo) return res.status(400).json({ error: 'chartNo required' });

      // 환자 기본정보
      const basicR = await pool.request().query(`
        SELECT TOP 1 chamWhanja AS name, chamJumin AS jumin, chamSex AS sex
        FROM VIEWJUBLIST WHERE chamKey = '${chartNo}'
      `);
      const basic = basicR.recordset[0] || {};

      // 입원이력
      const histR = await pool.request().query(`
        SELECT INDAT AS admitDate, OUTDAT AS dischargeDate, INSUCLS AS insuCls
        FROM SILVER_PATIENT_INFO
        WHERE CHARTNO = '${chartNo}' AND INDAT IS NOT NULL AND INDAT <> ''
        ORDER BY INDAT DESC
      `);

      // 최근 처방
      const orderR = await pool.request().query(`
        SELECT TOP 50 idam_date AS dt, RTRIM(idam_momn) AS code,
          idam_times AS times, idam_dosage AS dosage
        FROM Widam WHERE idam_cham = '${chartNo}'
        ORDER BY idam_date DESC
      `);

      // 최근 바이탈 (간호기록에서)
      let vitals = [];
      try {
        const vitalR = await pool.request().query(`
          SELECT TOP 30 *
          FROM Wnurse
          WHERE nurse_cham = '${chartNo}'
          ORDER BY nurse_date DESC
        `);
        vitals = vitalR.recordset;
      } catch (e) { /* 테이블 없을 수 있음 */ }

      return res.json({
        basic: { chartNo, name: String(basic.name || '').trim(), jumin: basic.jumin, sex: basic.sex },
        history: histR.recordset,
        orders: orderR.recordset,
        vitals,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('EMR patients error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
