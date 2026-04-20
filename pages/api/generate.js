/**
 * AI 서식 초안 생성 API
 * POST /api/generate { formType, patientData, additionalContext }
 */
import { generateFormDraft } from '../../lib/claude';
import { verifyAuth } from '../../lib/verifyAuth';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const user = await verifyAuth(req);
  if (!user) return res.status(401).json({ error: 'unauthorized' });

  const { formType, patientData, additionalContext } = req.body;
  if (!formType || !patientData) {
    return res.status(400).json({ error: 'formType and patientData required' });
  }

  try {
    const draft = await generateFormDraft(formType, patientData, additionalContext);
    return res.json({ draft });
  } catch (err) {
    console.error('Generate error:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
