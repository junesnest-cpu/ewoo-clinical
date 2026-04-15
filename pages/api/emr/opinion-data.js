/**
 * 소견서 작성용 EMR 데이터 조회 API
 * POST /api/emr/opinion-data { chartNo }
 *
 * Vercel에서 내부망 EMR DB 직접 접근 불가 →
 * 라즈베리파이 프록시(Cloudflare Tunnel)를 통해 조회
 */

const EMR_PROXY_URL = process.env.EMR_PROXY_URL;
const EMR_PROXY_KEY = process.env.EMR_PROXY_KEY || 'ewoo-emr-2026';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { chartNo } = req.body;
  if (!chartNo) return res.status(400).json({ error: 'chartNo required' });

  if (!EMR_PROXY_URL) {
    return res.status(503).json({ error: 'EMR proxy not configured' });
  }

  try {
    const r = await fetch(`${EMR_PROXY_URL}/api/emr/opinion-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EMR_PROXY_KEY,
      },
      body: JSON.stringify({ chartNo }),
    });

    if (!r.ok) {
      const body = await r.text();
      console.error('EMR proxy error:', r.status, body);
      return res.status(r.status).json({ error: 'EMR proxy error' });
    }

    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error('Opinion data error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
