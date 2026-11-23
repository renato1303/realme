import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import os from 'os';

import { handleHealth } from './src/server-lib/health';
import { handleGenerateHeadline } from './src/server-lib/generateHeadline';
import { handleAnalyzeVideo } from './src/server-lib/analyzeVideo';
import { handleTranscribeClip } from './src/server-lib/transcribeClip';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB limit
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Health check endpoint
  app.get('/api/health', async (_req, res) => {
    try {
      const result = await handleHealth();
      res.json(result);
    } catch (error: any) {
      res.status(500).json({ error: error.message || 'Erro interno', stage: 'server' });
    }
  });

  // API endpoint for AI Headline generation
  app.post('/api/generate-headline', async (req, res) => {
    try {
      const { topic, style } = req.body || {};
      const result = await handleGenerateHeadline({ topic, style });
      res.json(result);
    } catch (error: any) {
      const status = error.status || 500;
      res.status(status).json({ error: error.message || 'Falha ao gerar headlines com IA', stage: error.stage || 'generate', retryable: error.retryable || false });
    }
  });

  // API endpoint for AI Audio Block Analysis
  app.post('/api/analyze-video', upload.single('file'), async (req, res) => {
    const filePath = req.file?.path;
    const offsetSeconds = Number(req.body.offsetSeconds) || 0;
    const fileSize = req.file?.size || 0;

    try {
      if (!req.file || fileSize === 0 || !filePath || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Áudio vazio', stage: 'upload' });
      }

      if (fileSize > 4 * 1024 * 1024) {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(413).json({ error: 'Áudio acima de 4 MB', stage: 'upload' });
      }

      const audioBuffer = fs.readFileSync(filePath);
      const mimetype = req.file.mimetype || 'audio/ogg';

      const result = await handleAnalyzeVideo({ audioBuffer, mimetype, offsetSeconds });
      res.json(result);
    } catch (error: any) {
      const status = error.status || 500;
      res.status(status).json({ error: error.message || 'Falha ao analisar o bloco de áudio com IA.', stage: error.stage || 'generate', retryable: error.retryable || false });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          // ignore
        }
      }
    }
  });

  // API endpoint for Clip Transcription
  app.post('/api/transcribe-clip', upload.single('file'), async (req, res) => {
    const filePath = req.file?.path;
    const fileSize = req.file?.size || 0;
    const customVocabulary = req.body.customVocabulary || '';

    try {
      if (!req.file || fileSize === 0 || !filePath || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Áudio vazio', stage: 'upload' });
      }

      if (fileSize > 8 * 1024 * 1024) {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(413).json({ error: 'Áudio acima de 8 MB', stage: 'upload' });
      }

      const audioBuffer = fs.readFileSync(filePath);
      const mimetype = req.file.mimetype || 'audio/ogg';

      const result = await handleTranscribeClip({ audioBuffer, mimetype, customVocabulary });
      res.json(result);
    } catch (error: any) {
      const status = error.status || 500;
      res.status(status).json({ error: error.message || 'Falha na transcrição do áudio', stage: error.stage || 'transcribe', retryable: error.retryable || false });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          // ignore
        }
      }
    }
  });

  // Catch-all 404 for any other /api/* route returning JSON
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'Rota não encontrada', stage: 'routing' });
  });

  // Express error handling middleware
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (res.headersSent) {
      return next(err);
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Áudio acima do limite permitido', stage: 'upload', retryable: false });
    }
    res.status(500).json({ error: err.message || 'Erro interno no servidor', stage: 'server', retryable: false });
  });

  // Vite dev server integration
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
