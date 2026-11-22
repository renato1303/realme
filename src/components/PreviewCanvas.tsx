import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, CheckCircle, Video as VideoIcon } from 'lucide-react';
import { TemplateConfig, VideoItem } from '../types';

interface PreviewCanvasProps {
  config: TemplateConfig;
  activeVideo: VideoItem | null;
}

export function PreviewCanvas({ config, activeVideo }: PreviewCanvasProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      setIsPlaying(false);
    }
  }, [activeVideo]);

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    videoRef.current.muted = !isMuted;
    setIsMuted(!isMuted);
  };

  const handleTimeUpdate = () => {
    if (videoRef.current) {
      setCurrentTime(videoRef.current.currentTime);
      setDuration(videoRef.current.duration || 0);
    }
  };

  // Determine container aspect ratio class
  const getAspectClass = () => {
    switch (config.aspectRatio) {
      case '1:1':
        return 'aspect-square max-w-[500px]';
      case '4:5':
        return 'aspect-[4/5] max-w-[480px]';
      case '16:9':
        return 'aspect-video max-w-[700px]';
      case '9:16':
      default:
        return 'aspect-[9/16] max-w-[380px]';
    }
  };

  const getFontFamily = () => {
    switch (config.headlineFont) {
      case 'Montserrat':
        return 'font-["Montserrat",sans-serif]';
      case 'Poppins':
        return 'font-["Poppins",sans-serif]';
      case 'Inter':
      default:
        return 'font-["Inter",sans-serif]';
    }
  };

  return (
    <div className="flex-1 bg-slate-900/40 flex flex-col items-center justify-center p-8 overflow-y-auto relative">
      <div className="absolute top-4 left-6 text-xs text-slate-400 font-medium">
        Pré-visualização em Tempo Real ({config.aspectRatio})
      </div>

      <div className="w-full flex items-center justify-center my-auto py-4">
        {/* TEMPLATE CONTAINER */}
        <div
          id="template-preview-container"
          className={`w-full ${getAspectClass()} shadow-2xl rounded-3xl overflow-hidden flex flex-col relative transition-all duration-300 select-none`}
          style={{
            backgroundColor: config.backgroundColor,
            backgroundImage:
              config.backgroundStyle === 'gradient'
                ? `linear-gradient(to bottom, ${config.backgroundColor}, ${config.backgroundSecondaryColor})`
                : 'none',
          }}
        >
          {/* HEADER: Profile Avatar, Name, Handle */}
          <div
            className="flex items-center gap-3 shrink-0 z-10"
            style={{
              paddingTop: `${config.paddingTop}px`,
              paddingLeft: `${config.paddingSides + 4}px`,
              paddingRight: `${config.paddingSides + 4}px`,
              paddingBottom: '12px',
            }}
          >
            <div className="relative shrink-0">
              <img
                src={config.profileAvatar || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80'}
                alt="Profile"
                className="w-11 h-11 rounded-full object-cover border-2 border-white shadow-md"
              />
            </div>
            <div className="flex flex-col truncate">
              <div className="flex items-center gap-1.5 truncate">
                <span className="font-bold text-sm tracking-tight truncate" style={{ color: config.headlineColor }}>
                  {config.profileName}
                </span>
                {config.showVerified && <CheckCircle className="w-3.5 h-3.5 text-blue-500 shrink-0 fill-blue-500/20" />}
              </div>
              <span className="text-xs text-slate-500 font-medium">@{config.profileHandle}</span>
            </div>
          </div>

          {/* HEADLINE */}
          <div
            className={`px-4 shrink-0 z-10 ${getFontFamily()}`}
            style={{
              paddingLeft: `${config.paddingSides + 4}px`,
              paddingRight: `${config.paddingSides + 4}px`,
              paddingBottom: '16px',
              textAlign: config.headlineAlign,
              color: config.headlineColor,
              fontSize: `${config.headlineSize}px`,
              lineHeight: '1.35',
              fontWeight: 700,
            }}
          >
            {config.headline || 'Escreva sua headline aqui...'}
          </div>

          {/* VIDEO CONTAINER */}
          <div
            className="flex-1 relative flex items-center justify-center overflow-hidden"
            style={{
              paddingLeft: `${config.paddingSides}px`,
              paddingRight: `${config.paddingSides}px`,
              paddingBottom: config.showBottomBar ? '60px' : `${config.paddingBottom}px`,
            }}
          >
            <div
              className={`w-full h-full relative overflow-hidden bg-black flex items-center justify-center ${
                config.videoShadow ? 'shadow-2xl' : ''
              } ${config.videoBorder ? 'border-2' : ''}`}
              style={{
                borderRadius: `${config.videoRounded}px`,
                borderColor: config.videoBorderColor,
              }}
            >
              {activeVideo ? (
                <video
                  ref={videoRef}
                  src={activeVideo.url}
                  className={`w-full h-full ${config.videoFit === 'cover' ? 'object-cover' : 'object-contain'}`}
                  playsInline
                  loop
                  onTimeUpdate={handleTimeUpdate}
                  onEnded={() => setIsPlaying(false)}
                />
              ) : (
                <div className="flex flex-col items-center justify-center text-slate-500 p-6 text-center">
                  <VideoIcon className="w-12 h-12 mb-2 opacity-40 animate-bounce" />
                  <p className="text-xs font-medium text-slate-400">Nenhum vídeo selecionado</p>
                  <p className="text-[10px] text-slate-500 mt-1">Carregue um vídeo na aba 'Vídeo' à esquerda</p>
                </div>
              )}

              {/* Play Overlay Button if paused and video exists */}
              {activeVideo && !isPlaying && (
                <button
                  onClick={togglePlay}
                  className="absolute inset-0 bg-black/30 hover:bg-black/40 flex items-center justify-center transition group cursor-pointer"
                >
                  <div className="w-16 h-16 rounded-full bg-white/90 hover:bg-white text-slate-900 flex items-center justify-center shadow-xl transition transform group-hover:scale-110">
                    <Play className="w-7 h-7 fill-slate-900 ml-1" />
                  </div>
                </button>
              )}
            </div>
          </div>

          {/* BOTTOM TICKER BAR */}
          {config.showBottomBar && (
            <div
              className="absolute bottom-3 left-3 right-3 rounded-2xl py-2.5 px-4 flex items-center shadow-lg z-20 text-white font-medium text-xs truncate"
              style={{ backgroundColor: config.bottomBarBg }}
            >
              <span className="truncate">{config.bottomBarText}</span>
            </div>
          )}
        </div>
      </div>

      {/* VIDEO PLAYER CONTROLS BAR */}
      {activeVideo && (
        <div className="bg-slate-950/80 border border-slate-800 rounded-2xl px-5 py-3 flex items-center gap-4 w-full max-w-md shadow-xl backdrop-blur-md">
          <button
            onClick={togglePlay}
            className="w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-500 text-white flex items-center justify-center transition shadow-md shadow-purple-600/30"
          >
            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
          </button>

          <div className="flex-1 flex flex-col gap-1">
            <div className="flex justify-between text-[11px] text-slate-400 font-medium">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={(e) => {
                if (videoRef.current) {
                  videoRef.current.currentTime = Number(e.target.value);
                  setCurrentTime(Number(e.target.value));
                }
              }}
              className="w-full accent-purple-500 h-1 bg-slate-800 rounded-lg cursor-pointer"
            />
          </div>

          <button
            onClick={toggleMute}
            className="text-slate-400 hover:text-white transition p-2 rounded-xl hover:bg-slate-800"
          >
            {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
          </button>
        </div>
      )}
    </div>
  );
}

function formatTime(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}
