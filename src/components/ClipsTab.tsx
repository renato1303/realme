import React, { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { Upload, Sparkles, Loader2, Play, Scissors, Film, AlertCircle, Pause, RotateCcw, Download, CheckSquare, Square, RefreshCw, ExternalLink, MessageSquare, Edit3 } from 'lucide-react';
import { AIClip, TemplateConfig, VideoItem } from '../types';
import { renderShortClip, ShortMode } from '../lib/renderShortClip';
import { makeAudioBlockOpus } from '../lib/makeAudioBlockOpus';
import { getFileKey, loadAnalysisState, saveAnalysisState, clearAnalysisState, saveRenderedClipBlob, loadRenderedClipBlob, loadTranscriptCache, saveTranscriptCache } from '../lib/db';
import JSZip from 'jszip';

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

interface ClipRenderState {
  status: 'queued' | 'rendering' | 'ready' | 'error';
  progress: number;
  blob?: Blob;
  url?: string;
  errorMsg?: string;
}

// Error Boundary for stability
class ClipsErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ClipsTab][global] ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex-1 bg-slate-950 p-12 flex items-center justify-center">
          <div className="max-w-md w-full bg-slate-900 border border-red-800/60 rounded-3xl p-8 text-center space-y-4 shadow-2xl">
            <AlertCircle className="w-12 h-12 text-red-400 mx-auto" />
            <h3 className="text-xl font-bold text-white">Ocorreu um erro na aba Cortes IA</h3>
            <p className="text-sm text-slate-400">
              {this.state.error?.message || 'Erro inesperado na renderização ou análise.'}
            </p>
            <button
              onClick={() => window.location.reload()}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold py-3 px-6 rounded-xl transition shadow-lg shadow-purple-600/30 cursor-pointer"
            >
              Recarregar aba (Estado preservado)
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export function ClipsTab(props: ClipsTabProps) {
  return (
    <ClipsErrorBoundary>
      <ClipsTabContent {...props} />
    </ClipsErrorBoundary>
  );
}

