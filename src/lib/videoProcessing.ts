import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_LOW,
} from 'mediabunny';

export interface ProgressCallback {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Gera uma versão leve (proxy) de um bloco específico do vídeo: 360p, ~250kbps, 15fps, mantendo áudio.
 */
export async function generateBlockProxy(
  file: File | Blob,
  start: number,
  end: number,
  { onProgress, signal }: ProgressCallback = {}
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  const conversion = await Conversion.init({
    input,
    output,
    trim: {
      start,
      end,
    },
    video: {
      codec: 'avc',
      quality: QUALITY_LOW,
      frameRate: 15,
      processedWidth: 640,
      processedHeight: 360,
    },
  });

  if (!conversion.isValid) {
    throw new Error('Não foi possível gerar o proxy do bloco de vídeo.');
  }

  conversion.onProgress = (p) => onProgress?.(Math.min(100, Math.round(p * 100)));
  signal?.addEventListener('abort', () => conversion.cancel());

  await conversion.execute();

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('Falha ao gerar o proxy do bloco.');
  onProgress?.(100);
  return new Blob([buffer], { type: 'video/mp4' });
}

/**
 * Corta um trecho específico do vídeo original usando mediabunny.
 */
export async function trimVideo(
  file: File | Blob,
  start: number,
  end: number,
  { onProgress, signal }: ProgressCallback = {}
): Promise<Blob> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  const conversion = await Conversion.init({
    input,
    output,
    trim: {
      start,
      end,
    },
  });

  if (!conversion.isValid) {
    throw new Error('Não foi possível cortar o vídeo no trecho selecionado.');
  }

  conversion.onProgress = (p) => onProgress?.(Math.min(100, Math.round(p * 100)));
  signal?.addEventListener('abort', () => conversion.cancel());

  await conversion.execute();

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('Falha ao exportar o trecho cortado.');
  onProgress?.(100);
  return new Blob([buffer], { type: 'video/mp4' });
}
