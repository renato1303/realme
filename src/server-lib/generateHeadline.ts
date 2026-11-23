import { GoogleGenAI } from '@google/genai';

export async function handleGenerateHeadline({ topic, style }: { topic: string; style?: string }) {
  if (!process.env.GEMINI_API_KEY) {
    const err: any = new Error('GEMINI_API_KEY não configurada no ambiente');
    err.stage = 'config';
    err.status = 500;
    throw err;
  }
  if (!topic) {
    const err: any = new Error('Topic is required');
    err.stage = 'validation';
    err.status = 400;
    throw err;
  }

  const ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
  });

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
  return { headlines };
}
