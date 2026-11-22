import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output } from 'mediabunny';

/**
 * Gera um proxy leve (360p, ~250 kbps, 15 fps, áudio 48 kbps) de UM bloco [startSec, endSec]
 * de um arquivo de vídeo grande, lendo o File por fatias (nunca carrega o arquivo inteiro).
 */
export async function makeProxyBlock(
  file: File,
  startSec: number,
  endSec: number,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal; stallTimeoutMs?: number } = {}
): Promise<Blob> {
  const { onProgress, signal, stallTimeoutMs = 120_000 } = opts;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: startSec, end: endSec },
    video: {
      height: 360, // largura é deduzida mantendo a proporção
      frameRate: 15,
      bitrate: 250_000,
      codec: 'avc',
      forceTranscode: true,
    },
    audio: { bitrate: 48_000, numberOfChannels: 1, sampleRate: 22050, codec: 'aac', forceTranscode: true },
  });

  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((t) => `${t.track.type}: ${t.reason}`).join('; ');
    throw new Error(`Vídeo não pôde ser processado pelo navegador (${why || 'sem faixas utilizáveis'}).`);
  }

  // Watchdog: se o progresso ficar parado, cancela com erro claro em vez de travar em silêncio.
  let lastProgressAt = Date.now();
  conversion.onProgress = (p) => {
    lastProgressAt = Date.now();
    onProgress?.(Math.min(1, p));
  };
  const watchdog = setInterval(() => {
    if (Date.now() - lastProgressAt > stallTimeoutMs) {
      clearInterval(watchdog);
      conversion.cancel();
    }
  }, 5000);
  signal?.addEventListener('abort', () => conversion.cancel());

  try {
    await conversion.execute();
  } catch (e: any) {
    if (Date.now() - lastProgressAt > stallTimeoutMs) {
      throw new Error('A geração do proxy travou (sem progresso). Tente reduzir o intervalo ou outro arquivo.');
    }
    throw e;
  } finally {
    clearInterval(watchdog);
  }

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('Proxy vazio.');
  return new Blob([buf], { type: 'video/mp4' });
}
