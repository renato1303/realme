import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import { GoogleGenAI, Type } from '@google/genai';

dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: 150 * 1024 * 1024 }, // 150 MB limit per block
});

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(express.json());

  // Initialize Google GenAI
  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY || '',
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // API endpoint for AI Headline generation
  app.post('/api/generate-headline', async (req, res) => {
    try {
      const { topic, style } = req.body;
      if (!topic) {
        return res.status(400).json({ error: 'Topic is required' });
      }

      const prompt = `Gere 3 opções de headlines curtas, virais e magnéticas (com emojis adequados) para Reels do Instagram e TikTok sobre o seguinte tópico: "${topic}". 
Estilo desejado: ${style || 'envolvente, com citação ou pergunta instigante'}.
Retorne estritamente um array JSON com as 3 strings das headlines (ex: ["headline 1", "headline 2", "headline 3"]).`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config: {
          systemInstruction: 'Você é um especialista em marketing digital e criação de roteiros virais para Reels e TikTok. Retorne apenas JSON válido.',
        },
      });

      const text = response.text || '[]';
      let cleaned = text.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
      }

      const headlines = JSON.parse(cleaned);
      res.json({ headlines });
    } catch (error: any) {
      console.error('Gemini headline generation error:', error);
      res.status(500).json({ error: error.message || 'Falha ao gerar headlines com IA' });
    }
  });

  // API endpoint for AI Video Block Analysis
  app.post('/api/analyze-video', upload.single('video'), async (req, res) => {
    let uploadedFileRef: any = null;
    const filePath = req.file?.path;
    const offsetSeconds = Number(req.body.offsetSeconds) || 0;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'Nenhum arquivo de bloco enviado.' });
      }

      console.log(`Uploading block video to Gemini: offset=${offsetSeconds}s, size=${req.file.size} bytes`);

      // Upload file to Gemini Files API
      uploadedFileRef = await ai.files.upload({
        file: req.file.path,
        config: {
          mimeType: req.file.mimetype || 'video/mp4',
        },
      });

      // Poll file state until ACTIVE
      let fileState = uploadedFileRef.state;
      let attempts = 0;
      while (fileState === 'PROCESSING' && attempts < 60) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        const fileInfo = await ai.files.get({ name: uploadedFileRef.name });
        fileState = fileInfo.state;
        attempts++;
      }

      if (fileState !== 'ACTIVE') {
        throw new Error(`Falha no processamento do bloco pelo Gemini (Estado: ${fileState})`);
      }

      const prompt = `Você é um editor especialista em conteúdo viral para Reels e TikTok. Analise este bloco de vídeo e identifique no máximo 6 trechos de alto potencial viral (pontuação de 0 a 100, apenas trechos com score >= 60): picos de emoção, reações, momentos engraçados, revelações ou frases fortes. Cada trecho deve ter entre 15 e 60 segundos, começando no início de uma frase ou ação e terminando de forma natural. Atenção: os tempos devem ser relativos ao início deste bloco (0 segundos é o início do arquivo enviado). Retorne SOMENTE um array JSON com objetos: { startSeconds: number, endSeconds: number, title: string (headline curta com emoji, até 70 caracteres), score: number (60 a 100), reason: string (1 frase explicando por que funciona) }.`;

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: [uploadedFileRef, prompt],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                startSeconds: { type: Type.NUMBER, description: 'Início do trecho em segundos (relativo ao bloco)' },
                endSeconds: { type: Type.NUMBER, description: 'Fim do trecho em segundos (relativo ao bloco)' },
                title: { type: Type.STRING, description: 'Headline curta e chamativa com emoji' },
                score: { type: Type.NUMBER, description: 'Potencial viral de 60 a 100' },
                reason: { type: Type.STRING, description: 'Explicação de 1 frase' },
              },
              required: ['startSeconds', 'endSeconds', 'title', 'score', 'reason'],
            },
          },
        },
      });

      const rawText = response.text || '[]';
      let cleaned = rawText.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
      }

      let clips = JSON.parse(cleaned);

      // Validate and shift clips by offsetSeconds
      clips = clips
        .filter((c: any) => {
          const duration = c.endSeconds - c.startSeconds;
          return typeof c.startSeconds === 'number' && typeof c.endSeconds === 'number' && duration >= 12 && duration <= 65 && c.score >= 60;
        })
        .map((c: any) => ({
          ...c,
          startSeconds: c.startSeconds + offsetSeconds,
          endSeconds: c.endSeconds + offsetSeconds,
        }));

      res.json({ clips });
    } catch (error: any) {
      console.error('Video analysis block error:', error);
      const isRateLimit = error.status === 429 || error.message?.includes('429') || error.message?.includes('RESOURCE_EXHAUSTED');
      if (isRateLimit) {
        return res.status(429).json({ error: 'Limite de requisições da IA atingido (429). Aguarde alguns segundos.', retryAfter: 15 });
      }
      res.status(500).json({ error: error.message || 'Falha ao analisar o bloco de vídeo com IA.' });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('Failed to delete temp file:', e);
        }
      }
      if (uploadedFileRef?.name) {
        ai.files.delete({ name: uploadedFileRef.name }).catch(() => {});
      }
    }
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
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
