/**
 * 간호과 라운딩 체크용 입원환자 목록 API
 * GET /api/emr/rounding — 병실순 입원환자 + 환자정보 메모
 */
import { getPool } from '../../../lib/emrPool';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  try {
    const pool = await getPool();
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
      LEFT JOIN WchamEtc e ON e.chametc_cham = b.bedm_cham
      JOIN (
        SELECT CHARTNO, MAX(INDAT) AS maxIn
        FROM SILVER_PATIENT_INFO
        WHERE INSUCLS NOT IN ('50')
        GROUP BY CHARTNO
      ) p ON p.CHARTNO = b.bedm_cham
      WHERE b.bedm_cham IS NOT NULL AND b.bedm_cham <> ''
      ORDER BY b.bedm_dong, b.bedm_room, b.bedm_key
    `);

    const patients = result.recordset.map(r => ({
      chartNo: String(r.chartNo).trim(),
      name: String(r.name || '').trim(),
      dong: r.dong,
      room: r.room,
      bed: r.bedKey,
      roomLabel: `${r.dong}0${r.room}`,
      admitDate: r.admitDate,
      memo: String(r.memo || '').trim(),
    }));

    return res.json({ patients });
  } catch (err) {
    console.error('Rounding API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
