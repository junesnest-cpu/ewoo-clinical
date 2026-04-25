/**
 * EMR 메모/노트 테이블 탐색 API (진단용)
 * POST /api/emr/find-memos { chartNo }
 */

import { requireAuth } from '../../../lib/verifyAuth';

const EMR_PROXY_URL = process.env.EMR_PROXY_URL;
const EMR_PROXY_KEY = process.env.EMR_PROXY_KEY || 'ewoo-emr-2026';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const a = await requireAuth(req, res);
  if (!a.ok && !a.audited) return;

  const { chartNo } = req.body;
  if (!chartNo) return res.status(400).json({ error: 'chartNo required' });

  if (!EMR_PROXY_URL) {
    return res.status(503).json({ error: 'EMR proxy not configured' });
  }

  try {
    const r = await fetch(`${EMR_PROXY_URL}/api/emr/find-memos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': EMR_PROXY_KEY,
      },
      body: JSON.stringify({ chartNo }),
    });

    if (!r.ok) {
      const body = await r.text();
      return res.status(r.status).json({ error: body });
    }

    const data = await r.json();
    return res.json(data);
  } catch (err) {
    console.error('Find memos error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
