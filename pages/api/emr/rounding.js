/**
 * 간호과 라운딩 체크용 입원환자 목록 API
 * GET /api/emr/rounding — 병실순 입원환자 + 환자정보 메모
 */
import { getPool } from '../../../lib/emrPool';
import { requireAuth } from '../../../lib/verifyAuth';

// bedm_room은 병원 전체 순차 번호 (1~21) → 실제 호실명으로 변환
const ROOM_MAP = {
   1:'201',  2:'202',  3:'203',  4:'204',  5:'205',  6:'206',
   7:'301',  8:'302',  9:'303', 10:'304', 11:'305', 12:'306',
  13:'501', 14:'502', 15:'503', 16:'504', 17:'505', 18:'506',
  19:'601', 20:'602', 21:'603',
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  const a = await requireAuth(req, res);
  if (!a.ok && !a.audited) return;

  try {
    const pool = await getPool();
    const result = await pool.request().query(`
      WITH currentPats AS (
        SELECT CHARTNO, INSUCLS,
          ROW_NUMBER() OVER (PARTITION BY CHARTNO ORDER BY INDAT DESC) AS rn
        FROM SILVER_PATIENT_INFO
        WHERE OUTDAT IS NULL OR OUTDAT = ''
      )
      SELECT
        b.bedm_dong   AS dong,
        b.bedm_room   AS room,
        b.bedm_key    AS bedKey,
        b.bedm_cham   AS chartNo,
        b.bedm_in_date AS admitDate,
        (SELECT TOP 1 chamWhanja FROM VIEWJUBLIST WHERE chamKey = b.bedm_cham) AS name,
        ISNULL(e.chametc_memo, '') AS memo
      FROM Wbedm b
      JOIN currentPats cp ON cp.CHARTNO = b.bedm_cham AND cp.rn = 1 AND cp.INSUCLS <> '50'
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

    return res.json({ patients });
  } catch (err) {
    console.error('Rounding API error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
