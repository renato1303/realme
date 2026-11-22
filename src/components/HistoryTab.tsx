import React, { useState, useEffect } from 'react';
import { History, Download, Scissors, Trash2, Calendar, FileVideo, FileArchive, Image as ImageIcon } from 'lucide-react';
import { loadExportHistory, loadAllAnalyses, clearExportHistory, clearAnalysisState, ExportHistoryItem } from '../lib/db';

export function HistoryTab() {
  const [exportHistory, setExportHistory] = useState<ExportHistoryItem[]>([]);
  const [analysesHistory, setAnalysesHistory] = useState<any[]>([]);
  const [activeSubTab, setActiveSubTab] = useState<'exports' | 'cuts'>('exports');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      const exports = await loadExportHistory();
      setExportHistory(exports);

      const analyses = await loadAllAnalyses();
      setAnalysesHistory(analyses);
    } catch (err) {
      console.error('Error loading history:', err);
    }
  };

  const handleClearExports = async () => {
    if (confirm('Deseja limpar todo o histórico de downloads?')) {
      await clearExportHistory();
      setExportHistory([]);
    }
  };

  const handleClearAnalyses = async () => {
    if (confirm('Deseja limpar todo o histórico de cortes de IA?')) {
      for (const item of analysesHistory) {
        await clearAnalysisState(item.fileKey);
      }
      setAnalysesHistory([]);
    }
  };

  return (
    <div className="flex-1 bg-slate-950 p-8 overflow-y-auto">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-6">
          <div>
            <h2 className="text-2xl font-bold text-white flex items-center gap-2.5">
              <History className="w-6 h-6 text-purple-400" />
              Histórico de Downloads e Cortes IA
            </h2>
            <p className="text-slate-400 text-sm mt-1">
              Consulte seus arquivos exportados anteriormente e histórico de análises de vídeos longos.
            </p>
          </div>

          <div className="flex bg-slate-900 border border-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setActiveSubTab('exports')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
                activeSubTab === 'exports' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Download className="w-3.5 h-3.5" />
              <span>Downloads ({exportHistory.length})</span>
            </button>
            <button
              onClick={() => setActiveSubTab('cuts')}
              className={`px-4 py-2 rounded-lg text-xs font-medium transition flex items-center gap-2 ${
                activeSubTab === 'cuts' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-white'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
              <span>Cortes IA ({analysesHistory.length})</span>
            </button>
          </div>
        </div>

        {/* SUBTAB 1: EXPORT HISTORY */}
        {activeSubTab === 'exports' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Histórico de Arquivos Exportados</h3>
              {exportHistory.length > 0 && (
                <button
                  onClick={handleClearExports}
                  className="text-xs bg-red-950/50 hover:bg-red-900/50 border border-red-800/40 text-red-300 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpar Histórico
                </button>
              )}
            </div>

            {exportHistory.length === 0 ? (
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3">
                <Download className="w-10 h-10 text-slate-600 mx-auto opacity-50" />
                <p className="text-sm font-medium text-slate-300">Nenhum download registrado ainda.</p>
                <p className="text-xs text-slate-500">Os vídeos ou imagens exportados aparecerão aqui automaticamente.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {exportHistory.map((item) => (
                  <div
                    key={item.id}
                    className="bg-slate-900 border border-slate-800 rounded-2xl p-4 flex items-center justify-between transition hover:border-purple-500/40"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-10 h-10 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
                        {item.type === 'batch-zip' ? (
                          <FileArchive className="w-5 h-5" />
                        ) : item.type === 'image' ? (
                          <ImageIcon className="w-5 h-5" />
                        ) : (
                          <FileVideo className="w-5 h-5" />
                        )}
                      </div>
                      <div>
                        <h4 className="font-semibold text-white text-sm">{item.filename}</h4>
                        <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {new Date(item.timestamp).toLocaleString('pt-BR')}
                          </span>
                          <span>•</span>
                          <span>Formato: {item.aspectRatio}</span>
                          <span>•</span>
                          <span className="capitalize">{item.type.replace('-', ' ')}</span>
                        </div>
                      </div>
                    </div>

                    {item.downloadUrl && (
                      <a
                        href={item.downloadUrl}
                        download={item.filename}
                        className="bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium px-4 py-2 rounded-xl transition flex items-center gap-1.5 shadow-md shadow-purple-600/20"
                      >
                        <Download className="w-3.5 h-3.5" />
                        Baixar Novamente
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* SUBTAB 2: AI CUTS ANALYSES HISTORY */}
        {activeSubTab === 'cuts' && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-white uppercase tracking-wider">Histórico de Análises de Cortes IA</h3>
              {analysesHistory.length > 0 && (
                <button
                  onClick={handleClearAnalyses}
                  className="text-xs bg-red-950/50 hover:bg-red-900/50 border border-red-800/40 text-red-300 px-3 py-1.5 rounded-xl transition flex items-center gap-1.5"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Limpar Histórico
                </button>
              )}
            </div>

            {analysesHistory.length === 0 ? (
              <div className="bg-slate-900/50 border border-slate-800 rounded-3xl p-12 text-center text-slate-400 space-y-3">
                <Scissors className="w-10 h-10 text-slate-600 mx-auto opacity-50" />
                <p className="text-sm font-medium text-slate-300">Nenhum histórico de cortes IA registrado.</p>
                <p className="text-xs text-slate-500">As análises de vídeos longos realizadas na aba "Cortes IA" ficam salvas aqui.</p>
              </div>
            ) : (
              <div className="space-y-3">
                {analysesHistory.map((analysis) => {
                  const [filename] = analysis.fileKey.split('_');
                  return (
                    <div
                      key={analysis.fileKey}
                      className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-3 transition hover:border-purple-500/40"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-xl bg-purple-600/20 text-purple-400 border border-purple-500/30 flex items-center justify-center shrink-0">
                            <Scissors className="w-4 h-4" />
                          </div>
                          <div>
                            <h4 className="font-semibold text-white text-sm">{filename}</h4>
                            <p className="text-xs text-slate-400">
                              Data: {new Date(analysis.timestamp || Date.now()).toLocaleString('pt-BR')}
                            </p>
                          </div>
                        </div>

                        <span
                          className={`text-xs px-3 py-1 rounded-full font-medium ${
                            analysis.isFinished
                              ? 'bg-green-500/20 text-green-300 border border-green-500/30'
                              : 'bg-yellow-500/20 text-yellow-300 border border-yellow-500/40'
                          }`}
                        >
                          {analysis.isFinished ? 'Concluído' : 'Pendente / Pausado'}
                        </span>
                      </div>

                      <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/80 flex items-center justify-between text-xs text-slate-300">
                        <span>Blocos processados: <strong>{analysis.completedBlocks?.length || 0} de {analysis.totalBlocks || 0}</strong></span>
                        <span>Cortes encontrados: <strong>{analysis.clips?.length || 0}</strong></span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
