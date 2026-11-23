import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleGenerateHeadline } from '../src/server-lib/generateHeadline';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', stage: 'routing' });
  }
  try {
    const { topic, style } = req.body || {};
    const result = await handleGenerateHeadline({ topic, style });
    return res.json(result);
  } catch (error: any) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message, stage: error.stage || 'generate', retryable: error.retryable || false });
    }
    return res.status(500).json({ error: error.message || 'Erro interno', stage: 'server' });
  }
}
