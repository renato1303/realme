import React, { useState } from 'react';
import { X, Download, Video, Image as ImageIcon, Loader2, CheckCircle2, AlertCircle, Layers } from 'lucide-react';
import { TemplateConfig, VideoItem } from '../types';
import JSZip from 'jszip';
import { isFastExportSupported, renderFramedVideo } from '../lib/renderFramedVideo';
import { saveExportHistory } from '../lib/db';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeVideo: VideoItem | null;
  videos: VideoItem[];
  config: TemplateConfig;
}

export function ExportModal({ isOpen, onClose, activeVideo, videos, config }: ExportModalProps) {
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [batchStatus, setBatchStatus] = useState('');
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [downloadFilename, setDownloadFilename] = useState('');
  const [exportType, setExportType] = useState<'single-video' | 'batch-video' | 'image'>('single-video');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleExportImage = () => {
    setExporting(true);
    setError(null);
    try {
      const previewEl = document.getElementById('template-preview-container');
      if (!previewEl) throw new Error('Container de visualização não encontrado');

      import('html-to-image').then(async (htmlToImage) => {
        const dataUrl = await htmlToImage.toPng(previewEl, { cacheBust: true, quality: 0.95 });
        const filename = `reels-template-${Date.now()}.png`;
        setDownloadUrl(dataUrl);
        setDownloadFilename(filename);
        setExporting(false);
        saveExportHistory({
          id: `exp-${Date.now()}`,
          filename,
          type: 'image',
          timestamp: Date.now(),
          aspectRatio: config.aspectRatio,
          headline: config.headline,
          downloadUrl: dataUrl,
        });
      }).catch(async () => {
        const canvas = document.createElement('canvas');
        canvas.width = 1080;
        canvas.height = config.aspectRatio === '1:1' ? 1080 : config.aspectRatio === '4:5' ? 1350 : 1920;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.fillStyle = config.backgroundColor;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = config.headlineColor;
          ctx.font = `bold 48px ${config.headlineFont}, sans-serif`;
          ctx.fillText(config.headline, 60, 200);
        }
        const dataUrl = canvas.toDataURL('image/png');
        const filename = `reels-template-${Date.now()}.png`;
        setDownloadUrl(dataUrl);
        setDownloadFilename(filename);
        setExporting(false);
        saveExportHistory({
          id: `exp-${Date.now()}`,
          filename,
          type: 'image',
          timestamp: Date.now(),
          aspectRatio: config.aspectRatio,
          headline: config.headline,
          downloadUrl: dataUrl,
        });
      });
    } catch (err: any) {
      setError(err.message || 'Erro ao exportar imagem');
      setExporting(false);
    }
  };

  const renderSingleVideoToBlob = async (videoItem: VideoItem, onProgressUpdate?: (p: number) => void): Promise<Blob> => {
    if (isFastExportSupported()) {
      try {
        return await renderFramedVideo(videoItem.file, config, { onProgress: onProgressUpdate });
      } catch (err) {
        console.warn('Exportação rápida falhou, usando modo de gravação em tempo real:', err);
      }
    }
    return renderSingleVideoRealtime(videoItem, onProgressUpdate);
  };

  const renderSingleVideoRealtime = async (videoItem: VideoItem, onProgressUpdate?: (p: number) => void): Promise<Blob> => {
    return new Promise(async (resolve, reject) => {
      try {
        const videoEl = document.createElement('video');
        videoEl.src = videoItem.url;
        videoEl.crossOrigin = 'anonymous';
        videoEl.muted = false;
        videoEl.playsInline = true;

        await new Promise((res, rej) => {
          videoEl.onloadedmetadata = res;
          videoEl.onerror = rej;
        });

        const width = 1080;
        const height = config.aspectRatio === '1:1' ? 1080 : config.aspectRatio === '4:5' ? 1350 : 1920;

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Contexto 2D indisponível');

        // Capture video stream & audio track via Web Audio API
        let audioCtx: AudioContext | null = null;
        let canvasStream = canvas.captureStream(30);

        try {
          audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }
          const source = audioCtx.createMediaElementSource(videoEl);
          const destination = audioCtx.createMediaStreamDestination();
          source.connect(destination);
          source.connect(audioCtx.destination);

          const audioTracks = destination.stream.getAudioTracks();
          if (audioTracks.length > 0) {
            canvasStream.addTrack(audioTracks[0]);
          }
        } catch (e) {
          console.warn('Audio capture warning:', e);
        }

        const mimeTypes = [
          'video/mp4;codecs=h264,aac',
          'video/mp4',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm'
        ];
        let selectedMime = '';
        for (const m of mimeTypes) {
          if (MediaRecorder.isTypeSupported(m)) {
            selectedMime = m;
            break;
          }
        }
        if (!selectedMime) throw new Error('Formato de vídeo não suportado pelo navegador.');

        const mediaRecorder = new MediaRecorder(canvasStream, {
          mimeType: selectedMime,
          videoBitsPerSecond: 6000000, // 6 Mbps for smooth HD quality
        });
        const chunks: Blob[] = [];

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };

        mediaRecorder.onstop = () => {
          if (audioCtx && audioCtx.state !== 'closed') {
            audioCtx.close().catch(() => {});
          }
          const blobType = selectedMime.includes('mp4') ? 'video/mp4' : selectedMime.split(';')[0];
          const blob = new Blob(chunks, { type: blobType });
          resolve(blob);
        };

        let avatarImg: HTMLImageElement | null = null;
        if (config.profileAvatar) {
          avatarImg = new Image();
          avatarImg.crossOrigin = 'anonymous';
          avatarImg.src = config.profileAvatar;
          await new Promise((res) => {
            if (avatarImg) {
              avatarImg.onload = res;
              avatarImg.onerror = res;
            }
          });
        }

        videoEl.currentTime = 0;
        await videoEl.play();
        mediaRecorder.start();

        const totalDuration = videoEl.duration || 5;

        const drawFrame = () => {
          if (videoEl.ended || videoEl.paused || videoEl.currentTime >= totalDuration) {
            if (mediaRecorder.state === 'recording') {
              mediaRecorder.stop();
            }
            videoEl.pause();
            return;
          }

          const pct = Math.min(100, Math.round((videoEl.currentTime / totalDuration) * 100));
          if (onProgressUpdate) onProgressUpdate(pct);

          // Draw Template Frame
          ctx.fillStyle = config.backgroundColor;
          ctx.fillRect(0, 0, width, height);

          if (config.backgroundStyle === 'gradient') {
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, config.backgroundColor);
            grad.addColorStop(1, config.backgroundSecondaryColor);
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);
          }

          const topMargin = config.paddingTop * 3;
          const sideMargin = config.paddingSides * 10;
          const avatarSize = 90;
          const avatarX = sideMargin + 20;
          const avatarY = topMargin + 20;

          ctx.save();
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
          ctx.closePath();
          ctx.clip();
          if (avatarImg) {
            ctx.drawImage(avatarImg, avatarX, avatarY, avatarSize, avatarSize);
          } else {
            ctx.fillStyle = '#cbd5e1';
            ctx.fillRect(avatarX, avatarY, avatarSize, avatarSize);
          }
          ctx.restore();

          ctx.lineWidth = 4;
          ctx.strokeStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(avatarX + avatarSize / 2, avatarY + avatarSize / 2, avatarSize / 2, 0, Math.PI * 2);
          ctx.stroke();

          ctx.fillStyle = config.headlineColor;
          ctx.font = 'bold 36px Inter, sans-serif';
          ctx.textAlign = 'left';
          ctx.fillText(config.profileName, avatarX + avatarSize + 24, avatarY + 38);

          ctx.fillStyle = '#64748b';
          ctx.font = '28px Inter, sans-serif';
          ctx.fillText(`@${config.profileHandle}`, avatarX + avatarSize + 24, avatarY + 80);

          const headlineY = avatarY + avatarSize + 70;
          ctx.fillStyle = config.headlineColor;
          ctx.font = `bold 46px ${config.headlineFont}, sans-serif`;
          ctx.textAlign = config.headlineAlign === 'center' ? 'center' : config.headlineAlign === 'right' ? 'right' : 'left';
          const headlineX = config.headlineAlign === 'center' ? width / 2 : config.headlineAlign === 'right' ? width - sideMargin : avatarX;
          wrapText(ctx, config.headline, headlineX, headlineY, width - (sideMargin * 2), 60);

          const videoAreaTop = headlineY + 120;
          const videoAreaBottom = height - (config.showBottomBar ? 140 : 60);
          const videoAreaHeight = videoAreaBottom - videoAreaTop;
          const videoAreaWidth = width - (sideMargin * 2);
          const videoAreaX = sideMargin;

          ctx.save();
          ctx.beginPath();
          const cornerRadius = config.videoRounded * 3;
          ctx.roundRect(videoAreaX, videoAreaTop, videoAreaWidth, videoAreaHeight, cornerRadius);
          ctx.fillStyle = '#000000';
          ctx.fill();

          if (config.videoShadow) {
            ctx.shadowColor = 'rgba(0, 0, 0, 0.3)';
            ctx.shadowBlur = 30;
            ctx.shadowOffsetX = 0;
            ctx.shadowOffsetY = 15;
          }

          if (config.videoBorder) {
            ctx.lineWidth = 4;
            ctx.strokeStyle = config.videoBorderColor;
            ctx.stroke();
          }
          ctx.clip();

          const vWidth = videoEl.videoWidth || 1080;
          const vHeight = videoEl.videoHeight || 1920;
          const vRatio = vWidth / vHeight;
          const targetRatio = videoAreaWidth / videoAreaHeight;

          let drawW = videoAreaWidth;
          let drawH = videoAreaHeight;
          let drawX = videoAreaX;
          let drawY = videoAreaTop;

          if (config.videoFit === 'contain') {
            if (vRatio > targetRatio) {
              drawH = videoAreaWidth / vRatio;
              drawY = videoAreaTop + (videoAreaHeight - drawH) / 2;
            } else {
              drawW = videoAreaHeight * vRatio;
              drawX = videoAreaX + (videoAreaWidth - drawW) / 2;
            }
          } else {
            if (vRatio > targetRatio) {
              drawW = videoAreaHeight * vRatio;
              drawX = videoAreaX + (videoAreaWidth - drawW) / 2;
            } else {
              drawH = videoAreaWidth / vRatio;
              drawY = videoAreaTop + (videoAreaHeight - drawH) / 2;
            }
          }

          ctx.drawImage(videoEl, drawX, drawY, drawW, drawH);
          ctx.restore();

          if (config.showBottomBar) {
            const barHeight = 90;
            const barY = height - barHeight - 30;
            ctx.save();
            ctx.beginPath();
            ctx.roundRect(sideMargin, barY, videoAreaWidth, barHeight, 20);
            ctx.fillStyle = config.bottomBarBg;
            ctx.fill();

            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 28px Inter, sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(config.bottomBarText, sideMargin + 30, barY + 58);
            ctx.restore();
          }

          if ('requestVideoFrameCallback' in videoEl) {
            (videoEl as any).requestVideoFrameCallback(drawFrame);
          } else {
            requestAnimationFrame(drawFrame);
          }
        };

        if ('requestVideoFrameCallback' in videoEl) {
          (videoEl as any).requestVideoFrameCallback(drawFrame);
        } else {
          requestAnimationFrame(drawFrame);
        }
      } catch (err) {
        reject(err);
      }
    });
  };

  const handleExportSingleVideo = async () => {
    if (!activeVideo) {
      setError('Nenhum vídeo selecionado.');
      return;
    }
    setExporting(true);
    setProgress(0);
    setError(null);
    setDownloadUrl(null);

    try {
      const blob = await renderSingleVideoToBlob(activeVideo, (p) => setProgress(p));
      const url = URL.createObjectURL(blob);
      const filename = `reels-framed-${Date.now()}.mp4`;
      setDownloadUrl(url);
      setDownloadFilename(filename);
      setExporting(false);
      saveExportHistory({
        id: `exp-${Date.now()}`,
        filename,
        type: 'video',
        timestamp: Date.now(),
        aspectRatio: config.aspectRatio,
        headline: config.headline,
        downloadUrl: url,
      });
    } catch (err: any) {
      setError(err.message || 'Erro ao exportar vídeo');
      setExporting(false);
    }
  };

  const handleExportBatchVideos = async () => {
    if (videos.length === 0) {
      setError('Nenhum vídeo na lista para exportar em lote.');
      return;
    }

    setExporting(true);
    setProgress(0);
    setBatchStatus(`Iniciando processamento em lote (${videos.length} vídeos)...`);
    setError(null);
    setDownloadUrl(null);

    try {
      const zip = new JSZip();
      const folder = zip.folder('reels_templates_export');

      for (let i = 0; i < videos.length; i++) {
        const vid = videos[i];
        setBatchStatus(`Processando vídeo ${i + 1} de ${videos.length}: ${vid.name}`);
        
        const blob = await renderSingleVideoToBlob(vid, (p) => {
          // Calculate overall progress
          const totalProgress = Math.round(((i * 100) + p) / videos.length);
          setProgress(totalProgress);
        });

        if (folder) {
          folder.file(`reels_video_${i + 1}_${vid.name.replace(/\.[^/.]+$/, '')}.mp4`, blob);
        }
      }

      setBatchStatus('Compactando arquivo ZIP...');
      const content = await zip.generateAsync({ type: 'blob' }, (meta) => {
        setProgress(Math.round(meta.percent));
      });

      const url = URL.createObjectURL(content);
      const filename = `reels-lote-todos-${Date.now()}.zip`;
      setDownloadUrl(url);
      setDownloadFilename(filename);
      setExporting(false);
      setBatchStatus('');
      saveExportHistory({
        id: `exp-${Date.now()}`,
        filename,
        type: 'batch-zip',
        timestamp: Date.now(),
        aspectRatio: config.aspectRatio,
        headline: config.headline,
        downloadUrl: url,
      });
    } catch (err: any) {
      setError(err.message || 'Erro no processamento em lote');
      setExporting(false);
      setBatchStatus('');
    }
  };

  function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
    const words = text.split(' ');
    let line = '';
    let currentY = y;

    for (let n = 0; n < words.length; n++) {
      const testLine = line + words[n] + ' ';
      const metrics = ctx.measureText(testLine);
      const testWidth = metrics.width;
      if (testWidth > maxWidth && n > 0) {
        ctx.fillText(line, x, currentY);
        line = words[n] + ' ';
        currentY += lineHeight;
      } else {
        line = testLine;
      }
    }
    ctx.fillText(line, x, currentY);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2 text-white">
            <Download className="w-5 h-5 text-purple-400" />
            <h3 className="font-semibold">Exportar Criações</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {!downloadUrl ? (
            <>
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={() => setExportType('single-video')}
                  className={`p-3 rounded-xl border flex flex-col items-center text-center gap-1.5 transition ${
                    exportType === 'single-video'
                      ? 'bg-purple-600/20 border-purple-500 text-white'
                      : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Video className="w-5 h-5 text-purple-400" />
                  <span className="font-medium text-xs">Vídeo Atual</span>
                </button>

                <button
                  onClick={() => setExportType('batch-video')}
                  className={`p-3 rounded-xl border flex flex-col items-center text-center gap-1.5 transition ${
                    exportType === 'batch-video'
                      ? 'bg-purple-600/20 border-purple-500 text-white'
                      : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <Layers className="w-5 h-5 text-purple-400" />
                  <span className="font-medium text-xs">Todos ({videos.length}) ZIP</span>
                </button>

                <button
                  onClick={() => setExportType('image')}
                  className={`p-3 rounded-xl border flex flex-col items-center text-center gap-1.5 transition ${
                    exportType === 'image'
                      ? 'bg-purple-600/20 border-purple-500 text-white'
                      : 'bg-slate-800/50 border-slate-700 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  <ImageIcon className="w-5 h-5 text-blue-400" />
                  <span className="font-medium text-xs">Capa (PNG)</span>
                </button>
              </div>

              {exporting ? (
                <div className="space-y-3 py-4 text-center">
                  <Loader2 className="w-8 h-8 animate-spin text-purple-500 mx-auto" />
                  <p className="text-sm font-medium text-white">
                    {exportType === 'batch-video' ? batchStatus : `Renderizando vídeo (${progress}%)...`}
                  </p>
                  <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                    <div
                      className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full transition-all duration-300"
                      style={{ width: `${progress}%` }}
                    ></div>
                  </div>
                  <p className="text-xs text-slate-400">
                    {exportType === 'batch-video'
                      ? `Processando em lote ${videos.length} vídeos. Não feche esta janela.`
                      : 'Isso aplicará o template sem alterar o vídeo original.'}
                  </p>
                </div>
              ) : (
                <button
                  onClick={
                    exportType === 'single-video'
                      ? handleExportSingleVideo
                      : exportType === 'batch-video'
                      ? handleExportBatchVideos
                      : handleExportImage
                  }
                  className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium py-3 px-4 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-purple-600/25"
                >
                  <Download className="w-4 h-4" />
                  {exportType === 'single-video'
                    ? 'Exportar Vídeo Atual'
                    : exportType === 'batch-video'
                    ? `Exportar Todos os ${videos.length} Vídeos (ZIP)`
                    : 'Baixar Imagem do Template'}
                </button>
              )}
            </>
          ) : (
            <div className="space-y-4 text-center py-2">
              <div className="w-16 h-16 bg-green-500/20 border border-green-500/50 rounded-full flex items-center justify-center mx-auto text-green-400">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h4 className="font-semibold text-white text-lg">Pronto para Download!</h4>
              <p className="text-sm text-slate-400">Sua exportação foi concluída com sucesso.</p>

              <a
                href={downloadUrl}
                download={downloadFilename}
                className="w-full bg-green-600 hover:bg-green-500 text-white font-medium py-3 px-4 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-green-600/25 block"
              >
                <Download className="w-4 h-4" />
                Baixar Arquivo Agora
              </a>

              <button
                onClick={() => setDownloadUrl(null)}
                className="text-xs text-slate-400 hover:text-white transition underline"
              >
                Criar outra exportação
              </button>
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-950/50 border border-red-800/50 rounded-xl text-red-300 text-sm flex items-start gap-2">
              <AlertCircle className="w-5 h-5 shrink-0 text-red-400" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
