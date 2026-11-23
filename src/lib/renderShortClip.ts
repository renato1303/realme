import {
  ALL_FORMATS, BlobSource, BufferTarget, Conversion, Input, Mp4OutputFormat, Output, QUALITY_MEDIUM, type VideoSample,
} from 'mediabunny';
import { TemplateConfig } from '../types';
import { renderFramedVideo } from './renderFramedVideo';

/** Retângulo normalizado (0 a 1) dentro do quadro original do vídeo. */
export interface NormRect { x: number; y: number; w: number; h: number }

/** Palavra transcrita; start/end em segundos RELATIVOS ao início do corte. */
export interface CaptionWord { word: string; start: number; end: number }

export interface CaptionStyle {
  /** Família da fonte (precisa estar carregada na página). Padrão 'Montserrat'. */
  fontFamily?: string;
  /** Tamanho em px (no vídeo 1080x1920). Padrão 84. */
  size?: number;
  /** Cor das palavras. Padrão branco. */
  color?: string;
  /** Cor da palavra que está sendo falada. Padrão amarelo (#FFE600). */
  highlight?: string;
  /** Cor do contorno. Padrão preto. */
  outline?: string;
  /** 'box' desenha uma caixa colorida atrás da palavra ativa (estilo CapCut). Padrão 'text'. */
  activeStyle?: 'text' | 'box';
  /** Máximo de palavras por linha de legenda (1 a 5). Padrão 3. */
  wordsPerLine?: number;
  /** Posição vertical: 'lower' (terço inferior, padrão) ou 'center'. */
  position?: 'lower' | 'center';
  uppercase?: boolean; // padrão true
}

export type ShortMode = 'fill' | 'split' | 'blur-fit' | 'template';

