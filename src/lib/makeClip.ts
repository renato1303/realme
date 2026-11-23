import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_HIGH } from 'mediabunny';

/**
 * Corta [startSec, endSec] do arquivo ORIGINAL mantendo VÍDEO + ÁUDIO (MP4 H.264/AAC).
 * O vídeo é recodificado (corte exato no quadro, sem lixo antes do início); o áudio é copiado quando possível.
 * Lê o File por fatias; nunca carrega o arquivo inteiro.
 */
export async function makeClip(
  file: File,
  startSec: number,
  endSec: number,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal } = {}
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: startSec, end: endSec },
    video: { codec: 'avc', quality: QUALITY_HIGH, forceTranscode: true, frameRate: 30 },
  });

  for (const d of conversion.discardedTracks) {
    console.warn('[makeClip] faixa descartada:', d.track.type, '— motivo:', d.reason);
  }
  const hasVideo = conversion.utilizedTracks.some((t) => t.type === 'video');
  const hasAudio = conversion.utilizedTracks.some((t) => t.type === 'audio');
  if (!hasVideo) throw new Error('O corte ficou sem vídeo: o navegador não conseguiu processar a faixa de vídeo deste arquivo.');
  console.log(`[makeClip] ${startSec}s–${endSec}s: vídeo=${hasVideo} áudio=${hasAudio}`);

  conversion.onProgress = (p) => opts.onProgress?.(Math.min(1, p));
  opts.signal?.addEventListener('abort', () => conversion.cancel());
  await conversion.execute();

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('Corte vazio.');
  return new Blob([buf], { type: 'video/mp4' });
}
