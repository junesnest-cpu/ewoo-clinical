/**
 * 병동 라운딩 요약 API (EMR 프록시 중계)
 * GET /api/emr/rounding-summary
 *
 * 라즈베리파이 프록시의 벌크 엔드포인트 호출 — SQL 3건으로
 * 전체 입원환자의 주치의, 주소증, SOAP S, 업무메모를 한 번에 조회
 */

const EMR_PROXY_URL = process.env.EMR_PROXY_URL;
const EMR_PROXY_KEY = process.env.EMR_PROXY_KEY || 'ewoo-emr-2026';

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  if (!EMR_PROXY_URL) {
    return res.status(503).json({ error: 'EMR proxy not configured' });
  }

  try {
    const r = await fetch(`${EMR_PROXY_URL}/api/emr/rounding-summary`, {
      headers: { 'x-api-key': EMR_PROXY_KEY },
    });

    if (!r.ok) {
      const body = await r.text();
      console.error('EMR proxy error:', r.status, body);
      return res.status(r.status).json({ error: 'EMR proxy error' });
    }

    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error('Rounding summary error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
