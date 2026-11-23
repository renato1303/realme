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
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB limit per block (Inline safe)
});

const GEMINI_AUDIO_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
];

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

  // Health check endpoint
  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // API endpoint for AI Headline generation
  app.post('/api/generate-headline', async (req, res) => {
    try {
      const { topic, style } = req.body;
      if (!topic) {
        return res.status(400).json({ error: 'Topic is required', stage: 'validation' });
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
      res.status(500).json({ error: error.message || 'Falha ao gerar headlines com IA', stage: 'generate' });
    }
  });

  // Helper to execute Gemini generation with model fallback and round retries
  async function executeGeminiWithRetry(audioBase64: string, mimetype: string, prompt: string): Promise<{ rawText: string; model: string; durationSec: number }> {
    const retryDelaysMs = [0, 15000, 45000, 90000];
    let rawText = '';
    let successfulModel = '';
    let callDurationSec = 0;

    for (let round = 0; round < retryDelaysMs.length; round++) {
      const delay = retryDelaysMs[round];
      if (delay > 0) {
        console.log(`[Server] All Gemini audio models overloaded (53/429). Waiting ${delay / 1000}s before retry round ${round + 1}...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }

      let roundSuccess = false;
      for (const model of GEMINI_AUDIO_MODELS) {
        const startTime = Date.now();
        try {
          console.log(`[Server] Attempting audio analysis with model: ${model} (round ${round + 1})`);
          const response = await ai.models.generateContent({
            model,
            contents: [
              {
                role: 'user',
                parts: [
                  { inlineData: { mimeType: mimetype, data: audioBase64 } },
                  { text: prompt },
                ],
              },
            ],
            config: {
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startSeconds: { type: Type.NUMBER, description: 'Início do trecho em segundos (relativo ao bloco)' },
                    endSeconds: { type: Type.NUMBER, description: 'Fim do trecho em segundos (relativo ao bloco)' },
                    title: { type: Type.STRING, description: 'Headline curta e chamativa com emoji, até 70 caracteres' },
                    score: { type: Type.NUMBER, description: 'Pontuação de viralização de 40 a 100' },
                    reason: { type: Type.STRING, description: 'Explicação de 1 frase' },
                  },
                  required: ['startSeconds', 'endSeconds', 'title', 'score', 'reason'],
                },
              },
            },
          });

          callDurationSec = (Date.now() - startTime) / 1000;
          rawText = response.text || '[]';
          successfulModel = model;
          roundSuccess = true;
          break;
        } catch (err: any) {
          callDurationSec = (Date.now() - startTime) / 1000;
          const status = err.status || err.code || 0;
          const msg = err.message || '';
          const isOverloadedOrNotFound =
            status === 503 ||
            status === 429 ||
            status === 404 ||
            msg.includes('503') ||
            msg.includes('429') ||
            msg.includes('404') ||
            msg.includes('UNAVAILABLE') ||
            msg.includes('RESOURCE_EXHAUSTED') ||
            msg.includes('NOT_FOUND');

          console.warn(`[Server] Model ${model} failed in ${callDurationSec.toFixed(1)}s (status ${status}): ${msg}`);

          if (isOverloadedOrNotFound) {
            continue;
          } else {
            throw err;
          }
        }
      }

      if (roundSuccess) break;
    }

    if (!successfulModel) {
      const err: any = new Error('O Gemini está sobrecarregado no momento. Tente novamente em alguns minutos.');
      err.status = 503;
      err.retryable = true;
      throw err;
    }

    return { rawText, model: successfulModel, durationSec: callDurationSec };
  }

  // API endpoint for AI Audio Block Analysis (Generous clips, score 50 min, automatic 2nd call if <2 clips)
  app.post('/api/analyze-video', upload.single('file'), async (req, res) => {
    const filePath = req.file?.path;
    const offsetSeconds = Number(req.body.offsetSeconds) || 0;
    const fileSize = req.file?.size || 0;

    try {
      if (!req.file || fileSize === 0 || !filePath || !fs.existsSync(filePath)) {
        return res.status(400).json({ error: 'Áudio vazio', stage: 'upload' });
      }

      if (fileSize > 20 * 1024 * 1024) {
        if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        return res.status(413).json({ error: 'Áudio acima de 20 MB', stage: 'upload' });
      }

      const audioBuffer = fs.readFileSync(filePath);
      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({ error: 'Áudio vazio', stage: 'upload' });
      }

      const audioBase64 = audioBuffer.toString('base64');
      const mimetype = req.file.mimetype || 'audio/ogg';

      console.log(`[Server] Analyzing Opus audio inline: offset=${offsetSeconds}s, size=${fileSize} bytes, mimetype=${mimetype}, base64Length=${audioBase64.length}`);

      const prompt1 = `Você é um editor especialista em conteúdo viral para Reels e TikTok. Ouça este trecho de uma live/podcast e seja generoso: inclua todo momento que funcione sozinho como um vídeo curto (reação, história completa, opinião forte, humor, notícia, informação surpreendente, dica útil, polêmica, pergunta e resposta). Identifique de 3 a 7 trechos com potencial de viralizar. Cada trecho deve ter entre 25 e 65 segundos, começar no início de uma ideia e terminar quando a ideia fecha, sem sobreposição. Os tempos devem ser em segundos RELATIVOS ao início deste áudio. Retorne SOMENTE JSON: array de { startSeconds, endSeconds, title (headline curta e chamativa em português, até 70 caracteres, pode ter 1 emoji), score (0 a 100), reason (1 frase) }. Considere trechos com score mínimo 50.`;

      let { rawText, model, durationSec } = await executeGeminiWithRetry(audioBase64, mimetype, prompt1);

      console.log(`[Server] SUCCESS with model: ${model} | Audio size: ${fileSize} bytes | Duration: ${durationSec.toFixed(1)}s`);
      console.log(`[Server] Gemini response preview (first 500 chars):`, rawText.substring(0, 500));

      let cleaned = rawText.trim();
      if (cleaned.startsWith('```json')) {
        cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
      } else if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();
      }

      let clips = JSON.parse(cleaned);

      // If less than 2 clips returned, make a second call with score min 40
      if (!Array.isArray(clips) || clips.length < 2) {
        console.log(`[Server] First call returned ${clips?.length || 0} clips. Making second call with min score 40...`);
        const prompt2 = `Você é um editor especialista em conteúdo viral para Reels e TikTok. Ouça este trecho e traga mais trechos, mesmo que menos intensos (score mínimo 40), de 25 a 65 segundos, sem sobreposição. Retorne SOMENTE JSON array de { startSeconds, endSeconds, title, score, reason }.`;
        try {
          const res2 = await executeGeminiWithRetry(audioBase64, mimetype, prompt2);
          let cleaned2 = res2.rawText.trim();
          if (cleaned2.startsWith('```json')) cleaned2 = cleaned2.replace(/^```json/, '').replace(/```$/, '').trim();
          else if (cleaned2.startsWith('```')) cleaned2 = cleaned2.replace(/^```/, '').replace(/```$/, '').trim();
          const clips2 = JSON.parse(cleaned2);
          if (Array.isArray(clips2)) {
            clips = [...clips, ...clips2];
          }
        } catch (e2) {
          console.warn('[Server] Second call failed or skipped:', e2);
        }
      }

      // Validate and shift clips by offsetSeconds (duration 25 to 65s, score >= 40)
      clips = clips
        .filter((c: any) => {
          const duration = c.endSeconds - c.startSeconds;
          return typeof c.startSeconds === 'number' && typeof c.endSeconds === 'number' && duration >= 22 && duration <= 70 && c.score >= 40;
        })
        .map((c: any) => ({
          ...c,
          startSeconds: c.startSeconds + offsetSeconds,
          endSeconds: c.endSeconds + offsetSeconds,
        }));

      console.log(`[Server] Analysis completed successfully. Found ${clips.length} valid clips.`);
      res.json({ clips });
    } catch (error: any) {
      console.error('[Server] Audio analysis block error:', error);
      const isRateLimit = error.status === 429 || error.status === 503 || error.retryable || error.message?.includes('429') || error.message?.includes('503');
      if (isRateLimit) {
        return res.status(503).json({
          error: 'O Gemini está sobrecarregado no momento. Tente novamente em alguns minutos.',
          stage: 'generate',
          retryable: true,
        });
      }
      res.status(500).json({ error: error.message || 'Falha ao analisar o bloco de áudio com IA.', stage: 'generate', retryable: false });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('Failed to delete temp file:', e);
        }
      }
    }
  });

  // API endpoint for Clip Transcription with word timestamps
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
      if (!audioBuffer || audioBuffer.length === 0) {
        return res.status(400).json({ error: 'Áudio vazio', stage: 'upload' });
      }

      const audioBase64 = audioBuffer.toString('base64');
      const mimetype = req.file.mimetype || 'audio/ogg';

      console.log(`[Server][Transcribe] Starting transcription: size=${fileSize} bytes, mimetype=${mimetype}, vocabulary=${customVocabulary}`);

      const retryDelaysMs = [0, 10000, 30000, 60000];
      let rawResponseText = '';
      let successfulModel = '';

      const parseTimestampToSeconds = (val: any): number => {
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
          const s = val.trim();
          if (s.endsWith('s')) {
            const num = parseFloat(s.slice(0, -1));
            return isNaN(num) ? 0 : num;
          }
          if (s.includes(':')) {
            const parts = s.split(':');
            if (parts.length === 3) {
              const h = parseFloat(parts[0]) || 0;
              const m = parseFloat(parts[1]) || 0;
              const sec = parseFloat(parts[2]) || 0;
              return h * 3600 + m * 60 + sec;
            }
            if (parts.length === 2) {
              const m = parseFloat(parts[0]) || 0;
              const sec = parseFloat(parts[1]) || 0;
              return m * 60 + sec;
            }
          }
          const num = parseFloat(s);
          return isNaN(num) ? 0 : num;
        }
        return 0;
      };

      for (let round = 0; round < retryDelaysMs.length; round++) {
        const delay = retryDelaysMs[round];
        if (delay > 0) {
          console.log(`[Server][Transcribe] Retrying transcription after ${delay / 1000}s (round ${round + 1})...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        // Try gemini-3.5-transcribe first, then fallback models
        const transcriptionModels = ['gemini-3.5-transcribe', ...GEMINI_AUDIO_MODELS];
        let roundSuccess = false;

        for (const model of transcriptionModels) {
          try {
            console.log(`[Server][Transcribe] Attempting with model: ${model}`);
            const isTranscribeModel = model.includes('transcribe');

            const promptText = isTranscribeModel
              ? `Transcreva este áudio em português do Brasil com precisão máxima. Forneça o tempo de início (start) e fim (end) em segundos para cada palavra individual. Vocabulário prioritário: ${customVocabulary}`
              : `Transcreva este áudio em português do Brasil com precisão e retorne estritamente JSON contendo a transcrição completa no campo "text" e uma lista de palavras com seus tempos exatos em segundos no campo "words": [{ "word": "...", "start": 0.0, "end": 0.0 }]. Vocabulário prioritário: ${customVocabulary}`;

            const callConfig: any = isTranscribeModel
              ? { audioTranscriptionConfig: { wordTimestamp: true } }
              : {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                      text: { type: Type.STRING },
                      words: {
                        type: Type.ARRAY,
                        items: {
                          type: Type.OBJECT,
                          properties: {
                            word: { type: Type.STRING },
                            start: { type: Type.NUMBER },
                            end: { type: Type.NUMBER },
                          },
                          required: ['word', 'start', 'end'],
                        },
                      },
                    },
                    required: ['text', 'words'],
                  },
                };

            const response = await ai.models.generateContent({
              model,
              contents: [
                {
                  role: 'user',
                  parts: [
                    { inlineData: { mimeType: mimetype, data: audioBase64 } },
                    { text: promptText },
                  ],
                },
              ],
              config: callConfig,
            });

            rawResponseText = response.text || '';
            successfulModel = model;
            roundSuccess = true;
            break;
          } catch (err: any) {
            const status = err.status || err.code || 0;
            const msg = err.message || '';
            console.warn(`[Server][Transcribe] Model ${model} failed (status ${status}): ${msg}`);
            if (status === 503 || status === 429 || status === 404 || status === 400 || msg.includes('503') || msg.includes('429') || msg.includes('404')) {
              continue;
            } else {
              throw err;
            }
          }
        }

        if (roundSuccess) break;
      }

      if (!successfulModel || !rawResponseText) {
        return res.status(503).json({ error: 'O serviço de transcrição está sobrecarregado. Tente novamente.', stage: 'transcribe', retryable: true });
      }

      console.log(`[Server][Transcribe] Success with model: ${successfulModel}. Raw response preview (first 1500 chars):`, rawResponseText.substring(0, 1500));

      let wordsList: any[] = [];
      let fullText = '';

      try {
        let cleaned = rawResponseText.trim();
        if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();

        if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
          const parsed = JSON.parse(cleaned);
          if (Array.isArray(parsed)) {
            wordsList = parsed;
          } else if (parsed.words && Array.isArray(parsed.words)) {
            wordsList = parsed.words;
            fullText = parsed.text || '';
          } else if (parsed.transcription && Array.isArray(parsed.transcription)) {
            wordsList = parsed.transcription;
          }
        } else {
          // If raw text or transcript model format
          fullText = rawResponseText;
          const tokens = rawResponseText.split(/\s+/).filter(Boolean);
          let currentTime = 0;
          wordsList = tokens.map((w, idx) => {
            const wStart = currentTime;
            const wEnd = currentTime + 0.3;
            currentTime = wEnd;
            return { word: w, start: wStart, end: wEnd };
          });
        }
      } catch (parseErr) {
        console.warn('[Server][Transcribe] JSON parse error on response, falling back to word tokenization:', parseErr);
        fullText = rawResponseText;
        const tokens = rawResponseText.split(/\s+/).filter(Boolean);
        let currentTime = 0;
        wordsList = tokens.map((w) => {
          const wStart = currentTime;
          const wEnd = currentTime + 0.3;
          currentTime = wEnd;
          return { word: w, start: wStart, end: wEnd };
        });
      }

      // Tolerant normalization of words
      const normalizedWords = wordsList
        .map((w: any) => {
          const wordStr = String(w.word || w.text || w.content || '').trim();
          const rawStart = w.start ?? w.startOffset ?? w.start_offset ?? w.startTime ?? 0;
          const rawEnd = w.end ?? w.endOffset ?? w.end_offset ?? w.endTime ?? (rawStart + 0.3);
          const startSec = parseTimestampToSeconds(rawStart);
          const endSec = parseTimestampToSeconds(rawEnd);
          return {
            word: wordStr,
            start: startSec,
            end: Math.max(endSec, startSec + 0.05),
          };
        })
        .filter((w) => w.word.length > 0);

      if (!fullText) {
        fullText = normalizedWords.map((w) => w.word).join(' ');
      }

      console.log(`[Server][Transcribe] Successfully normalized ${normalizedWords.length} words.`);
      res.json({ words: normalizedWords, text: fullText });
    } catch (error: any) {
      console.error('[Server][Transcribe] Error:', error);
      const isRateLimit = error.status === 429 || error.status === 503 || error.retryable || error.message?.includes('429') || error.message?.includes('503');
      if (isRateLimit) {
        return res.status(503).json({ error: 'O serviço de transcrição está sobrecarregado. Tente novamente.', stage: 'transcribe', retryable: true });
      }
      res.status(500).json({ error: error.message || 'Falha na transcrição do áudio', stage: 'transcribe', retryable: false });
    } finally {
      if (filePath && fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (e) {
          console.warn('Failed to delete temp file:', e);
        }
      }
    }
  });

  // Catch-all 404 for any other /api/* route returning JSON
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found', stage: 'routing' });
  });

  // Express error handling middleware to catch Multer errors and prevent falling through to Vite HTML fallback
  app.use((err: any, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('[Server] Express error middleware caught:', err);
    if (res.headersSent) {
      return next(err);
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'Áudio acima do limite permitido (20 MB)', stage: 'upload', retryable: false });
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
    console.log(`[Server] Registered API routes: GET /api/health, POST /api/generate-headline, POST /api/analyze-video`);
  });
}

startServer();
