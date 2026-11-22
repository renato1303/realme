import React from 'react';
import { Sparkles, Download, Wand2, Layers, Scissors, Film, History } from 'lucide-react';

interface NavbarProps {
  currentTab: 'editor' | 'clips' | 'history';
  onTabChange: (tab: 'editor' | 'clips' | 'history') => void;
  onOpenExport: () => void;
  onOpenPresets: () => void;
  onOpenAI: () => void;
}

export function Navbar({
  currentTab,
  onTabChange,
  onOpenExport,
  onOpenPresets,
  onOpenAI,
}: NavbarProps) {
  return (
    <header className="h-16 border-b border-slate-800 bg-slate-950/80 backdrop-blur-md px-6 flex items-center justify-between sticky top-0 z-40">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-lg shadow-purple-600/30">
            <Wand2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="font-bold text-white tracking-tight flex items-center gap-2">
              ReelsFrame Studio
              <span className="text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full font-normal">
                Pro v2.0
              </span>
            </h1>
            <p className="text-xs text-slate-400">Enquadre seus vídeos do Instagram e TikTok em segundos</p>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="hidden md:flex items-center bg-slate-900 border border-slate-800 p-1 rounded-xl gap-1">
          <button
            onClick={() => onTabChange('editor')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition ${
              currentTab === 'editor'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Film className="w-3.5 h-3.5" />
            <span>Editor & Templates</span>
          </button>
          <button
            onClick={() => onTabChange('clips')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition ${
              currentTab === 'clips'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Scissors className="w-3.5 h-3.5" />
            <span>Cortes IA</span>
          </button>
          <button
            onClick={() => onTabChange('history')}
            className={`flex items-center gap-2 px-4 py-1.5 rounded-lg text-xs font-medium transition ${
              currentTab === 'history'
                ? 'bg-purple-600 text-white shadow-md'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <History className="w-3.5 h-3.5" />
            <span>Histórico</span>
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        {currentTab === 'editor' && (
          <>
            <button
              onClick={onOpenAI}
              className="bg-slate-800 hover:bg-slate-700 text-purple-300 border border-purple-500/30 px-3.5 py-2 rounded-xl text-sm font-medium transition flex items-center gap-2 shadow-sm"
            >
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>IA Gerar Hook</span>
            </button>

            <button
              onClick={onOpenPresets}
              className="bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 px-3.5 py-2 rounded-xl text-sm font-medium transition flex items-center gap-2"
            >
              <Layers className="w-4 h-4 text-slate-400" />
              <span>Modelos</span>
            </button>

            <button
              onClick={onOpenExport}
              className="bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white px-4 py-2 rounded-xl text-sm font-semibold transition flex items-center gap-2 shadow-lg shadow-purple-600/25"
            >
              <Download className="w-4 h-4" />
              <span>Exportar Vídeo</span>
            </button>
          </>
        )}

        {currentTab !== 'editor' && (
          <button
            onClick={() => onTabChange('editor')}
            className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 px-4 py-2 rounded-xl text-sm font-medium transition flex items-center gap-2"
          >
            <Film className="w-4 h-4" />
            <span>Ir para o Editor</span>
          </button>
        )}
      </div>
    </header>
  );
}
