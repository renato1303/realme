import { ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Output, WavOutputFormat } from 'mediabunny';

/**
 * Extrai SÓ O ÁUDIO de um bloco [startSec, endSec] como WAV mono 16 kHz (≈ 1,9 MB/min).
 * Não decodifica vídeo, então é ordens de grandeza mais rápido que gerar proxy de vídeo.
 * Lê o File por fatias (nunca carrega o arquivo inteiro).
 */
export async function makeAudioBlock(
  file: File,
  startSec: number,
  endSec: number,
  opts: { onProgress?: (p: number) => void; signal?: AbortSignal; stallTimeoutMs?: number } = {}
): Promise<Blob> {
  const { onProgress, signal, stallTimeoutMs = 120_000 } = opts;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new WavOutputFormat(), target: new BufferTarget() });

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start: startSec, end: endSec },
    video: { discard: true },
    audio: { codec: 'pcm-s16', numberOfChannels: 1, sampleRate: 16000, forceTranscode: true },
  });

  for (const d of conversion.discardedTracks) {
    console.warn('[makeAudioBlock] faixa descartada:', d.track.type, '— motivo:', d.reason);
  }
  if (!conversion.utilizedTracks.some((t) => t.type === 'audio')) {
    const why = conversion.discardedTracks.map((t) => `${t.track.type}: ${t.reason}`).join('; ');
    throw new Error(`Este arquivo não tem uma faixa de áudio utilizável (${why || 'nenhuma faixa de áudio encontrada'}).`);
  }

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
  } catch (e) {
    if (Date.now() - lastProgressAt > stallTimeoutMs) {
      throw new Error('A extração de áudio travou (sem progresso).');
    }
    throw e;
  } finally {
    clearInterval(watchdog);
  }

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('Áudio vazio.');
  return new Blob([buf], { type: 'audio/wav' });
}
