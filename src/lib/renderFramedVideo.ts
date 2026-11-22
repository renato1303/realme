import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type VideoSample,
} from 'mediabunny';
import { TemplateConfig } from '../types';

/**
 * Renderização "offline" (quadro a quadro) do template + vídeo.
 *
 * Diferente do método antigo (tocar o vídeo em tempo real e gravar o canvas com
 * MediaRecorder), aqui cada frame do vídeo original é decodificado, composto no
 * template e re-codificado com o timestamp ORIGINAL. Resultado:
 *  - nenhum frame perdido/duplicado (sem travadas), mesmo que o PC seja lento;
 *  - frame rate constante (30 fps) -> reprodução fluida em Instagram/TikTok/editores;
 *  - áudio original copiado sem recodificar -> sincronia perfeita, sem "delay";
 *  - funciona em segundo plano (não depende de a aba estar em foco).
 */

export function isFastExportSupported(): boolean {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

function getOutputSize(config: TemplateConfig) {
  if (config.aspectRatio === '16:9') return { width: 1920, height: 1080 };
  const height = config.aspectRatio === '1:1' ? 1080 : config.aspectRatio === '4:5' ? 1350 : 1920;
  return { width: 1080, height };
}

function wrapText(
  ctx: OffscreenCanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
) {
  const words = text.split(' ');
  let line = '';
  let currentY = y;
  for (let n = 0; n < words.length; n++) {
    const testLine = line + words[n] + ' ';
    if (ctx.measureText(testLine).width > maxWidth && n > 0) {
      ctx.fillText(line, x, currentY);
      line = words[n] + ' ';
      currentY += lineHeight;
    } else {
      line = testLine;
    }
  }
  ctx.fillText(line, x, currentY);
}

async function loadAvatar(src: string): Promise<ImageBitmap | null> {
  if (!src) return null;
  try {
    const res = await fetch(src);
    const blob = await res.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

async function ensureFonts(config: TemplateConfig) {
  try {
    await Promise.all([
      document.fonts.load('bold 36px Inter'),
      document.fonts.load('28px Inter'),
      document.fonts.load(`bold 46px ${config.headlineFont}`),
    ]);
    await document.fonts.ready;
  } catch {
    /* segue com a fonte de fallback */
  }
}

/** Geometria da área do vídeo (mesma matemática do exportador antigo). */
function getLayout(config: TemplateConfig, width: number, height: number) {
  const topMargin = config.paddingTop * 3;
  const sideMargin = config.paddingSides * 10;
  const avatarSize = 90;
  const avatarX = sideMargin + 20;
  const avatarY = topMargin + 20;
  const headlineY = avatarY + avatarSize + 70;
  const videoAreaTop = headlineY + 120;
  const videoAreaBottom = height - (config.showBottomBar ? 140 : 60);
  return {
    sideMargin,
    avatarSize,
    avatarX,
    avatarY,
    headlineY,
    videoAreaTop,
    videoAreaHeight: videoAreaBottom - videoAreaTop,
    videoAreaWidth: width - sideMargin * 2,
    videoAreaX: sideMargin,
    cornerRadius: config.videoRounded * 3,
  };
}

/** Desenha UMA vez tudo o que não muda entre os frames (fundo, avatar, textos, sombra, barra inferior). */
function buildStaticLayer(
  config: TemplateConfig,
  width: number,
  height: number,
  avatar: ImageBitmap | null
): OffscreenCanvas {
  const layer = new OffscreenCanvas(width, height);
  const ctx = layer.getContext('2d')!;
  const L = getLayout(config, width, height);

  // Fundo
  ctx.fillStyle = config.backgroundColor;
  ctx.fillRect(0, 0, width, height);
  if (config.backgroundStyle === 'gradient') {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, config.backgroundColor);
    grad.addColorStop(1, config.backgroundSecondaryColor);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  // Avatar
  ctx.save();
  ctx.beginPath();
  ctx.arc(L.avatarX + L.avatarSize / 2, L.avatarY + L.avatarSize / 2, L.avatarSize / 2, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (avatar) {
    ctx.drawImage(avatar, L.avatarX, L.avatarY, L.avatarSize, L.avatarSize);
  } else {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(L.avatarX, L.avatarY, L.avatarSize, L.avatarSize);
  }
  ctx.restore();

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(L.avatarX + L.avatarSize / 2, L.avatarY + L.avatarSize / 2, L.avatarSize / 2, 0, Math.PI * 2);
  ctx.stroke();

  // Nome + @
  ctx.textAlign = 'left';
  ctx.fillStyle = config.headlineColor;
  ctx.font = 'bold 36px Inter, sans-serif';
  ctx.fillText(config.profileName, L.avatarX + L.avatarSize + 24, L.avatarY + 38);
  ctx.fillStyle = '#64748b';
  ctx.font = '28px Inter, sans-serif';
  ctx.fillText(`@${config.profileHandle}`, L.avatarX + L.avatarSize + 24, L.avatarY + 80);

  // Headline
  ctx.fillStyle = config.headlineColor;
  ctx.font = `bold 46px ${config.headlineFont}, sans-serif`;
  ctx.textAlign = config.headlineAlign === 'center' ? 'center' : config.headlineAlign === 'right' ? 'right' : 'left';
  const headlineX =
    config.headlineAlign === 'center' ? width / 2 : config.headlineAlign === 'right' ? width - L.sideMargin : L.avatarX;
  wrapText(ctx, config.headline, headlineX, L.headlineY, width - L.sideMargin * 2, 60);
  ctx.textAlign = 'left';

  // Moldura preta do vídeo (+ sombra, calculada só uma vez)
  ctx.save();
  if (config.videoShadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
    ctx.shadowBlur = 30;
    ctx.shadowOffsetY = 15;
  }
  ctx.beginPath();
  ctx.roundRect(L.videoAreaX, L.videoAreaTop, L.videoAreaWidth, L.videoAreaHeight, L.cornerRadius);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.restore();

  // Barra inferior
  if (config.showBottomBar) {
    const barHeight = 90;
    const barY = height - barHeight - 30;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(L.sideMargin, barY, L.videoAreaWidth, barHeight, 20);
    ctx.fillStyle = config.bottomBarBg;
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 28px Inter, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(config.bottomBarText, L.sideMargin + 30, barY + 58);
    ctx.restore();
  }

  return layer;
}

export interface RenderOptions {
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

export async function renderFramedVideo(
  file: Blob,
  config: TemplateConfig,
  { onProgress, signal }: RenderOptions = {}
): Promise<Blob> {
  const { width, height } = getOutputSize(config);
  const L = getLayout(config, width, height);

  await ensureFonts(config);
  const avatar = await loadAvatar(config.profileAvatar);
  const staticLayer = buildStaticLayer(config, width, height, avatar);

  const frameCanvas = new OffscreenCanvas(width, height);
  const fctx = frameCanvas.getContext('2d', { alpha: false })!;

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  const conversion = await Conversion.init({
    input,
    output,
    video: {
      codec: 'avc',
      quality: QUALITY_HIGH,
      frameRate: 30, // CFR: evita o "vídeo com delay" de VFR
      keyFrameInterval: 2,
      processedWidth: width,
      processedHeight: height,
      process: (sample: VideoSample) => {
        fctx.drawImage(staticLayer, 0, 0);

        const vW = sample.displayWidth;
        const vH = sample.displayHeight;
        const vRatio = vW / vH;
        const targetRatio = L.videoAreaWidth / L.videoAreaHeight;

        let drawW = L.videoAreaWidth;
        let drawH = L.videoAreaHeight;
        let drawX = L.videoAreaX;
        let drawY = L.videoAreaTop;

        if (config.videoFit === 'contain') {
          if (vRatio > targetRatio) {
            drawH = L.videoAreaWidth / vRatio;
            drawY = L.videoAreaTop + (L.videoAreaHeight - drawH) / 2;
          } else {
            drawW = L.videoAreaHeight * vRatio;
            drawX = L.videoAreaX + (L.videoAreaWidth - drawW) / 2;
          }
        } else if (vRatio > targetRatio) {
          drawW = L.videoAreaHeight * vRatio;
          drawX = L.videoAreaX + (L.videoAreaWidth - drawW) / 2;
        } else {
          drawH = L.videoAreaWidth / vRatio;
          drawY = L.videoAreaTop + (L.videoAreaHeight - drawH) / 2;
        }

        fctx.save();
        fctx.beginPath();
        fctx.roundRect(L.videoAreaX, L.videoAreaTop, L.videoAreaWidth, L.videoAreaHeight, L.cornerRadius);
        fctx.clip();
        sample.draw(fctx, drawX, drawY, drawW, drawH);
        fctx.restore();

        if (config.videoBorder) {
          fctx.lineWidth = 4;
          fctx.strokeStyle = config.videoBorderColor;
          fctx.beginPath();
          fctx.roundRect(L.videoAreaX, L.videoAreaTop, L.videoAreaWidth, L.videoAreaHeight, L.cornerRadius);
          fctx.stroke();
        }

        return frameCanvas;
      },
    },
    // Áudio: sem opções => o áudio original é copiado sem recodificar (sincronia perfeita).
  });

  if (!conversion.isValid) {
    throw new Error('Não foi possível processar este vídeo (formato/codec não suportado pelo navegador).');
  }

  conversion.onProgress = (p) => onProgress?.(Math.min(100, Math.round(p * 100)));
  signal?.addEventListener('abort', () => conversion.cancel());

  try {
    await conversion.execute();
  } finally {
    avatar?.close();
  }

  const buffer = (output.target as BufferTarget).buffer;
  if (!buffer) throw new Error('A exportação não gerou nenhum arquivo.');
  onProgress?.(100);
  return new Blob([buffer], { type: 'video/mp4' });
}