function ClipsTabContent({ onAddVideo, onSetHeadline, config }: ClipsTabProps) {
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
  const [globalBanner, setGlobalBanner] = useState<string | null>(null);

  // Clips & Filtering & Styling
  const [clips, setClips] = useState<AIClip[]>([]);
  const [minScoreFilter, setMinScoreFilter] = useState<number>(40);
  const [sortBy, setSortBy] = useState<'score' | 'time'>('score');
  const [displayLimit, setDisplayLimit] = useState<number>(40);

  // Short rendering options
  const [shortMode, setShortMode] = useState<ShortMode>('fill');
  const [showTitle, setShowTitle] = useState<boolean>(true);
  const [titleSeconds, setTitleSeconds] = useState<number>(5);

  // Caption styling & transcription states
  const [showCaptions, setShowCaptions] = useState<boolean>(true);
  const [captionPreset, setCaptionPreset] = useState<'classic' | 'purpleBox' | 'white'>('classic');
  const [captionFont, setCaptionFont] = useState<string>('Montserrat');
  const [captionSize, setCaptionSize] = useState<number>(84);
  const [captionWordsPerLine, setCaptionWordsPerLine] = useState<number>(3);
  const [captionPosition, setCaptionPosition] = useState<'lower' | 'center'>('lower');
  const [captionHighlight, setCaptionHighlight] = useState<string>('#FFE600');
  const [customVocabulary, setCustomVocabulary] = useState<string>(() => localStorage.getItem('reelsframe_vocabulary') || 'GTA 6, GTA VI, Rockstar, Vice City, Leonida, Jason, Lucia, Kick, Coringa');

  const [clipTranscripts, setClipTranscripts] = useState<Record<string, { words: any[]; text: string; start: number; end: number; failed?: boolean }>>({});
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [editTextVal, setEditTextVal] = useState<string>('');

  const [renderStates, setRenderStates] = useState<Record<string, ClipRenderState>>({});
  const renderQueueRunningRef = useRef<boolean>(false);

  // Trimming queue for editor
  const [isSendingToEditor, setIsSendingToEditor] = useState<boolean>(false);
  const [sendProgressMsg, setSendProgressMsg] = useState<string>('');

  const abortControllerRef = useRef<AbortController | null>(null);
  const renderAbortControllerRef = useRef<AbortController | null>(null);
  const isRunningRef = useRef<boolean>(false);
  const isPausedRef = useRef<boolean>(false);

  useEffect(() => {
    isRunningRef.current = isRunning;
  }, [isRunning]);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  useEffect(() => {
    localStorage.setItem('reelsframe_vocabulary', customVocabulary);
  }, [customVocabulary]);

  // Global error handlers ignoring Vite / WebSocket noise
  useEffect(() => {
    const handleError = (e: ErrorEvent) => {
      const msg = e.message || '';
      const filename = e.filename || '';
      if (
        msg.includes('WebSocket closed without opened') ||
        msg.includes('@vite/client') ||
        msg.includes('[vite]') ||
        filename.includes('@vite')
      ) {
        return; // ignore silently
      }
      console.error('[ClipsTab][global] window error:', msg);
      setGlobalBanner(`Erro na aplicação: ${msg}`);
    };
    const handleRejection = (e: PromiseRejectionEvent) => {
      const reasonStr = String(e.reason?.message || e.reason || '');
      if (
        reasonStr.includes('WebSocket closed without opened') ||
        reasonStr.includes('@vite/client') ||
        reasonStr.includes('[vite]')
      ) {
        return; // ignore silently
      }
      console.error('[ClipsTab][global] unhandled rejection:', e.reason);
      setGlobalBanner(`Erro assíncrono: ${reasonStr}`);
    };
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isRunning || renderQueueRunningRef.current) {
        e.preventDefault();
        e.returnValue = 'Análise ou renderização em andamento. Deseja sair?';
      }
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleRejection);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleRejection);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [isRunning]);

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
    setGlobalBanner(null);

    const tempVideo = document.createElement('video');
    tempVideo.preload = 'metadata';
    tempVideo.src = url;
    
    let durationLoaded = false;
    await new Promise((resolve) => {
      tempVideo.onloadedmetadata = () => {
        durationLoaded = true;
        const dur = isNaN(tempVideo.duration) || tempVideo.duration <= 0 ? 600 : tempVideo.duration;
        setVideoDuration(dur);
        setEndTimeInput(formatSeconds(dur));
        resolve(true);
      };
      tempVideo.onerror = () => {
        const fallbackDur = 600;
        setVideoDuration(fallbackDur);
        setEndTimeInput(formatSeconds(fallbackDur));
        resolve(true);
      };
      setTimeout(() => {
        if (!durationLoaded) {
          const fallbackDur = 600;
          setVideoDuration(fallbackDur);
          setEndTimeInput(formatSeconds(fallbackDur));
          resolve(true);
        }
      }, 2000);
    });

    const stored = await loadAnalysisState(fKey);
    if (stored) {
      if (stored.clips && stored.clips.length > 0) {
        setClips(stored.clips);
        for (const clip of stored.clips) {
          const blob = await loadRenderedClipBlob(clip.id);
          if (blob) {
            const rUrl = URL.createObjectURL(blob);
            setRenderStates((prev) => ({
              ...prev,
              [clip.id]: { status: 'ready', progress: 100, blob, url: rUrl },
            }));
          }
        }
      }
      if (!stored.isFinished && stored.completedBlocks?.length > 0) {
        setHasStoredAnalysis(stored);
      } else {
        setHasStoredAnalysis(null);
      }
    }
  };

  const calculateEstimatedBlocks = () => {
    const dur = videoDuration || 600;
    const startSec = parseTimeString(startTimeInput);
    const endSec = parseTimeString(endTimeInput) || dur;
    const validStart = Math.max(0, Math.min(startSec, dur));
    const validEnd = Math.max(validStart + 1, Math.min(endSec, dur));
    const BLOCK_SIZE = 600;
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

      if (isNaN(startSec) || isNaN(endSec)) {
        throw new Error('Formato de tempo inválido. Use hh:mm:ss (ex: 00:00:00).');
      }
      if (startSec >= endSec) {
        throw new Error('O tempo de início deve ser menor que o tempo de término.');
      }

      startSec = Math.max(0, Math.min(startSec, dur));
      endSec = Math.max(startSec + 5, Math.min(endSec, dur));

      const BLOCK_SIZE = 600;
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
        if (bEnd >= endSec) break;
        cursor = bEnd - OVERLAP;
        idx++;
      }

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
      setAnalysisError(err.message || 'Erro ao iniciar a análise.');
    }
  };

  const runBlockLoop = async (taskList: BlockTask[], completedIndices: number[], accumulatedClips: AIClip[]) => {
    abortControllerRef.current = new AbortController();
    isRunningRef.current = true;
    setIsRunning(true);

    const audioBlobCache = new Map<string, Blob>();

    const getOrExtractAudio = async (start: number, end: number, taskIndex: number, depth: number): Promise<Blob> => {
      const cacheKey = `${taskIndex}_${start.toFixed(1)}_${end.toFixed(1)}`;
      if (audioBlobCache.has(cacheKey)) {
        return audioBlobCache.get(cacheKey)!;
      }
      setAnalysisStatus(`Bloco ${taskIndex + 1} de ${taskList.length} — extraindo áudio (0%)`);
      const blockAudioBlob = await makeAudioBlockOpus(originalFile!, start, end, {
        onProgress: (p) => {
          const percent = Math.round(p * 100);
          setBlockProgress(percent);
          setAnalysisStatus(`Bloco ${taskIndex + 1} de ${taskList.length} — extraindo áudio (${percent}%)`);
        },
        signal: abortControllerRef.current?.signal || undefined,
      });
      audioBlobCache.set(cacheKey, blockAudioBlob);
      return blockAudioBlob;
    };

    const processBlockRange = async (start: number, end: number, taskIndex: number, depth: number = 0): Promise<any[]> => {
      if (!isRunningRef.current) throw new Error('AbortError');

      const blockAudioBlob = await getOrExtractAudio(start, end, taskIndex, depth);
      const audioSizeMB = blockAudioBlob.size / (1024 * 1024);

      if (audioSizeMB > 3.8 && depth < 3) {
        const mid = start + (end - start) / 2;
        const clipsPart1 = await processBlockRange(start, mid, taskIndex, depth + 1);
        const clipsPart2 = await processBlockRange(mid, end, taskIndex, depth + 1);
        return [...clipsPart1, ...clipsPart2];
      }

      setAnalysisStatus(`Bloco ${taskIndex + 1} de ${taskList.length} — enviando...`);
      const formData = new FormData();
      formData.append('file', blockAudioBlob, `block_${taskIndex}.ogg`);
      formData.append('offsetSeconds', start.toString());

      setAnalysisStatus(`Bloco ${taskIndex + 1} de ${taskList.length} — analisando com IA...`);

      const overloadDelays = [0, 60000, 120000, 240000, 300000];
      let attempt = 0;

      while (attempt < overloadDelays.length && isRunningRef.current) {
        if (attempt > 0) {
          const waitSec = overloadDelays[attempt] / 1000;
          setAnalysisStatus(`Gemini sobrecarregado, tentando de novo em ${waitSec} s (tentativa ${attempt + 1}/5)...`);
          await new Promise((r) => setTimeout(r, overloadDelays[attempt]));
        }

        attempt++;
        if (!isRunningRef.current) throw new Error('AbortError');

        try {
          const res = await fetch('/api/analyze-video', {
            method: 'POST',
            body: formData,
            signal: abortControllerRef.current?.signal || undefined,
          });

          const contentType = res.headers.get('content-type');
          if (!res.ok || !contentType || !contentType.includes('application/json')) {
            const text = await res.text();
            let errorObj: any = null;
            try { errorObj = JSON.parse(text); } catch (e) {}

            if (res.status === 400 || res.status === 404 || res.status === 413) {
              throw new Error(errorObj?.error || `Servidor respondeu ${res.status}`);
            }

            if (res.status === 503 || errorObj?.retryable) {
              continue;
            }

            throw new Error(errorObj?.error || `Servidor respondeu ${res.status}`);
          }

          const data = await res.json();
          if (data.retryable || res.status === 503) {
            continue;
          }

          return data.clips || [];
        } catch (fetchErr: any) {
          if (fetchErr.name === 'AbortError' || fetchErr.message === 'AbortError') throw fetchErr;
          if (fetchErr.message && (fetchErr.message.includes('400') || fetchErr.message.includes('404') || fetchErr.message.includes('413'))) {
            throw fetchErr;
          }
          if (attempt >= overloadDelays.length) throw fetchErr;
        }
      }

      throw new Error('Todas as tentativas de análise falharam devido a sobrecarga.');
    };

    try {
      for (let i = 0; i < taskList.length; i++) {
        if (!isRunningRef.current) break;

        while (isPausedRef.current && isRunningRef.current) {
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!isRunningRef.current) break;

        const task = taskList[i];
        if (completedIndices.includes(task.index)) continue;

        setCurrentBlockIdx(task.index);
        setBlockProgress(0);

        try {
          const clipsFound = await processBlockRange(task.start, task.end, task.index);
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

          await saveAnalysisState({
            fileKey,
            completedBlocks: completedIndices,
            clips: accumulatedClips,
            totalBlocks: taskList.length,
            isFinished: completedIndices.length === taskList.length,
          });
        } catch (err: any) {
          if (err.name === 'AbortError' || err.message === 'AbortError') {
            setIsRunning(false);
            return;
          }
          task.status = 'failed';
          setAnalysisError(`Bloco ${task.index + 1} falhou: ${err.message}`);
        }
      }

      setIsRunning(false);
      setAnalysisStatus('Análise de blocos concluída!');
    } catch (err: any) {
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

  // Helper for sentence boundary adjustment with required log format
  const processTranscriptAndAdjust = (rawWords: Array<{ word: string; start: number; end: number }>, originalStart: number, originalEnd: number, winStart: number, clipIdx: number) => {
    const absWords = rawWords.map(w => ({
      word: w.word,
      start: w.start + winStart,
      end: w.end + winStart,
    }));

    if (absWords.length === 0) {
      console.log(`[ClipsTab][legenda] corte ${clipIdx + 1}: início ${originalStart.toFixed(1)} -> ${originalStart.toFixed(1)}, fim ${originalEnd.toFixed(1)} -> ${originalEnd.toFixed(1)}`);
      return { start: originalStart, end: originalEnd, words: [], text: '' };
    }

    let closestStartCandidate = absWords[0].start;
    let minStartDiff = Math.abs(absWords[0].start - originalStart);
    for (const w of absWords) {
      const diff = Math.abs(w.start - originalStart);
      if (diff < minStartDiff && diff <= 4) {
        minStartDiff = diff;
        closestStartCandidate = w.start;
      }
    }

    let closestEndCandidate = absWords[absWords.length - 1].end;
    let minEndDiff = Math.abs(absWords[absWords.length - 1].end - originalEnd);
    for (const w of absWords) {
      const diff = Math.abs(w.end - originalEnd);
      if (diff < minEndDiff && diff <= 4) {
        minEndDiff = diff;
        closestEndCandidate = w.end;
      }
    }

    let newStart = Math.max(0, closestStartCandidate - 0.15);
    let newEnd = closestEndCandidate + 0.35;
    const dur = newEnd - newStart;
    if (dur < 20 || dur > 65) {
      newStart = originalStart;
      newEnd = originalEnd;
    }

    console.log(`[ClipsTab][legenda] corte ${clipIdx + 1}: início ${originalStart.toFixed(1)} -> ${newStart.toFixed(1)}, fim ${originalEnd.toFixed(1)} -> ${newEnd.toFixed(1)}`);

    const filtered = absWords
      .filter(w => w.end >= newStart && w.start <= newEnd)
      .map(w => ({
        word: w.word,
        start: Math.max(0, w.start - newStart),
        end: Math.max(0, w.end - newStart),
      }));

    const text = filtered.map(w => w.word).join(' ');
    return { start: newStart, end: newEnd, words: filtered, text };
  };

  // Persistent Render Queue (BUG 1 FIX: Never restart queue when new clips arrive, only append)
  useEffect(() => {
    if (!originalFile || clips.length === 0) return;

    setRenderStates((prev) => {
      const next = { ...prev };
      clips.forEach((c) => {
        if (!next[c.id]) {
          next[c.id] = { status: 'queued', progress: 0 };
          console.log(`[ClipsTab][render] corte ${c.title || c.id} adicionado à fila`);
        } else if (next[c.id].status === 'error' || (next[c.id].status === 'ready' && clipTranscripts[c.id]?.failed)) {
          // Re-queue clips that previously failed or rendered without subtitles due to bug
          next[c.id] = { status: 'queued', progress: 0 };
        }
      });
      return next;
    });

    if (!renderQueueRunningRef.current) {
      console.log('[ClipsTab][render] fila iniciada');
      startPersistentRenderQueue();
    }
  }, [originalFile, clips]);

  // Restart queue ONLY when style changes explicitly
  useEffect(() => {
    if (!originalFile || clips.length === 0) return;
    if (renderAbortControllerRef.current) {
      renderAbortControllerRef.current.abort();
    }
    renderAbortControllerRef.current = new AbortController();
    renderQueueRunningRef.current = false;

    // Reset non-ready clips to queued to re-render with new style
    setRenderStates((prev) => {
      const next = { ...prev };
      Object.keys(next).forEach((id) => {
        if (next[id].status === 'rendering' || next[id].status === 'error') {
          next[id] = { status: 'queued', progress: 0 };
        }
      });
      return next;
    });

    console.log('[ClipsTab][render] fila iniciada (estilo alterado)');
    startPersistentRenderQueue();
  }, [shortMode, showTitle, titleSeconds, showCaptions, captionPreset, captionFont, captionSize, captionWordsPerLine, captionPosition, captionHighlight]);

  const startPersistentRenderQueue = async () => {
    if (renderQueueRunningRef.current) return;
    renderQueueRunningRef.current = true;

    if (!renderAbortControllerRef.current) {
      renderAbortControllerRef.current = new AbortController();
    }
    const signal = renderAbortControllerRef.current.signal;

    try {
      while (!signal.aborted) {
        let nextClip: AIClip | null = null;
        let nextIdx = -1;

        const sorted = [...clips].sort((a, b) => b.score - a.score);
        for (let i = 0; i < sorted.length; i++) {
          const c = sorted[i];
          const st = renderStates[c.id];
          if (!st || st.status === 'queued') {
            nextClip = c;
            nextIdx = i;
            break;
          }
        }

        if (!nextClip) {
          break;
        }

        const clip = nextClip;
        const idx = nextIdx;

        setRenderStates((prev) => ({
          ...prev,
          [clip.id]: { status: 'rendering', progress: 0 },
        }));

        console.log(`[ClipsTab][render] corte ${idx + 1}: iniciando render ("${clip.title}")`);
        const startTime = Date.now();

        try {
          let transcriptData = clipTranscripts[clip.id];
          const cacheKey = `${fileKey}_${clip.id}`;

          if (!transcriptData || transcriptData.failed) {
            const cached = await loadTranscriptCache(cacheKey);
            if (cached && !cached.failed) {
              transcriptData = cached;
              setClipTranscripts((prev) => ({ ...prev, [clip.id]: cached }));
            } else {
              try {
                if (signal.aborted) {
                  setRenderStates((prev) => ({ ...prev, [clip.id]: { status: 'queued', progress: 0 } }));
                  break;
                }

                console.log(`[ClipsTab][legenda] corte ${idx + 1}: extraindo áudio para transcrição...`);
                const winStart = Math.max(0, clip.startSeconds - 3);
                const winEnd = clip.endSeconds + 3;
                const audioBlob = await makeAudioBlockOpus(originalFile!, winStart, winEnd, { signal });

                if (signal.aborted) {
                  setRenderStates((prev) => ({ ...prev, [clip.id]: { status: 'queued', progress: 0 } }));
                  break;
                }

                const formData = new FormData();
                formData.append('file', audioBlob, `clip_${clip.id}.ogg`);
                formData.append('customVocabulary', customVocabulary);

                console.log(`[ClipsTab][legenda] corte ${idx + 1}: enviando para /api/transcribe-clip`);
                const resp = await fetch('/api/transcribe-clip', {
                  method: 'POST',
                  body: formData,
                  signal,
                });

                if (!resp.ok) throw new Error(`Servidor respondeu ${resp.status}`);
                const resJson = await resp.json();

                if (signal.aborted) {
                  setRenderStates((prev) => ({ ...prev, [clip.id]: { status: 'queued', progress: 0 } }));
                  break;
                }

                const adjusted = processTranscriptAndAdjust(resJson.words || [], clip.startSeconds, clip.endSeconds, winStart, idx);
                transcriptData = { words: adjusted.words, text: adjusted.text, start: adjusted.start, end: adjusted.end };

                await saveTranscriptCache(cacheKey, transcriptData);
                setClipTranscripts((prev) => ({ ...prev, [clip.id]: transcriptData }));
                clip.startSeconds = adjusted.start;
                clip.endSeconds = adjusted.end;
              } catch (transErr: any) {
                if (transErr.name === 'AbortError' || transErr.message === 'AbortError' || signal.aborted) {
                  setRenderStates((prev) => ({ ...prev, [clip.id]: { status: 'queued', progress: 0 } }));
                  continue;
                }
                console.warn(`[ClipsTab][legenda] corte ${idx + 1}: falha na transcrição, renderizando sem legenda:`, transErr);
                transcriptData = { words: [], text: '', start: clip.startSeconds, end: clip.endSeconds, failed: true };
                setClipTranscripts((prev) => ({ ...prev, [clip.id]: transcriptData }));
              }
            }
          }

          if (signal.aborted) {
            setRenderStates((prev) => ({ ...prev, [clip.id]: { status: 'queued', progress: 0 } }));
            break;
          }

          const captionsToUse = transcriptData.failed ? [] : (transcriptData.words || []);
          const finalStart = transcriptData.failed ? clip.startSeconds : transcriptData.start;
          const finalEnd = transcriptData.failed ? clip.endSeconds : transcriptData.end;

          const activeStyle = (captionPreset === 'purpleBox' ? 'box' : 'text') as ('text' | 'box');
          const highlightColor = captionPreset === 'purpleBox' ? '#7C3AED' : captionPreset === 'white' ? '#FFFFFF' : captionHighlight;
          const captionStyle = {
            fontFamily: captionFont,
            size: captionSize,
            wordsPerLine: captionPreset === 'purpleBox' ? 2 : captionWordsPerLine,
            position: captionPosition,
            activeStyle,
            highlight: highlightColor,
            color: '#FFFFFF',
            outline: '#000000',
            uppercase: true,
          };

          await document.fonts.load(`900 ${captionSize}px ${captionFont}`);

          const blob = await renderShortClip(originalFile!, {
            start: finalStart,
            end: finalEnd,
            title: clip.title,
            mode: shortMode,
            config,
            showTitle,
            titleSeconds,
            captions: captionsToUse,
            showCaptions: showCaptions && !transcriptData.failed,
            captionStyle,
            onProgress: (p) => {
              if (!signal.aborted) {
                setRenderStates((prev) => ({
                  ...prev,
                  [clip.id]: { status: 'rendering', progress: p },
                }));
              }
            },
            signal,
          });

          if (signal.aborted) {
            setRenderStates((prev) => ({ ...prev, [clip.id]: { status: 'queued', progress: 0 } }));
            break;
          }

          const url = URL.createObjectURL(blob);
          const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);
          const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
          console.log(`[ClipsTab][render] corte ${idx + 1}: pronto (${sizeMB} MB em ${durationSec} s)`);

          await saveRenderedClipBlob(clip.id, blob);

          setRenderStates((prev) => ({
            ...prev,
            [clip.id]: { status: 'ready', progress: 100, blob, url },
          }));
        } catch (err: any) {
          if (err.name === 'AbortError' || err.message === 'AbortError' || signal.aborted) {
            setRenderStates((prev) => ({ ...prev, [clip.id]: { status: 'queued', progress: 0 } }));
            continue;
          }
          const errMsg = err.message || 'Erro desconhecido';
          console.error(`[ClipsTab][render] corte ${idx + 1}: erro:`, errMsg);
          setRenderStates((prev) => ({
            ...prev,
            [clip.id]: { status: 'error', progress: 0, errorMsg: errMsg },
          }));
        }
      }
    } finally {
      renderQueueRunningRef.current = false;
      console.log('[ClipsTab][render] ciclo da fila finalizado, ocupado = false');
    }
  };

  const handleRerenderSingle = (clipId: string) => {
    if (renderStates[clipId]?.url) {
      URL.revokeObjectURL(renderStates[clipId].url!);
    }
    setRenderStates((prev) => ({
      ...prev,
      [clipId]: { status: 'queued', progress: 0 },
    }));
    if (!renderQueueRunningRef.current) {
      startPersistentRenderQueue();
    }
  };

  const handleRetryTranscription = async (clipId: string) => {
    setClipTranscripts((prev) => {
      const next = { ...prev };
      delete next[clipId];
      return next;
    });
    handleRerenderSingle(clipId);
  };

  const handleSaveEditedTranscript = (clipId: string) => {
    const transcript = clipTranscripts[clipId];
    if (!transcript) return;

    const newWordsText = editTextVal.trim().split(/\s+/).filter(Boolean);
    const oldWords = transcript.words || [];

    let updatedWords = [];
    if (newWordsText.length === oldWords.length) {
      updatedWords = oldWords.map((w: any, idx: number) => ({
        ...w,
        word: newWordsText[idx],
      }));
    } else {
      const totalDuration = transcript.end - transcript.start;
      const step = totalDuration / Math.max(1, newWordsText.length);
      updatedWords = newWordsText.map((w, idx) => ({
        word: w,
        start: idx * step,
        end: (idx + 1) * step,
      }));
    }

    const newTranscript = {
      ...transcript,
      words: updatedWords,
      text: newWordsText.join(' '),
      failed: false,
    };

    setClipTranscripts((prev) => ({ ...prev, [clipId]: newTranscript }));
    saveTranscriptCache(`${fileKey}_${clipId}`, newTranscript);
    setEditingClipId(null);
    handleRerenderSingle(clipId);
  };

  const handleRerenderAll = () => {
    Object.values(renderStates).forEach((st) => {
      if (st.url) URL.revokeObjectURL(st.url);
    });
    setRenderStates({});
    if (originalFile && clips.length > 0) {
      const newStates: Record<string, ClipRenderState> = {};
      clips.forEach((c) => { newStates[c.id] = { status: 'queued', progress: 0 }; });
      setRenderStates(newStates);
    }
    if (!renderQueueRunningRef.current) {
      startPersistentRenderQueue();
    }
  };

  const handleDownloadZip = async () => {
    const readyClips = clips.filter((c) => c.selected && renderStates[c.id]?.status === 'ready' && renderStates[c.id]?.blob);
    if (readyClips.length === 0) {
      alert('Nenhum corte renderizado e selecionado para baixar.');
      return;
    }
    const zip = new JSZip();
    for (const c of readyClips) {
      const blob = renderStates[c.id].blob!;
      const safeName = c.title.replace(/[^a-zA-Z0-9_\-]/g, '_');
      zip.file(`${safeName}.mp4`, blob);
    }
    const content = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(content);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cortes_ia_${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSendSelectedToEditor = async () => {
    const selectedClips = clips.filter((c) => c.selected && renderStates[c.id]?.status === 'ready' && renderStates[c.id]?.blob);
    if (selectedClips.length === 0) {
      alert('Selecione pelo menos um corte já renderizado.');
      return;
    }
    setIsSendingToEditor(true);
    try {
      for (let i = 0; i < selectedClips.length; i++) {
        const c = selectedClips[i];
        setSendProgressMsg(`Enviando ${i + 1}/${selectedClips.length}...`);
        const blob = renderStates[c.id].blob!;
        const file = new File([blob], `${c.title}.mp4`, { type: 'video/mp4' });
        const videoItem: VideoItem = {
          id: `clip-item-${Date.now()}-${i}`,
          file,
          name: c.title,
          url: URL.createObjectURL(blob),
          duration: c.endSeconds - c.startSeconds,
        };
        onAddVideo(videoItem);
      }
      onSetHeadline(selectedClips[0].title);
      alert(`${selectedClips.length} cortes enviados para o Editor com sucesso!`);
    } catch (err: any) {
      alert(`Erro ao enviar para o editor: ${err.message}`);
    } finally {
      setIsSendingToEditor(false);
      setSendProgressMsg('');
    }
  };

  const filteredClips = clips
    .filter((c) => c.score >= minScoreFilter)
    .slice(0, displayLimit);

  const clipsPerHour = videoDuration > 0 ? ((clips.length / (videoDuration / 3600)) || 0).toFixed(0) : '20';
  const queuedSortedIds = [...clips].sort((a, b) => b.score - a.score).map((c) => c.id);

  return (
    <div className="flex-1 bg-slate-950 p-6 lg:p-10 overflow-y-auto text-slate-100 space-y-8">
      {globalBanner && (
        <div className="bg-red-950/80 border border-red-800 text-red-200 px-4 py-3 rounded-2xl flex items-center justify-between text-xs">
          <span>{globalBanner}</span>
          <button onClick={() => setGlobalBanner(null)} className="font-bold underline cursor-pointer">Fechar</button>
        </div>
      )}

      {/* Header & Video Uploader */}
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-3xl shadow-xl flex flex-col md:flex-row items-center justify-between gap-6">
        <div className="space-y-2 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-3">
            <div className="w-10 h-10 rounded-2xl bg-gradient-to-tr from-purple-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-purple-600/30">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Cortes IA Estilo Opus Clip</h2>
          </div>
          <p className="text-sm text-slate-400 max-w-xl">
            Extração ultrarrápida por áudio Opus, legendas dinâmicas palavra por palavra, ajuste inteligente à fronteira da frase e renderização vertical 9:16 em tela cheia.
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-center gap-4 w-full md:w-auto">
          {!originalFile ? (
            <label className="w-full sm:w-auto bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-semibold px-6 py-3.5 rounded-2xl transition shadow-lg shadow-purple-600/30 flex items-center justify-center gap-2 cursor-pointer text-sm">
              <Upload className="w-4 h-4" />
              <span>Selecionar Vídeo Longo (MP4/MKV)</span>
              <input type="file" accept="video/*" onChange={handleFileSelected} className="hidden" />
            </label>
          ) : (
            <div className="flex items-center gap-3 bg-slate-950 border border-slate-800 px-4 py-2.5 rounded-2xl">
              <Film className="w-5 h-5 text-purple-400" />
              <div className="text-left">
                <p className="text-xs font-bold text-white truncate max-w-[180px]">{originalFile.name}</p>
                <p className="text-[10px] text-slate-400">{(originalFile.size / (1024 * 1024)).toFixed(1)} MB • {formatHours(videoDuration)}</p>
              </div>
              <label className="text-xs bg-slate-800 hover:bg-slate-700 text-purple-300 px-3 py-1.5 rounded-xl cursor-pointer transition ml-2">
                Trocar
                <input type="file" accept="video/*" onChange={handleFileSelected} className="hidden" />
              </label>
            </div>
          )}
        </div>
      </div>

      {/* Analysis Configuration & Controls */}
      {originalFile && (
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-3xl space-y-6 shadow-xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Início da análise (hh:mm:ss)</label>
              <input
                type="text"
                value={startTimeInput}
                onChange={(e) => setStartTimeInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-purple-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Término da análise (hh:mm:ss)</label>
              <input
                type="text"
                value={endTimeInput}
                onChange={(e) => setEndTimeInput(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-purple-500"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-slate-300">Vocabulário do vídeo (separado por vírgula)</label>
              <input
                type="text"
                value={customVocabulary}
                onChange={(e) => setCustomVocabulary(e.target.value)}
                placeholder="Ex: GTA 6, Rockstar, Lucia..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-4 py-2.5 text-xs text-white outline-none focus:border-purple-500"
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-slate-800">
            <div className="text-xs text-slate-400">
              Estimativa: <span className="text-white font-semibold">{calculateEstimatedBlocks()}</span> blocos de análise (~20 min cada) • ~{formatHours(videoDuration)} de vídeo
            </div>

            <div className="flex items-center gap-3">
              {hasStoredAnalysis && !isRunning && (
                <button
                  onClick={() => startAnalysis(true)}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold px-5 py-2.5 rounded-xl text-xs transition flex items-center gap-2 cursor-pointer shadow-lg shadow-indigo-600/20"
                >
                  Retomar Análise Salva
                </button>
              )}

              {!isRunning ? (
                <button
                  onClick={() => startAnalysis(false)}
                  className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold px-6 py-2.5 rounded-xl text-xs transition flex items-center gap-2 cursor-pointer shadow-lg shadow-purple-600/30"
                >
                  <Sparkles className="w-4 h-4" />
                  Iniciar Nova Análise IA (~20 cortes/hora)
                </button>
              ) : (
                <button
                  onClick={() => setIsRunning(false)}
                  className="bg-red-600 hover:bg-red-500 text-white font-bold px-6 py-2.5 rounded-xl text-xs transition flex items-center gap-2 cursor-pointer shadow-lg shadow-red-600/30"
                >
                  <Pause className="w-4 h-4" />
                  Pausar / Parar Análise
                </button>
              )}
            </div>
          </div>

          {analysisError && (
            <div className="bg-red-950/80 border border-red-800 text-red-200 p-4 rounded-2xl text-xs flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
              <span>{analysisError}</span>
            </div>
          )}

          {isRunning && (
            <div className="space-y-2 bg-slate-950 p-4 rounded-2xl border border-slate-800">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-purple-300">{analysisStatus || 'Processando blocos...'}</span>
                <span className="text-slate-400">{blockProgress}%</span>
              </div>
              <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden">
                <div className="bg-purple-600 h-full transition-all duration-300" style={{ width: `${blockProgress}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      {/* Results List */}
      {(clips.length > 0 || isRunning) && (
        <div className="space-y-6">
          <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl">
            <div>
              <h3 className="font-semibold text-white text-base">
                Analisado de {startTimeInput} a {endTimeInput} — {clips.length} cortes encontrados (aprox. {clipsPerHour} por hora)
              </h3>
              <p className="text-xs text-slate-400">Renderizados com legendas dinâmicas palavra por palavra e enquadramento 9:16</p>
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <select
                value={minScoreFilter}
                onChange={(e) => setMinScoreFilter(Number(e.target.value))}
                className="bg-slate-800 border border-slate-700 text-slate-200 text-xs rounded-xl px-3 py-2"
              >
                <option value={40}>Score mínimo: 40+</option>
                <option value={60}>Score mínimo: 60+</option>
                <option value={80}>Score mínimo: 80+</option>
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
                onClick={handleDownloadZip}
                className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-4 py-2 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                Baixar Selecionados (ZIP)
              </button>

              <button
                onClick={handleSendSelectedToEditor}
                disabled={isSendingToEditor || clips.filter((c) => c.selected).length === 0}
                className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 disabled:opacity-50 text-white px-4 py-2 rounded-xl text-xs font-semibold transition flex items-center gap-2 shadow-lg shadow-purple-600/25 cursor-pointer"
              >
                {isSendingToEditor ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {sendProgressMsg || 'Enviando...'}
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

          {/* Style Selector & Caption Controls Bar */}
          <div className="bg-slate-900/80 border border-slate-800 p-5 rounded-3xl space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">Estilo Vertical:</span>
                <div className="flex bg-slate-950 border border-slate-800 p-1 rounded-xl gap-1">
                  <button
                    onClick={() => setShortMode('fill')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      shortMode === 'fill' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Tela cheia
                  </button>
                  <button
                    onClick={() => setShortMode('blur-fit')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      shortMode === 'blur-fit' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Fundo desfocado
                  </button>
                  <button
                    onClick={() => setShortMode('template')}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                      shortMode === 'template' ? 'bg-purple-600 text-white shadow' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Template ReelsFrame
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showTitle}
                    onChange={(e) => setShowTitle(e.target.checked)}
                    className="w-4 h-4 accent-purple-600 rounded"
                  />
                  <span>Título no topo</span>
                </label>

                <div className="flex items-center gap-2 text-xs text-slate-300">
                  <span>Segundos título:</span>
                  <input
                    type="number"
                    min={3}
                    max={8}
                    value={titleSeconds}
                    onChange={(e) => setTitleSeconds(Number(e.target.value) || 5)}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-white text-center text-xs"
                  />
                </div>

                <button
                  onClick={handleRerenderAll}
                  className="bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 px-3 py-1.5 rounded-xl text-xs font-medium transition flex items-center gap-1.5 cursor-pointer"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Re-renderizar Todos
                </button>
              </div>
            </div>

            {/* Captions Styling Controls Bar */}
            <div className="pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-xs font-bold text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showCaptions}
                    onChange={(e) => setShowCaptions(e.target.checked)}
                    className="w-4 h-4 accent-purple-600 rounded"
                  />
                  <span>Legendas Dinâmicas (CapCut style)</span>
                </label>

                <div className="flex items-center gap-1.5 bg-slate-950 border border-slate-800 p-1 rounded-xl">
                  <button
                    onClick={() => { setCaptionPreset('classic'); setCaptionHighlight('#FFE600'); }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      captionPreset === 'classic' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Clássico (Amarelo)
                  </button>
                  <button
                    onClick={() => { setCaptionPreset('purpleBox'); setCaptionHighlight('#7C3AED'); }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      captionPreset === 'purpleBox' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Caixa roxa
                  </button>
                  <button
                    onClick={() => { setCaptionPreset('white'); setCaptionHighlight('#FFFFFF'); }}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition ${
                      captionPreset === 'white' ? 'bg-purple-600 text-white' : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Branco puro
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
                <div className="flex items-center gap-1.5">
                  <span>Fonte:</span>
                  <select
                    value={captionFont}
                    onChange={(e) => setCaptionFont(e.target.value)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-white text-xs"
                  >
                    <option value="Montserrat">Montserrat</option>
                    <option value="Poppins">Poppins</option>
                    <option value="Inter">Inter</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span>Tamanho:</span>
                  <input
                    type="number"
                    min={60}
                    max={110}
                    value={captionSize}
                    onChange={(e) => setCaptionSize(Number(e.target.value) || 84)}
                    className="w-16 bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-white text-center text-xs"
                  />
                </div>

                <div className="flex items-center gap-1.5">
                  <span>Palavras/linha:</span>
                  <select
                    value={captionWordsPerLine}
                    onChange={(e) => setCaptionWordsPerLine(Number(e.target.value) || 3)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-white text-xs"
                  >
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                    <option value={4}>4</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <span>Posição:</span>
                  <select
                    value={captionPosition}
                    onChange={(e) => setCaptionPosition(e.target.value as any)}
                    className="bg-slate-950 border border-slate-800 rounded-lg px-2 py-1 text-white text-xs"
                  >
                    <option value="lower">Inferior</option>
                    <option value="center">Central</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          {/* Cards Grid with Vertical 9:16 Video Players */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredClips.map((clip, idx) => {
              const duration = Math.round(clip.endSeconds - clip.startSeconds);
              const rState = renderStates[clip.id] || { status: 'queued', progress: 0 };
              const transcript = clipTranscripts[clip.id];

              let queuePos = -1;
              if (rState.status === 'queued') {
                queuePos = queuedSortedIds.indexOf(clip.id) + 1;
              }

              return (
                <div
                  key={clip.id}
                  className={`bg-slate-900 border rounded-3xl p-5 flex flex-col justify-between transition shadow-xl ${
                    clip.selected ? 'border-purple-500/60 ring-1 ring-purple-500/40' : 'border-slate-800 opacity-80'
                  }`}
                >
                  <div className="space-y-4">
                    {/* Top Bar: Checkbox, Index, Score, Badge */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <button
                          onClick={() => setClips(clips.map((c) => (c.id === clip.id ? { ...c, selected: !c.selected } : c)))}
                          className="text-purple-400 hover:text-purple-300 cursor-pointer"
                        >
                          {clip.selected ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4 text-slate-600" />}
                        </button>
                        <span className="text-xs font-bold text-slate-400">#{idx + 1}</span>
                      </div>

                      <div className="flex items-center gap-2">
                        {transcript?.failed && (
                          <span className="text-[10px] bg-yellow-500/20 text-yellow-300 border border-yellow-500/30 px-2 py-0.5 rounded-full font-bold">
                            sem legenda
                          </span>
                        )}
                        <span className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2.5 py-0.5 rounded-full font-bold">
                          🔥 {clip.score}
                        </span>
                      </div>
                    </div>

                    {/* Vertical 9:16 Rendered Video Player or Status Placeholder */}
                    <div className="w-[220px] mx-auto aspect-[9/16] bg-black rounded-2xl overflow-hidden border border-slate-800 shadow-inner relative flex flex-col items-center justify-center">
                      {rState.status === 'ready' && rState.url ? (
                        <video
                          src={rState.url}
                          className="w-full h-full object-cover"
                          controls
                          playsInline
                          preload="none"
                        />
                      ) : rState.status === 'rendering' ? (
                        <div className="text-center p-4 space-y-2">
                          <Loader2 className="w-6 h-6 text-purple-400 animate-spin mx-auto" />
                          <p className="text-xs font-medium text-slate-300">renderizando {rState.progress}%</p>
                          <div className="w-32 bg-slate-800 h-1.5 rounded-full mx-auto overflow-hidden">
                            <div
                              className="bg-purple-500 h-full transition-all duration-300"
                              style={{ width: `${rState.progress}%` }}
                            />
                          </div>
                        </div>
                      ) : rState.status === 'error' ? (
                        <div className="text-center p-4 space-y-2">
                          <AlertCircle className="w-6 h-6 text-red-400 mx-auto" />
                          <p className="text-[11px] text-red-300 line-clamp-3">erro: {rState.errorMsg || 'Erro'}</p>
                          <button
                            onClick={() => handleRerenderSingle(clip.id)}
                            className="text-[10px] bg-red-950/60 hover:bg-red-900 text-white px-2.5 py-1 rounded-lg border border-red-800/50 cursor-pointer"
                          >
                            Tentar de novo
                          </button>
                        </div>
                      ) : (
                        <div className="text-center p-4 space-y-2">
                          <div className="w-3 h-3 rounded-full bg-purple-500 animate-pulse mx-auto" />
                          <p className="text-xs text-slate-300">na fila (posição {queuePos > 0 ? queuePos : 1})</p>
                          <button
                            onClick={() => handleRerenderSingle(clip.id)}
                            className="text-[10px] bg-purple-950/80 hover:bg-purple-900 text-purple-200 px-2.5 py-1 rounded-lg border border-purple-800/50 cursor-pointer transition"
                          >
                            Renderizar agora
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Editable Title */}
                    <div className="space-y-1">
                      <input
                        type="text"
                        value={clip.title}
                        onChange={(e) => {
                          const val = e.target.value;
                          setClips(clips.map((c) => (c.id === clip.id ? { ...c, title: val } : c)));
                        }}
                        className="w-full bg-slate-950 border border-slate-800 focus:border-purple-500 rounded-xl px-3 py-2 text-xs font-semibold text-white outline-none"
                      />
                      <div className="flex items-center justify-between text-[11px] text-slate-400 px-1">
                        <span>{duration}s • {formatSeconds(clip.startSeconds)} - {formatSeconds(clip.endSeconds)}</span>
                        {originalVideoUrl && (
                          <a
                            href={`${originalVideoUrl}#t=${clip.startSeconds}`}
                            target="_blank"
                            rel="noreferrer"
                            className="text-purple-400 hover:text-purple-300 underline flex items-center gap-1"
                          >
                            <ExternalLink className="w-3 h-3" />
                            Ver original
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Transcript / Subtitle text preview & edit */}
                    <div className="bg-slate-950 p-3 rounded-2xl border border-slate-800 space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <MessageSquare className="w-3 h-3 text-purple-400" />
                          Transcrição / Legenda
                        </span>
                        {transcript?.failed ? (
                          <button
                            onClick={() => handleRetryTranscription(clip.id)}
                            className="text-[10px] text-yellow-400 hover:text-yellow-300 underline cursor-pointer"
                          >
                            Tentar de novo
                          </button>
                        ) : (
                          <button
                            onClick={() => {
                              setEditingClipId(clip.id);
                              setEditTextVal(transcript?.text || '');
                            }}
                            className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 cursor-pointer"
                          >
                            <Edit3 className="w-3 h-3" />
                            Editar legenda
                          </button>
                        )}
                      </div>

                      {editingClipId === clip.id ? (
                        <div className="space-y-2">
                          <textarea
                            value={editTextVal}
                            onChange={(e) => setEditTextVal(e.target.value)}
                            rows={3}
                            className="w-full bg-slate-900 border border-purple-500/50 rounded-xl p-2 text-xs text-white outline-none"
                          />
                          <div className="flex justify-end gap-2">
                            <button
                              onClick={() => setEditingClipId(null)}
                              className="text-[10px] bg-slate-800 text-slate-300 px-2.5 py-1 rounded-lg"
                            >
                              Cancelar
                            </button>
                            <button
                              onClick={() => handleSaveEditedTranscript(clip.id)}
                              className="text-[10px] bg-purple-600 text-white px-2.5 py-1 rounded-lg font-semibold"
                            >
                              Salvar e Re-renderizar
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[11px] text-slate-300 line-clamp-3 italic">
                          {transcript?.text ? `"${transcript.text}"` : 'Aguardando transcrição...'}
                        </p>
                      )}
                    </div>

                    {/* Reason */}
                    <p className="text-xs text-slate-400 italic bg-slate-950/60 p-2.5 rounded-xl border border-slate-800/60 line-clamp-2">
                      "{clip.reason}"
                    </p>
                  </div>

                  {/* Card Actions */}
                  <div className="mt-5 pt-3 border-t border-slate-800 flex items-center justify-between gap-2">
                    {rState.status === 'ready' && rState.url ? (
                      <a
                        href={rState.url}
                        download={`${clip.title.replace(/[^a-zA-Z0-9_\-]/g, '_')}.mp4`}
                        className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium px-3 py-2 rounded-xl transition flex items-center gap-1.5 shadow-md shadow-purple-600/20"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Baixar MP4
                      </a>
                    ) : (
                      <button
                        disabled
                        className="bg-slate-800 text-slate-500 text-xs font-medium px-3 py-2 rounded-xl opacity-50 cursor-not-allowed"
                      >
                        {rState.status === 'rendering' ? `renderizando ${rState.progress}%` : `na fila (${queuePos > 0 ? queuePos : 1})`}
                      </button>
                    )}

                    <button
                      onClick={() => onSetHeadline(clip.title)}
                      className="text-xs text-purple-400 hover:text-purple-300 transition font-medium cursor-pointer"
                    >
                      Usar Headline
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {filteredClips.length < clips.length && (
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
  );
}

function formatSeconds(sec: number): string {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  const secs = Math.floor(sec % 60);
  return [hrs, mins, secs].map((v) => (v < 10 ? `0${v}` : v)).join(':');
}

function formatHours(sec: number): string {
  const hrs = Math.floor(sec / 3600);
  const mins = Math.floor((sec % 3600) / 60);
  if (hrs > 0) return `${hrs}h${mins > 0 ? ` ${mins}min` : ''}`;
  return `${mins} min`;
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
