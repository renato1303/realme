export async function handleHealth() {
  const hasGeminiKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim() !== '');
  const env = process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? 'development';
  return {
    ok: true,
    env,
    hasGeminiKey,
    routes: [
      '/api/health',
      '/api/generate-headline',
      '/api/analyze-video',
      '/api/transcribe-clip',
    ],
  };
}
