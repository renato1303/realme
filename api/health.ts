import type { VercelRequest, VercelResponse } from '@vercel/node';
import { handleHealth } from '../src/server-lib/health';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed', stage: 'routing' });
  }
  try {
    const result = await handleHealth();
    return res.json(result);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Erro interno', stage: 'server' });
  }
}