export interface ShortClipOptions {
  start: number;
  end: number;
  /** Título (headline) do corte. Aparece só nos primeiros `titleSeconds` segundos. */
  title?: string;
  showTitle?: boolean;
  titleSeconds?: number; // padrão 5
  /** Estilo do enquadramento. Padrão 'fill' (tela cheia 9:16, como Opus Clip). */
  mode?: ShortMode;
  /** Ponto de foco horizontal (0 a 1) para o corte de tela cheia. Padrão 0.5 (centro). */
  focusX?: number;
  /** Modo 'split': região do gameplay (em cima) e da câmera/narrador (embaixo). */
  split?: { gameBox?: NormRect; camBox: NormRect; topRatio?: number };
  /** Legendas dinâmicas palavra por palavra. */
  captions?: CaptionWord[];
  showCaptions?: boolean;
  captionStyle?: CaptionStyle;
  config?: TemplateConfig; // modo 'template'
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

const W = 1080;
const H = 1920;
const font = (s: number, family = 'Inter') => `900 ${s}px ${family}, Inter, "Arial Black", sans-serif`;

function wrapLines(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) { lines.push(line); line = w; } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

/** Agrupa palavras em blocos de até 3 palavras (quebra em pausas longas), como nas legendas de Reels/Shorts. */
function groupCaptions(words: CaptionWord[], perLine = 3) {
  const groups: { words: CaptionWord[]; start: number; end: number }[] = [];
  let cur: CaptionWord[] = [];
  const flush = () => {
    if (cur.length) groups.push({ words: cur, start: cur[0].start, end: cur[cur.length - 1].end });
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (cur.length >= perLine || (prev && w.start - prev.end > 0.6)) flush();
    cur.push(w);
    if (/[.!?…]$/.test(w.word)) flush();
  }
  flush();
  return groups;
}

function drawCover(sample: VideoSample, ctx: OffscreenCanvasRenderingContext2D, box: NormRect, dx: number, dy: number, dw: number, dh: number, focusX = 0.5) {
  const vW = sample.displayWidth, vH = sample.displayHeight;
  const sx0 = box.x * vW, sy0 = box.y * vH, sw0 = box.w * vW, sh0 = box.h * vH;
  const targetRatio = dw / dh;
  let sw = sw0, sh = sh0;
  if (sw0 / sh0 > targetRatio) sw = sh0 * targetRatio; else sh = sw0 / targetRatio;
  const sx = Math.min(sx0 + sw0 - sw, Math.max(sx0, sx0 + (sw0 - sw) * focusX));
  const sy = sy0 + (sh0 - sh) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  sample.draw(ctx, sx, sy, sw, sh, dx, dy, dw, dh);
  ctx.restore();
}

/**
 * Gera um corte VERTICAL 1080x1920 (Shorts/Reels/TikTok), com vídeo + áudio, a partir do arquivo ORIGINAL.
 *  - 'fill'     : tela cheia 9:16 (padrão).
 *  - 'split'    : gameplay em cima, câmera/narrador embaixo.
 *  - 'blur-fit' : vídeo inteiro centralizado sobre fundo desfocado.
 *  - 'template' : usa o template ReelsFrame do app.
 * Título só nos primeiros segundos; legendas dinâmicas palavra por palavra.
 */
export async function renderShortClip(file: File, opts: ShortClipOptions): Promise<Blob> {
  const {
    start, end, title = '', showTitle = true, titleSeconds = 5, mode = 'fill', focusX = 0.5, split,
    captions = [], showCaptions = true, captionStyle = {}, config, onProgress, signal,
  } = opts;

  if (mode === 'template') {
    if (!config) throw new Error("Modo 'template' exige a configuração do template.");
    const cfg: TemplateConfig = { ...config, aspectRatio: '9:16', headline: title || config.headline };
    return renderFramedVideo(file, cfg, { onProgress, signal, trim: { start, end } });
  }

  const cs = {
    fontFamily: 'Montserrat', size: 84, color: '#FFFFFF', highlight: '#FFE600', outline: '#000000',
    activeStyle: 'text' as const, wordsPerLine: 3, position: 'lower' as const, uppercase: true, ...captionStyle,
  };
  try {
    await Promise.all([document.fonts.load(font(64)), document.fonts.load(font(cs.size, cs.fontFamily))]);
  } catch { /* fallback */ }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({ format: new Mp4OutputFormat(), target: new BufferTarget() });

  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const small = new OffscreenCanvas(36, 64);
  const sctx = small.getContext('2d')!;

  const effectiveMode: ShortMode = mode === 'split' && !split?.camBox ? 'fill' : mode;
  const topH = Math.round(H * (split?.topRatio ?? 0.5));

  // Título (pré-renderizado; mostrado só nos primeiros segundos, mais abaixo do topo: fora da área de interface do app)
  let titleLayer: OffscreenCanvas | null = null;
  const titleY = effectiveMode === 'split' ? 120 : 330;
  if (showTitle && title) {
    titleLayer = new OffscreenCanvas(W, 520);
    const t = titleLayer.getContext('2d')!;
    t.font = font(62);
    t.textAlign = 'center';
    const lines = wrapLines(t, title, W - 170).slice(0, 4);
    t.font = font(62);
    t.lineJoin = 'round';
    t.lineWidth = 14;
    lines.forEach((l, i) => {
      const y = 80 + i * 76;
      t.strokeStyle = '#000';
      t.strokeText(l, W / 2, y);
      t.fillStyle = '#fff';
      t.fillText(l, W / 2, y);
    });
  }

  const groups = showCaptions ? groupCaptions(captions, cs.wordsPerLine) : [];
  const capY = effectiveMode === 'split' ? topH + 150 : cs.position === 'center' ? 960 : 1330;

  const drawCaptions = (t: number) => {
    const g = groups.find((x) => t >= x.start - 0.05 && t <= x.end + 0.25);
    if (!g) return;
    ctx.save();
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    const size = cs.size;
    ctx.font = font(size, cs.fontFamily);
    const texts = g.words.map((w) => (cs.uppercase ? w.word.toUpperCase() : w.word));
    const spaceW = ctx.measureText(' ').width + 26; // folga extra por causa do contorno
    const widths = texts.map((s2) => ctx.measureText(s2).width);
    const total = widths.reduce((a, b) => a + b, 0) + spaceW * (texts.length - 1);
    // Se a linha for larga demais (palavras longas), reduz o conjunto para caber na tela com margem segura.
    const fit = Math.min(1, (W - 110) / total);
    ctx.translate(W / 2, capY);
    ctx.scale(fit, fit);
    ctx.translate(-W / 2, -capY);
    let x = (W - total) / 2;
    g.words.forEach((w, i) => {
      const active = t >= w.start - 0.02 && t < w.end + 0.02;
      const pop = active ? 1.08 : 1;
      ctx.save();
      ctx.translate(x + widths[i] / 2, capY);
      ctx.scale(pop, pop);
      if (active && cs.activeStyle === 'box') {
        const padX = 22, padY = 14;
        ctx.fillStyle = cs.highlight;
        ctx.beginPath();
        ctx.roundRect(-widths[i] / 2 - padX, -size * 0.82 - padY / 2, widths[i] + padX * 2, size * 1.05 + padY, 22);
        ctx.fill();
        ctx.lineWidth = 8;
        ctx.strokeStyle = cs.outline;
        ctx.strokeText(texts[i], -widths[i] / 2, 0);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText(texts[i], -widths[i] / 2, 0);
      } else {
        ctx.lineWidth = 16;
        ctx.strokeStyle = cs.outline;
        ctx.strokeText(texts[i], -widths[i] / 2, 0);
        ctx.fillStyle = active ? cs.highlight : cs.color;
        ctx.fillText(texts[i], -widths[i] / 2, 0);
      }
      ctx.restore();
      x += widths[i] + spaceW;
    });
    ctx.restore();
  };

  const conversion = await Conversion.init({
    input,
    output,
    trim: { start, end },
    video: {
      codec: 'avc',
      quality: QUALITY_MEDIUM,
      frameRate: 30,
      keyFrameInterval: 2,
      processedWidth: W,
      processedHeight: H,
      process: (sample: VideoSample) => {
        const t = Math.max(0, sample.timestamp);
        const full: NormRect = { x: 0, y: 0, w: 1, h: 1 };
        const vRatio = sample.displayWidth / sample.displayHeight;

        if (effectiveMode === 'fill') {
          drawCover(sample, ctx, full, 0, 0, W, H, focusX);
        } else if (effectiveMode === 'split') {
          ctx.fillStyle = '#000';
          ctx.fillRect(0, 0, W, H);
          drawCover(sample, ctx, split!.gameBox ?? full, 0, 0, W, topH, 0.5);
          drawCover(sample, ctx, split!.camBox, 0, topH, W, H - topH, 0.5);
          ctx.fillStyle = '#000';
          ctx.fillRect(0, topH - 3, W, 6);
        } else {
          let sW = 36, sH = 36 / vRatio;
          if (sH < 64) { sH = 64; sW = 64 * vRatio; }
          sample.draw(sctx, (36 - sW) / 2, (64 - sH) / 2, sW, sH);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(small, 0, 0, W, H);
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(0, 0, W, H);
          const fH = W / vRatio;
          sample.draw(ctx, 0, (H - fH) / 2, W, fH);
        }

        if (titleLayer && t < titleSeconds) {
          const fadeIn = Math.min(1, t / 0.25);
          const fadeOut = Math.min(1, Math.max(0, (titleSeconds - t) / 0.4));
          ctx.globalAlpha = Math.min(fadeIn, fadeOut);
          ctx.drawImage(titleLayer, 0, titleY - 80);
          ctx.globalAlpha = 1;
        }
        if (groups.length) drawCaptions(t);
        return canvas;
      },
    },
  });

  if (!conversion.isValid) {
    const why = conversion.discardedTracks.map((d) => `${d.track.type}: ${d.reason}`).join('; ');
    throw new Error(`Não foi possível gerar o corte (${why || 'sem faixas utilizáveis'}).`);
  }
  if (!conversion.utilizedTracks.some((t) => t.type === 'video')) {
    throw new Error('O corte ficaria sem vídeo: o navegador não conseguiu processar a faixa de vídeo.');
  }

  conversion.onProgress = (p) => onProgress?.(Math.min(100, Math.round(p * 100)));
  signal?.addEventListener('abort', () => conversion.cancel());
  await conversion.execute();

  const buf = (output.target as BufferTarget).buffer;
  if (!buf) throw new Error('Corte vazio.');
  onProgress?.(100);
  return new Blob([buf], { type: 'video/mp4' });
}
