import type { VercelRequest, VercelResponse } from '@vercel/node';
import formidable from 'formidable';
import fs from 'fs';
import { handleAnalyzeVideo } from '../src/server-lib/analyzeVideo';

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed', stage: 'routing' });
  }

  const form = formidable({ keepExtensions: true });
  form.parse(req, async (err, fields, files) => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Falha ao processar formulário', stage: 'upload' });
    }

    try {
      const fileEntry = Array.isArray(files.file) ? files.file[0] : files.file;
      if (!fileEntry) {
        return res.status(400).json({ error: 'Áudio vazio', stage: 'upload' });
      }

      const filePath = fileEntry.filepath;
      const mimetype = fileEntry.mimetype || 'audio/ogg';
      const audioBuffer = fs.readFileSync(filePath);

      const rawOffset = Array.isArray(fields.offsetSeconds) ? fields.offsetSeconds[0] : fields.offsetSeconds;
      const offsetSeconds = Number(rawOffset) || 0;

      const result = await handleAnalyzeVideo({ audioBuffer, mimetype, offsetSeconds });

      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.json(result);
    } catch (error: any) {
      if (error.status) {
        return res.status(error.status).json({ error: error.message, stage: error.stage || 'generate', retryable: error.retryable || false });
      }
      return res.status(500).json({ error: error.message || 'Erro interno', stage: 'server' });
    }
  });
}
