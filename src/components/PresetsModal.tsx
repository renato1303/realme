import React from 'react';
import { X, Layers, Check } from 'lucide-react';
import { TEMPLATE_PRESETS } from '../presets';
import { TemplateConfig } from '../types';

interface PresetsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onApplyPreset: (config: Partial<TemplateConfig>) => void;
}

export function PresetsModal({ isOpen, onClose, onApplyPreset }: PresetsModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className="bg-slate-900 border border-slate-800 rounded-2xl w-full max-w-2xl overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-slate-950/50">
          <div className="flex items-center gap-2 text-white">
            <Layers className="w-5 h-5 text-purple-400" />
            <h3 className="font-semibold">Modelos Prontos (Presets)</h3>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition p-1 rounded-lg hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4 max-h-[70vh] overflow-y-auto">
          {TEMPLATE_PRESETS.map((preset) => (
            <div
              key={preset.id}
              onClick={() => {
                onApplyPreset(preset.config);
                onClose();
              }}
              className="group bg-slate-800/60 hover:bg-purple-950/30 border border-slate-700/80 hover:border-purple-500/60 rounded-2xl p-4 cursor-pointer transition flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-2xl">{preset.thumbnail}</span>
                  <span className="text-xs bg-purple-900/40 text-purple-300 border border-purple-500/30 px-2 py-0.5 rounded-full opacity-0 group-hover:opacity-100 transition">
                    Aplicar
                  </span>
                </div>
                <h4 className="font-semibold text-white text-base mb-1 group-hover:text-purple-300 transition">
                  {preset.name}
                </h4>
                <p className="text-xs text-slate-400">{preset.description}</p>
              </div>

              <div className="mt-4 pt-3 border-t border-slate-700/50 flex items-center justify-between text-xs text-slate-400">
                <span>Formato: {preset.config.aspectRatio || '9:16'}</span>
                <span className="text-purple-400 font-medium flex items-center gap-1 group-hover:underline">
                  Selecionar <Check className="w-3.5 h-3.5" />
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
