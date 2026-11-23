import { GoogleGenAI, Type } from '@google/genai';

const GEMINI_AUDIO_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
];

export async function handleAnalyzeVideo({ audioBuffer, mimetype, offsetSeconds }: { audioBuffer: Buffer; mimetype: string; offsetSeconds: number }) {
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

  if (audioBuffer.length > 4 * 1024 * 1024) {
    const err: any = new Error('Áudio acima de 4 MB');
    err.stage = 'upload';
    err.status = 413;
    throw err;
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

  const audioBase64 = audioBuffer.toString('base64');
  const prompt1 = `Você é um editor especialista em conteúdo viral para Reels e TikTok. Ouça este trecho de uma live/podcast e seja generoso: inclua todo momento que funcione sozinho como um vídeo curto (reação, história completa, opinião forte, humor, notícia, informação surpreendente, dica útil, polêmica, pergunta e resposta). Identifique de 3 a 7 trechos com potencial de viralizar. Cada trecho deve ter entre 25 e 65 segundos, começar no início de uma ideia e terminar quando a ideia fecha, sem sobreposição. Os tempos devem ser em segundos RELATIVOS ao início deste áudio. Retorne SOMENTE JSON: array de { startSeconds, endSeconds, title (headline curta e chamativa em português, até 70 caracteres, pode ter 1 emoji), score (0 a 100), reason (1 frase) }. Considere trechos com score mínimo 50.`;

  let rawText = '';
  let successfulModel = '';

  for (const model of GEMINI_AUDIO_MODELS) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: [
          {
            role: 'user',
            parts: [
              { inlineData: { mimeType: mimetype || 'audio/ogg', data: audioBase64 } },
              { text: prompt1 },
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
                startSeconds: { type: Type.NUMBER },
                endSeconds: { type: Type.NUMBER },
                title: { type: Type.STRING },
                score: { type: Type.NUMBER },
                reason: { type: Type.STRING },
              },
              required: ['startSeconds', 'endSeconds', 'title', 'score', 'reason'],
            },
          },
        },
      });

      rawText = response.text || '[]';
      successfulModel = model;
      break;
    } catch (err: any) {
      const status = err.status || err.code || 0;
      const msg = err.message || '';
      if (status === 503 || status === 429 || status === 404 || msg.includes('503') || msg.includes('429') || msg.includes('404')) {
        continue;
      }
      throw err;
    }
  }

  if (!successfulModel) {
    const err: any = new Error('O Gemini está sobrecarregado no momento. Tente novamente em alguns minutos.');
    err.status = 503;
    err.retryable = true;
    err.stage = 'generate';
    throw err;
  }

  let cleaned = rawText.trim();
  if (cleaned.startsWith('```json')) cleaned = cleaned.replace(/^```json/, '').replace(/```$/, '').trim();
  else if (cleaned.startsWith('```')) cleaned = cleaned.replace(/^```/, '').replace(/```$/, '').trim();

  let clips = JSON.parse(cleaned);

  if (!Array.isArray(clips) || clips.length < 2) {
    const prompt2 = `Você é um editor especialista em conteúdo viral para Reels e TikTok. Ouça este trecho e traga mais trechos, mesmo que menos intensos (score mínimo 40), de 25 a 65 segundos, sem sobreposição. Retorne SOMENTE JSON array de { startSeconds, endSeconds, title, score, reason }.`;
    for (const model of GEMINI_AUDIO_MODELS) {
      try {
        const res2 = await ai.models.generateContent({
          model,
          contents: [
            {
              role: 'user',
              parts: [
                { inlineData: { mimeType: mimetype || 'audio/ogg', data: audioBase64 } },
                { text: prompt2 },
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
                  startSeconds: { type: Type.NUMBER },
                  endSeconds: { type: Type.NUMBER },
                  title: { type: Type.STRING },
                  score: { type: Type.NUMBER },
                  reason: { type: Type.STRING },
                },
                required: ['startSeconds', 'endSeconds', 'title', 'score', 'reason'],
              },
            },
          },
        });
        let cleaned2 = (res2.text || '[]').trim();
        if (cleaned2.startsWith('```json')) cleaned2 = cleaned2.replace(/^```json/, '').replace(/```$/, '').trim();
        else if (cleaned2.startsWith('```')) cleaned2 = cleaned2.replace(/^```/, '').replace(/```$/, '').trim();
        const clips2 = JSON.parse(cleaned2);
        if (Array.isArray(clips2)) {
          clips = [...clips, ...clips2];
        }
        break;
      } catch (e2) {
        // ignore secondary fallback error
      }
    }
  }

  clips = clips
    .filter((c: any) => {
      const duration = c.endSeconds - c.startSeconds;
      return typeof c.startSeconds === 'number' && typeof c.endSeconds === 'number' && duration >= 20 && duration <= 70 && c.score >= 40;
    })
    .map((c: any) => ({
      ...c,
      startSeconds: c.startSeconds + offsetSeconds,
      endSeconds: c.endSeconds + offsetSeconds,
    }));

  return { clips };
}
