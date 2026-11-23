import { GoogleGenAI, Type } from '@google/genai';

const GEMINI_AUDIO_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
];

export async function handleTranscribeClip({ audioBuffer, mimetype, customVocabulary }: { audioBuffer: Buffer; mimetype: string; customVocabulary: string }) {
  if (!process.env.GEMINI_API_KEY) {
    const err: any = new Error('GEMINI_API_KEY não configurada no ambiente');
    err.stage = 'config';
    err.status = 500;
    throw err;
  }
  if (!audioBuffer || audioBuffer.length === 0) {
    const err: any = new Error('Áudio vazio');
    err.stage = 'upload';
    err.status = 400;
    throw err;
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const audioBase64 = audioBuffer.toString('base64');
  const transcriptionModels = ['gemini-3.5-transcribe', ...GEMINI_AUDIO_MODELS];

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
      const num = parseFloat(s);
      return isNaN(num) ? 0 : num;
    }
    return 0;
  };

  for (const model of transcriptionModels) {
    try {
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
              { inlineData: { mimeType: mimetype || 'audio/ogg', data: audioBase64 } },
              { text: promptText },
            ],
          },
        ],
        config: callConfig,
      });

      rawResponseText = response.text || '';
      successfulModel = model;
      break;
    } catch (err: any) {
      const status = err.status || err.code || 0;
      const msg = err.message || '';
      if (status === 503 || status === 429 || status === 404 || status === 400 || msg.includes('503') || msg.includes('429') || msg.includes('404')) {
        continue;
      }
      throw err;
    }
  }

  if (!successfulModel || !rawResponseText) {
    const err: any = new Error('O serviço de transcrição está sobrecarregado.');
    err.status = 503;
    err.retryable = true;
    err.stage = 'transcribe';
    throw err;
  }

  let wordsList: any[] = [];
  let fullText = '';

  try {
    let cleaned = rawResponseText.trim();
    if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
    else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();

    if (cleaned.startsWith('{') || cleaned.startsWith('[')) {
      const parsed = JSON.parse(cleaned);
      if (Array.isArray(parsed)) wordsList = parsed;
      else if (parsed.words && Array.isArray(parsed.words)) {
        wordsList = parsed.words;
        fullText = parsed.text || '';
      }
    } else {
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
  } catch (parseErr) {
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

  return { words: normalizedWords, text: fullText };
}
