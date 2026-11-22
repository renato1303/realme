import React, { useState, useRef, useEffect } from 'react';
import { Upload, Sparkles, Loader2, Play, Scissors, Film, AlertCircle, Pause, RotateCcw } from 'lucide-react';
import { AIClip, TemplateConfig, VideoItem } from '../types';
import { trimVideo } from '../lib/videoProcessing';
import { makeProxyBlock } from '../lib/makeProxyBlock';
import { getFileKey, loadAnalysisState, saveAnalysisState, clearAnalysisState } from '../lib/db';

interface ClipsTabProps {
  onAddVideo: (videoItem: VideoItem) => void;
  onSetHeadline: (headline: string) => void;
  config: TemplateConfig;
}

interface BlockTask {
  index: number;
  start: number;
  end: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  retries: number;
}

export function ClipsTab({ onAddVideo, onSetHeadline, config: _config }: ClipsTabProps) {
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [originalVideoUrl, setOriginalVideoUrl] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number>(0);
  const [fileKey, setFileKey] = useState<string>('');

  // Time range settings
  const [startTimeInput, setStartTimeInput] = useState<string>('00:00:00');
  const [endTimeInput, setEndTimeInput] = useState<string>('00:10:00');

  // Blocks & Progress
  const [blocks, setBlocks] = useState<BlockTask[]>([]);
  const [currentBlockIdx, setCurrentBlockIdx] = useState<number>(0);
  const [analysisStatus, setAnalysisStatus] = useState<string>('');
  const [blockProgress, setBlockProgress] = useState<number>(0);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [hasStoredAnalysis, setHasStoredAnalysis] = useState<any>(null);

  // Error state for visible UI
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Clips & Filtering
  const [clips, setClips] = useState<AIClip[]>([]);
  const [minScoreFilter, setMinScoreFilter] = useState<number>(60);
  const [sortBy, setSortBy] = useState<'score' | 'time'>('score');
  const [displayLimit, setDisplayLimit] = useState<number>(40);

  // Trimming queue
  const [trimmingQueue, setTrimmingQueue] = useState<{ id: string; title: string; progress: number }[]>([]);

  // Preview
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const [activePreviewId, setActivePreviewId] = useState<string | null>(null);

  const abortControllerRef = useRef<AbortController | null>(null);
  const isRunningRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // Handle file selection
  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement> | File) => {
    const file = e instanceof File ? e : e.target.files?.[0];
    if (!file) return;

    console.log('[ClipsTab] File selected:', file.name, file.size, file.type);
    setOriginalFile(file);
    const url = URL.createObjectURL(file);
    setOriginalVideoUrl(url);

    const fKey = getFileKey(file);
    setFileKey(fKey);
    setAnalysisError(null);

    // Read duration robustly
    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.src = url;
    
    let durationLoaded = false;
    await new Promise((resolve) => {
      tempVideo.onloadedmetadata = () => {
        durationLoaded = true;
        const dur = isNaN(tempVideo.duration) || tempVideo.duration <= 0 ? 600 : tempVideo.duration;
        console.log('[ClipsTab] Video duration loaded:', dur);
        setVideoDuration(dur);
        setEndTimeInput(formatSeconds(dur));
        resolve(true);
      };
      tempVideo.onerror = (err) => {
        console.warn('[ClipsTab] Metadata load warning, using fallback duration:', err);
        const fallbackDur = 600;
        setVideoDuration(fallbackDur);
        setEndTimeInput(formatSeconds(fallbackDur));
        resolve(true);
      };
      setTimeout(() => {
        if (!durationLoaded) {
          const fallbackDur = 600;
          console.warn('[ClipsTab] Metadata timeout, using fallback duration:', fallbackDur);
          setVideoDuration(fallbackDur);
          setEndTimeInput(formatSeconds(fallbackDur));
          resolve(true);
        }
      }, 2000);
    });

    const stored = await loadAnalysisState(fKey);
    if (stored && !stored.isFinished && stored.completedBlocks.length > 0) {
      setHasStoredAnalysis(stored);
    } else {
      setHasStoredAnalysis(null);
    }
  };

  const calculateEstimatedBlocks = () => {
    const dur = videoDuration || 600;
    const startSec = parseTimeString(startTimeInput);
    const endSec = parseTimeString(endTimeInput) || dur;
    const validStart = Math.max(0, Math.min(startSec, dur));
    const validEnd = Math.max(validStart + 1, Math.min(endSec, dur));
    const BLOCK_SIZE = 1800;
    const OVERLAP = 60;
    let count = 0;
    let cursor = validStart;
    while (cursor < validEnd) {
      count++;
      const bEnd = Math.min(validEnd, cursor + BLOCK_SIZE);
      if (bEnd >= validEnd) break;
      cursor = bEnd - OVERLAP;
    }
    return Math.max(1, count);
  };

  const startAnalysis = async (resume: boolean = false) => {
    console.log('========================================');
    console.log('[ClipsTab] startAnalysis TRIGGERED. resume:', resume);
    console.log('========================================');
    setAnalysisError(null);
    setIsPaused(false);
    setIsRunning(false);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    isRunningRef.current = false;
    isPausedRef.current = false;

    try {
      if (!originalFile) {
        throw new Error('Nenhum arquivo de vídeo selecionado.');
      }

      const dur = videoDuration || 600;
      let startSec = parseTimeString(startTimeInput);
      let endSec = parseTimeString(endTimeInput) || dur;

      console.log('[ClipsTab] Parsed times - startSec:', startSec, 'endSec:', endSec, 'dur:', dur);

      if (isNaN(startSec) || isNaN(endSec)) {
        throw new Error('Formato de tempo inválido. Use hh:mm:ss (ex: 00:00:00).');
      }
      if (startSec >= endSec) {
        throw new Error('O tempo de início deve ser menor que o tempo de término.');
      }

      startSec = Math.max(0, Math.min(startSec, dur));
      endSec = Math.max(startSec + 5, Math.min(endSec, dur));

      const BLOCK_SIZE = 1800;
      const OVERLAP = 60;
      const taskList: BlockTask[] = [];

      let cursor = startSec;
      let idx = 0;
      while (cursor < endSec) {
        const bEnd = Math.min(endSec, cursor + BLOCK_SIZE);
        taskList.push({
          index: idx,
          start: cursor,
          end: bEnd,
          status: 'pending',
          retries: 0,
        });
        console.log(`[ClipsTab] Block task ${idx}: start=${cursor.toFixed(1)}s, end=${bEnd.toFixed(1)}s`);
        if (bEnd >= endSec) break;
        cursor = bEnd - OVERLAP;
        idx++;
      }

      console.log(`[ClipsTab] Total blocks to process: ${taskList.length}`);

      let completedIndices: number[] = [];
      let initialClips: AIClip[] = [];

      if (resume && hasStoredAnalysis) {
        completedIndices = hasStoredAnalysis.completedBlocks || [];
        initialClips = hasStoredAnalysis.clips || [];
        taskList.forEach((t) => {
          if (completedIndices.includes(t.index)) {
            t.status = 'completed';
          }
        });
        setClips(initialClips);
      } else {
        console.log('[ClipsTab] Clearing previous IndexedDB & state because resume=false');
        await clearAnalysisState(fileKey);
        setClips([]);
        setHasStoredAnalysis(null);
        completedIndices = [];
        initialClips = [];
      }

      setBlocks(taskList);
      setIsRunning(true);
      setIsPaused(false);
      setHasStoredAnalysis(null);

      runBlockLoop(taskList, completedIndices, initialClips);
    } catch (err: any) {
      console.error('[ClipsTab] START ANALYSIS ERROR:', err);
      setAnalysisError(err.message || 'Erro ao iniciar a análise.');
      window.alert(`Erro ao iniciar análise: ${err.message || 'Erro desconhecido'}`);
    }
  };

  const runBlockLoop = async (taskList: BlockTask[], completedIndices: number[], accumulatedClips: AIClip[]) => {
    console.log(`[ClipsTab] runBlockLoop started with tasks: ${taskList.length}, completedIndices:`, completedIndices);
    abortControllerRef.current = new AbortController();
    isRunningRef.current = true;
    setIsRunning(true);

    let processedCount = 0;

    try {
      for (let i = 0; i < taskList.length; i++) {
        if (!isRunningRef.current) {
          console.log(`[ClipsTab][bloco ${taskList[i].index + 1}] PULADO porque: isRunningRef.current é falso (cancelado)`);
          break;
        }

        // Handle pause
        while (isPausedRef.current && isRunningRef.current) {
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!isRunningRef.current) {
          console.log(`[ClipsTab][bloco ${taskList[i].index + 1}] PULADO porque: cancelado durante pausa`);
          break;
        }

        const task = taskList[i];
        if (completedIndices.includes(task.index)) {
          console.log(`[ClipsTab][bloco ${task.index + 1}] PULADO porque: já concluído nos blocos salvos`);
          continue;
        }

        console.log(`[ClipsTab][bloco ${task.index + 1}] iniciando`);
        setCurrentBlockIdx(task.index);
        setBlockProgress(0);

        let success = false;
        let attempt = 0;

        while (!success && attempt < 3 && isRunningRef.current) {
          attempt++;
          try {
            console.log(`[ClipsTab][bloco ${task.index + 1}] gerando proxy (tentativa ${attempt})...`);
            setAnalysisStatus(`Bloco ${task.index + 1} de ${taskList.length} — gerando versão leve (0%)`);

            const startTimeProxy = Date.now();
            let lastLoggedPercent = 0;

            const blockBlob = await makeProxyBlock(originalFile!, task.start, task.end, {
              onProgress: (p) => {
                const percent = Math.round(p * 100);
                setBlockProgress(percent);
                setAnalysisStatus(`Bloco ${task.index + 1} de ${taskList.length} — gerando versão leve (${percent}%)`);
                if (percent >= lastLoggedPercent + 10) {
                  lastLoggedPercent = percent;
                  console.log(`[ClipsTab][bloco ${task.index + 1}] Progresso do proxy: ${percent}%`);
                }
              },
              signal: abortControllerRef.current.signal,
            });

            const proxyDurationSec = ((Date.now() - startTimeProxy) / 1000).toFixed(1);
            const proxySizeMB = (blockBlob.size / (1024 * 1024)).toFixed(2);
            console.log(`[ClipsTab][bloco ${task.index + 1}] proxy pronto: ${proxySizeMB} MB em ${proxyDurationSec} s`);

            setAnalysisStatus(`Bloco ${task.index + 1} de ${taskList.length} — enviando...`);
            console.log(`[ClipsTab][bloco ${task.index + 1}] enviando para /api/analyze-video`);

            const formData = new FormData();
            formData.append('video', blockBlob, `block_${task.index}.mp4`);
            formData.append('offsetSeconds', task.start.toString());

            setAnalysisStatus(`Bloco ${task.index + 1} de ${taskList.length} — analisando com IA...`);

            const res = await fetch('/api/analyze-video', {
              method: 'POST',
              body: formData,
              signal: abortControllerRef.current.signal,
            });

            if (res.status === 429) {
              const data = await res.json();
              const waitSec = data.retryAfter || 15;
              setAnalysisStatus(`Bloco ${task.index + 1} — limite excedido (429). Aguardando ${waitSec}s...`);
              console.warn(`[ClipsTab][bloco ${task.index + 1}] Rate limit 429. Waiting ${waitSec}s...`);
              await new Promise((r) => setTimeout(r, waitSec * 1000));
              continue;
            }

            const data = await res.json();
            if (!res.ok) {
              throw new Error(data.error || 'Erro no servidor ao analisar bloco.');
            }

            const clipsFound = data.clips || [];
            console.log(`[ClipsTab][bloco ${task.index + 1}] resposta recebida: ${clipsFound.length} cortes`);

            const newClips: AIClip[] = clipsFound.map((c: any, cIdx: number) => ({
              id: `block-${task.index}-clip-${cIdx}-${Date.now()}`,
              startSeconds: c.startSeconds,
              endSeconds: c.endSeconds,
              title: c.title || `Corte Bloco ${task.index + 1}`,
              score: c.score || 70,
              reason: c.reason || 'Momento destacado pela IA',
              selected: true,
            }));

            accumulatedClips = mergeAndDeduplicateClips([...accumulatedClips, ...newClips]);
            setClips([...accumulatedClips]);

            completedIndices.push(task.index);
            task.status = 'completed';
            success = true;
            processedCount++;

            await saveAnalysisState({
              fileKey,
              completedBlocks: completedIndices,
              clips: accumulatedClips,
              totalBlocks: taskList.length,
              isFinished: completedIndices.length === taskList.length,
            });
            console.log(`[ClipsTab][bloco ${task.index + 1}] concluído com sucesso e salvo.`);
          } catch (err: any) {
            if (err.name === 'AbortError') {
              console.log(`[ClipsTab][bloco ${task.index + 1}] PULADO porque: AbortError (cancelado)`);
              setIsRunning(false);
              return;
            }
            console.error(`[ClipsTab][bloco ${task.index + 1}] Erro na tentativa ${attempt}:`, err);
            if (attempt === 3) {
              setAnalysisError(`Bloco ${task.index + 1} falhou após 3 tentativas: ${err.message}`);
            }
            if (attempt < 3) {
              await new Promise((r) => setTimeout(r, 3000 * attempt));
            }
          }
        }

        if (!success) {
          task.status = 'failed';
          console.log(`[ClipsTab][bloco ${task.index + 1}] falhou após todas as tentativas.`);
        }
      }

      setIsRunning(false);
      if (processedCount === 0 && accumulatedClips.length === 0) {
        setAnalysisError('Nenhum bloco foi processado com sucesso. Nenhum corte encontrado ou falha na IA.');
        setAnalysisStatus('Falha na análise.');
      } else {
        setAnalysisStatus('Análise de blocos concluída!');
      }
      console.log(`[ClipsTab] runBlockLoop completed. Processed blocks: ${processedCount}/${taskList.length}`);
    } catch (err: any) {
      console.error('[ClipsTab] CRITICAL RUN_BLOCK_LOOP ERROR:', err);
      setAnalysisError(err.message || 'Erro durante a execução dos blocos.');
      setIsRunning(false);
    }
  };

  const mergeAndDeduplicateClips = (incoming: AIClip[]): AIClip[] => {
    incoming.sort((a, b) => b.score - a.score);
    const unique: AIClip[] = [];

    for (const clip of incoming) {
      let isDuplicate = false;
      for (const kept of unique) {
        const intersectionStart = Math.max(clip.startSeconds, kept.startSeconds);
        const intersectionEnd = Math.min(clip.endSeconds, kept.endSeconds);
        const intersectionDuration = Math.max(0, intersectionEnd - intersectionStart);
        const clipDuration = clip.endSeconds - clip.startSeconds;

        if (clipDuration > 0 && intersectionDuration / clipDuration > 0.5) {
          isDuplicate = true;
          break;
        }
      }
      if (!isDuplicate) {
        unique.push(clip);
      }
    }

    unique.sort((a, b) => (sortBy === 'score' ? b.score - a.score : a.startSeconds - b.startSeconds));
    return unique;
  };

  const handlePauseResume = () => {
    setIsPaused(!isPaused);
  };

  const handleCancel = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setIsRunning(false);
    setIsPaused(false);
    setAnalysisStatus('Análise cancelada.');
  };

  const handleRetryFailed = () => {
    const failedTasks = blocks.filter((b) => b.status === 'failed');
    if (failedTasks.length === 0) return;
    setIsRunning(true);
    setAnalysisError(null);
    const completedIndices = blocks.filter((b) => b.status === 'completed').map((b) => b.index);
    runBlockLoop(blocks, completedIndices, clips);
  };

  const handlePlayPreview = (clip: AIClip) => {
    setActivePreviewId(clip.id);
    if (previewVideoRef.current && originalVideoUrl) {
      previewVideoRef.current.currentTime = clip.startSeconds;
      previewVideoRef.current.play();

      const checkTime = () => {
        if (previewVideoRef.current && previewVideoRef.current.currentTime >= clip.endSeconds) {
          previewVideoRef.current.pause();
          previewVideoRef.current.removeEventListener('timeupdate', checkTime);
          setActivePreviewId(null);
        }
      };
      previewVideoRef.current.addEventListener('timeupdate', checkTime);
    }
  };

  const handleSendSelectedToEditor = async () => {
    const selected = clips.filter((c) => c.selected);
    if (selected.length === 0 || !originalFile) return;

    const queueItems = selected.map((s) => ({ id: s.id, title: s.title, progress: 0 }));
    setTrimmingQueue(queueItems);

    for (let i = 0; i < selected.length; i++) {
      const clip = selected[i];
      try {
        const trimmedBlob = await trimVideo(originalFile, clip.startSeconds, clip.endSeconds, {
          onProgress: (p) => {
            setTrimmingQueue((prev) => prev.map((q) => (q.id === clip.id ? { ...q, progress: p } : q)));
          },
        });

        const trimmedFile = new File([trimmedBlob], `${clip.title.replace(/[^a-zA-Z0-9]/g, '_')}.mp4`, {
          type: 'video/mp4',
        });
        const url = URL.createObjectURL(trimmedFile);

        onAddVideo({
          id: `cut-ai-${Date.now()}-${i}`,
          name: `${clip.title} (${Math.round(clip.endSeconds - clip.startSeconds)}s)`,
          url,
          duration: clip.endSeconds - clip.startSeconds,
          file: trimmedFile,
        });

        if (i === 0) {
          onSetHeadline(clip.title);
        }
      } catch (err) {
        console.error('Trim error for clip:', clip.title, err);
      }
    }

    setTrimmingQueue([]);
  };

  const filteredClips = clips
    .filter((c) => c.score >= minScoreFilter)
    .sort((a, b) => (sortBy === 'score' ? b.score - a.score : a.startSeconds - b.startSeconds));

  const estimatedBlockCount = calculateEstimatedBlocks();

  return (
    <div className="flex-1 bg-slate-950 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2.5">
              <Sparkles className="w-6 h-6 text-purple-400" />
              Cortes IA para Vídeos Longos (Lives & 10GB+)
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Análise em blocos de 30 minutos com sobreposição para não perder nenhum momento épico.
            </p>
          </div>
        </div>

        {/* Visible Error Banner */}
        {analysisError && (
          <div className="p-4 bg-red-950/60 border border-red-800/80 rounded-2xl text-red-300 flex items-start justify-between gap-3 shadow-lg">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 shrink-0 text-red-400 mt-0.5" />
              <div>
                <h4 className="font-semibold text-white">Erro na Análise</h4>
                <p className="text-sm mt-0.5">{analysisError}</p>
              </div>
            </div>
            <button
              onClick={() => setAnalysisError(null)}
              className="text-xs bg-red-900/50 hover:bg-red-900 px-3 py-1.5 rounded-lg text-white transition shrink-0 cursor-pointer"
            >
              Dispensar
            </button>
          </div>
        )}

        {/* Upload Area */}
        {!originalFile && (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) handleFileSelected(file);
            }}
            className="border-2 border-dashed border-slate-700 hover:border-purple-500 bg-slate-900/40 hover:bg-purple-950/10 rounded-3xl p-12 text-center transition flex flex-col items-center justify-center cursor-pointer group"
          >
            <div className="w-16 h-16 rounded-2xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center mb-4 group-hover:scale-110 transition shadow-lg shadow-purple-600/20">
              <Upload className="w-8 h-8" />
            </div>
            <h3 className="text-lg font-semibold text-white mb-1">Arraste seu vídeo longo ou live aqui (10GB+)</h3>
            <p className="text-sm text-slate-400 mb-6">Processamento seguro em blocos no navegador sem estouro de memória</p>
            <label className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium px-6 py-3 rounded-xl cursor-pointer transition shadow-lg shadow-purple-600/30 inline-flex items-center gap-2">
              <Film className="w-4 h-4" />
              Selecionar Vídeo Longo
              <input type="file" accept="video/*" onChange={handleFileSelected} className="hidden" />
            </label>
          </div>
        )}

        {/* Settings before running */}
        {originalFile && !isRunning && clips.length === 0 && !hasStoredAnalysis && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-semibold text-white">{originalFile.name}</h3>
                <p className="text-xs text-slate-400">
                  Duração total estimada: {formatSeconds(videoDuration)} • Tamanho: {(originalFile.size / (1024 * 1024)).toFixed(1)} MB
                </p>
              </div>
              <button
                onClick={() => setOriginalFile(null)}
                className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
              >
                Trocar arquivo
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Analisar de (Início)</label>
                <input
                  type="text"
                  value={startTimeInput}
                  onChange={(e) => setStartTimeInput(e.target.value)}
                  placeholder="00:00:00"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Até (Fim)</label>
                <input
                  type="text"
                  value={endTimeInput}
                  onChange={(e) => setEndTimeInput(e.target.value)}
                  placeholder="hh:mm:ss"
                  className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white text-sm"
                />
              </div>
            </div>

            <div className="bg-slate-950 p-4 rounded-2xl border border-slate-800 text-xs text-slate-400 space-y-1">
              <p>📦 Blocos de 30 minutos com 60s de sobreposição.</p>
              <p>🤖 Estimativa para o intervalo escolhido: <strong>{estimatedBlockCount}</strong> blocos de análise IA.</p>
            </div>

            <button
              onClick={() => startAnalysis(false)}
              disabled={isRunning}
              className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 cursor-pointer"
            >
              <Sparkles className="w-5 h-5" />
              {isRunning ? 'Analisando...' : 'Iniciar Análise em Blocos'}
            </button>
          </div>
        )}

        {/* Resume prompt */}
        {hasStoredAnalysis && !isRunning && (
          <div className="bg-purple-950/40 border border-purple-800/60 rounded-3xl p-8 space-y-4 text-center shadow-xl">
            <h3 className="text-lg font-semibold text-white">Análise anterior encontrada para este arquivo!</h3>
            <p className="text-sm text-slate-300">
              Progresso: {hasStoredAnalysis.completedBlocks.length} de {hasStoredAnalysis.totalBlocks} blocos concluídos ({hasStoredAnalysis.clips.length} cortes encontrados).
            </p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                onClick={() => startAnalysis(true)}
                className="bg-purple-600 hover:bg-purple-500 text-white font-medium px-5 py-2.5 rounded-xl transition cursor-pointer"
              >
                Retomar Análise
              </button>
              <button
                onClick={() => {
                  clearAnalysisState(fileKey);
                  setHasStoredAnalysis(null);
                }}
                className="bg-slate-800 hover:bg-slate-700 text-slate-300 px-5 py-2.5 rounded-xl transition cursor-pointer"
              >
                Começar do Zero
              </button>
            </div>
          </div>
        )}

        {/* Running State */}
        {isRunning && (
          <div className="bg-slate-900 border border-slate-800 rounded-3xl p-8 space-y-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Loader2 className="w-6 h-6 text-purple-400 animate-spin" />
                <div>
                  <h3 className="font-semibold text-white">{analysisStatus}</h3>
                  <p className="text-xs text-slate-400">Mantenha esta aba aberta durante a análise.</p>
                </div>
              </div>

              <div className="flex gap-2">
                <button
                  onClick={handlePauseResume}
                  className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
                >
                  {isPaused ? <Play className="w-3.5 h-3.5 fill-current" /> : <Pause className="w-3.5 h-3.5 fill-current" />}
                  {isPaused ? 'Retomar' : 'Pausar'}
                </button>
                <button
                  onClick={handleCancel}
                  className="bg-red-950/50 hover:bg-red-900/50 text-red-300 border border-red-800/40 px-4 py-2 rounded-xl text-xs font-medium transition cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex justify-between text-xs text-slate-400">
                <span>Progresso do Bloco Atual</span>
                <span>{blockProgress}%</span>
              </div>
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-gradient-to-r from-purple-500 to-indigo-500 h-full transition-all duration-300"
                  style={{ width: `${blockProgress}%` }}
                ></div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 pt-2">
              {blocks.map((b) => (
                <div
                  key={b.index}
                  className={`w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold border ${
                    b.status === 'completed'
                      ? 'bg-green-500/20 text-green-300 border-green-500/40'
                      : b.status === 'processing'
                      ? 'bg-purple-600 text-white border-purple-500 animate-pulse'
                      : b.status === 'failed'
                      ? 'bg-red-500/20 text-red-300 border-red-500/40'
                      : 'bg-slate-800 text-slate-500 border-slate-700'
                  }`}
                  title={`Bloco ${b.index + 1}: ${b.status}`}
                >
                  {b.index + 1}
                </div>
              ))}
            </div>

            {blocks.some((b) => b.status === 'failed') && !isRunning && (
              <button
                onClick={handleRetryFailed}
                className="bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-medium px-4 py-2 rounded-xl transition flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Tentar novamente os blocos com falha
              </button>
            )}
          </div>
        )}

        {/* Results List */}
        {(clips.length > 0 || isRunning) && (
          <div className="space-y-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
              <div>
                <h3 className="font-semibold text-white text-base">
                  Cortes Encontrados ({filteredClips.length})
                </h3>
                <p className="text-xs text-slate-400">Filtrados e deduplicados automaticamente</p>
              </div>

              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                <select
                  value={minScoreFilter}
                  onChange={(e) => setMinScoreFilter(Number(e.target.value))}
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2"
                >
                  <option value={60}>Score mínimo: 60+</option>
                  <option value={75}>Score mínimo: 75+</option>
                  <option value={90}>Score mínimo: 90+</option>
                </select>

                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as any)}
                  className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2"
                >
                  <option value="score">Ordenar por Score</option>
                  <option value="time">Ordenar por Horário</option>
                </select>

                <button
                  onClick={handleSendSelectedToEditor}
                  disabled={trimmingQueue.length > 0 || clips.filter((c) => c.selected).length === 0}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-lg shadow-purple-600/25 cursor-pointer"
                >
                  {trimmingQueue.length > 0 ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Cortando ({trimmingQueue.length} restantes)...
                    </>
                  ) : (
                    <>
                      <Scissors className="w-3.5 h-3.5" />
                      Enviar Selecionados para o Editor
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Hidden video element for preview */}
            {originalVideoUrl && (
              <video ref={previewVideoRef} src={originalVideoUrl} className="hidden" preload="auto" />
            )}

            {/* Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
              {filteredClips.slice(0, displayLimit).map((clip, idx) => {
                const duration = Math.round(clip.endSeconds - clip.startSeconds);
                return (
                  <div
                    key={clip.id}
                    className={`bg-slate-900 border rounded-2xl p-5 transition flex flex-col justify-between ${
                      clip.selected ? 'border-purple-500/60 shadow-xl' : 'border-slate-800 opacity-70'
                    }`}
                  >
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <input
                            type="checkbox"
                            checked={clip.selected}
                            onChange={() => setClips(clips.map((c) => (c.id === clip.id ? { ...c, selected: !c.selected } : c)))}
                            className="w-4 h-4 accent-purple-600 rounded cursor-pointer"
                          />
                          <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                          <span className="text-xs text-slate-500">
                            {formatSeconds(clip.startSeconds)} - {formatSeconds(clip.endSeconds)}
                          </span>
                        </div>

                        <span className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-lg font-bold">
                          🔥 {clip.score}
                        </span>
                      </div>

                      <h4 className="font-semibold text-white text-sm">{clip.title}</h4>
                      <p className="text-xs text-slate-400 italic bg-slate-950/40 p-2.5 rounded-xl border border-slate-800/60">
                        "{clip.reason}"
                      </p>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-800 flex items-center justify-between">
                      <button
                        onClick={() => handlePlayPreview(clip)}
                        className={`text-xs px-3 py-1.5 rounded-xl font-medium transition flex items-center gap-1.5 cursor-pointer ${
                          activePreviewId === clip.id ? 'bg-purple-600 text-white' : 'bg-slate-800 hover:bg-slate-700 text-slate-300'
                        }`}
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        {activePreviewId === clip.id ? 'Reproduzindo...' : `Pré-visualizar (${duration}s)`}
                      </button>

                      <button
                        onClick={() => onSetHeadline(clip.title)}
                        className="text-xs text-purple-400 hover:text-purple-300 transition font-medium cursor-pointer"
                      >
                        Usar como Headline
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {filteredClips.length > displayLimit && (
              <div className="text-center pt-4">
                <button
                  onClick={() => setDisplayLimit((prev) => prev + 40)}
                  className="bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold px-6 py-3 rounded-xl transition cursor-pointer"
                >
                  Mostrar mais cortes
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatSeconds(sec: number): string {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  return [hrs, mins, secs].map((v) => (v < 10 ? `0${v}` : v)).join(':');
}

function parseTimeString(timeStr: string): number {
  if (!timeStr) return 0;
  const parts = timeStr.split(':').map(Number);
  if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0);
  } else if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  }
  return Number(timeStr) || 0;
}
