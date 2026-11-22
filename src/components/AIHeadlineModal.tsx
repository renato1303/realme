import React, { useState } from 'react';
import { Sparkles, X, Loader2, Check } from 'lucide-react';

interface AIHeadlineModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectHeadline: (headline: string) => void;
}

export function AIHeadlineModal({ isOpen, onClose, onSelectHeadline }: AIHeadlineModalProps) {
  const [topic, setTopic] = useState('');
  const [style, setStyle] = useState('Provocativo e com citação');
  const [loading, setLoading] = useState(false);
  const [headlines, setHeadlines] = useState<string[]>([]);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!topic.trim()) return;

    setLoading(true);
    setError('');
    setHeadlines([]);

    try {
      const res = await fetch('/api/generate-headline', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topic, style }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Erro ao gerar headlines');
      }

      setHeadlines(data.headlines || []);
    } catch (err: any) {
      setError(err.message || 'Erro ao conectar com o servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2 text-purple-400">
            <Sparkles className="w-5 h-5 animate-pulse" />
            <h3 className="font-semibold text-white">Gerar Headline com IA (Gemini)</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleGenerate} className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">
              Sobre o que é o vídeo? (Tópico ou resumo)
            </label>
            <input
              type="text"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="Ex: Entrevista sobre inteligência artificial no trabalho, corte de podcast do The Office..."
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white placeholder-slate-500 focus:outline-none focus:border-purple-500 transition text-sm"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-1">Estilo da Headline</label>
            <select
              value={style}
              onChange={(e) => setStyle(e.target.value)}
              className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:border-purple-500 transition text-sm"
            >
              <option value="Provocativo e com citação">Provocativo e com citação</option>
              <option value="Curiosidade extrema com emoji">Curiosidade extrema com emoji</option>
              <option value="Polêmico e direto ao ponto">Polêmico e direto ao ponto</option>
              <option value="Inspirador / Motivacional">Inspirador / Motivacional</option>
              <option value="Humorístico / Meme">Humorístico / Meme</option>
            </select>
          </div>

          <button
            type="submit"
            disabled={loading || !topic.trim()}
            className="w-full bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-medium py-2.5 px-4 rounded-xl transition flex items-center justify-center gap-2 shadow-lg shadow-purple-600/25 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Criando ganchos virais...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Gerar Sugestões
              </>
            )}
          </button>
        </form>

        {error && (
          <div className="mx-6 mb-4 p-3 bg-red-950/50 border border-red-800/50 rounded-xl text-red-300 text-sm">
            {error}
          </div>
        )}

        {headlines.length > 0 && (
          <div className="px-6 pb-6 space-y-2">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">
              Escolha uma sugestão:
            </p>
            <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
              {headlines.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => {
                    onSelectHeadline(item);
                    onClose();
                  }}
                  className="group bg-slate-800/80 hover:bg-purple-950/40 border border-slate-700 hover:border-purple-600/50 rounded-xl p-3.5 text-sm text-white cursor-pointer transition flex items-center justify-between"
                >
                  <span className="font-medium">{item}</span>
                  <span className="text-xs bg-purple-900/50 text-purple-300 px-2 py-1 rounded-lg opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                    <Check className="w-3 h-3" /> Usar
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
