import React, { useState } from 'react';
import { Film, User, Type, Palette, Upload, Sparkles, Check, Trash2, Sliders } from 'lucide-react';
import { TemplateConfig, VideoItem } from '../types';

interface SidebarProps {
  config: TemplateConfig;
  onChangeConfig: (newConfig: Partial<TemplateConfig>) => void;
  videos: VideoItem[];
  activeVideo: VideoItem | null;
  onAddVideo: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSelectVideo: (id: string) => void;
  onDeleteVideo: (id: string) => void;
  onOpenAI: () => void;
}

export function Sidebar({
  config,
  onChangeConfig,
  videos,
  activeVideo,
  onAddVideo,
  onSelectVideo,
  onDeleteVideo,
  onOpenAI,
}: SidebarProps) {
  const [activeTab, setActiveTab] = useState<'video' | 'profile' | 'headline' | 'layout'>('video');

  const avatarPresets = [
    'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=150&auto=format&fit=crop&q=80',
    'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=150&auto=format&fit=crop&q=80',
  ];

  return (
    <aside className="w-96 border-r border-slate-800 bg-slate-950/90 flex flex-col h-[calc(100vh-4rem)] overflow-hidden">
      {/* Tabs Header */}
      <div className="flex border-b border-slate-800 bg-slate-900/50 p-2 gap-1 shrink-0">
        <button
          onClick={() => setActiveTab('video')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'video'
              ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Film className="w-4 h-4" />
          <span>Vídeo</span>
        </button>

        <button
          onClick={() => setActiveTab('profile')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'profile'
              ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <User className="w-4 h-4" />
          <span>Perfil</span>
        </button>

        <button
          onClick={() => setActiveTab('headline')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'headline'
              ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Type className="w-4 h-4" />
          <span>Headline</span>
        </button>

        <button
          onClick={() => setActiveTab('layout')}
          className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition ${
            activeTab === 'layout'
              ? 'bg-purple-600/20 text-purple-300 border border-purple-500/30'
              : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
          }`}
        >
          <Palette className="w-4 h-4" />
          <span>Layout</span>
        </button>
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-5 space-y-6">
        {/* TAB 1: VIDEO */}
        {activeTab === 'video' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <Film className="w-4 h-4 text-purple-400" />
                Seus Vídeos ({videos.length})
              </h3>
              <p className="text-xs text-slate-400 mb-3">
                Faça upload dos vídeos que você baixou do Instagram ou TikTok para aplicar o template sem alterar o vídeo original.
              </p>

              <label className="border-2 border-dashed border-slate-700 hover:border-purple-500/60 bg-slate-900/50 hover:bg-purple-950/10 rounded-2xl p-4 flex flex-col items-center justify-center cursor-pointer transition group">
                <Upload className="w-6 h-6 text-slate-400 group-hover:text-purple-400 mb-2 transition" />
                <span className="text-sm font-medium text-slate-200 group-hover:text-purple-300">Carregar até 50 Vídeos</span>
                <span className="text-xs text-slate-500 mt-1">Selecione múltiplos arquivos (.mp4, .mov, .webm)</span>
                <input type="file" accept="video/*" multiple onChange={onAddVideo} className="hidden" />
              </label>
            </div>

            {videos.length > 0 && (
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  Selecionar Vídeo Ativo:
                </label>
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {videos.map((v) => (
                    <div
                      key={v.id}
                      onClick={() => onSelectVideo(v.id)}
                      className={`p-3 rounded-xl border flex items-center justify-between cursor-pointer transition ${
                        activeVideo?.id === v.id
                          ? 'bg-purple-600/20 border-purple-500 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800/80'
                      }`}
                    >
                      <div className="flex items-center gap-3 truncate">
                        <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center shrink-0">
                          <Film className="w-4 h-4 text-purple-400" />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-medium truncate">{v.name}</p>
                          <p className="text-xs text-slate-500">{Math.round(v.duration || 0)}s</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {activeVideo?.id === v.id && <Check className="w-4 h-4 text-purple-400" />}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteVideo(v.id);
                          }}
                          className="text-slate-500 hover:text-red-400 transition p-1"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="border-t border-slate-800 pt-4 space-y-4">
              <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Ajustes do Vídeo no Template</h4>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">Enquadramento (Fit)</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => onChangeConfig({ videoFit: 'contain' })}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border transition ${
                      config.videoFit === 'contain'
                        ? 'bg-purple-600/20 border-purple-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    Exibir Completo (Contain)
                  </button>
                  <button
                    onClick={() => onChangeConfig({ videoFit: 'cover' })}
                    className={`py-2 px-3 rounded-xl text-xs font-medium border transition ${
                      config.videoFit === 'cover'
                        ? 'bg-purple-600/20 border-purple-500 text-white'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                    }`}
                  >
                    Preencher (Cover)
                  </button>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs text-slate-300 mb-1">
                  <span>Cantos Arredondados</span>
                  <span>{config.videoRounded}px</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="32"
                  value={config.videoRounded}
                  onChange={(e) => onChangeConfig({ videoRounded: Number(e.target.value) })}
                  className="w-full accent-purple-500"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Sombra no Vídeo</span>
                <input
                  type="checkbox"
                  checked={config.videoShadow}
                  onChange={(e) => onChangeConfig({ videoShadow: e.target.checked })}
                  className="w-4 h-4 accent-purple-600 rounded"
                />
              </div>

              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-300">Borda Delicada</span>
                <input
                  type="checkbox"
                  checked={config.videoBorder}
                  onChange={(e) => onChangeConfig({ videoBorder: e.target.checked })}
                  className="w-4 h-4 accent-purple-600 rounded"
                />
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: PROFILE */}
        {activeTab === 'profile' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <User className="w-4 h-4 text-purple-400" />
                Foto e Identidade da Página
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Configure a foto circular, nome da página e arroba que aparecem no topo do template.
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Foto de Perfil (URL ou Imagem)</label>
                  <div className="flex items-center gap-3">
                    <img
                      src={config.profileAvatar}
                      alt="Avatar"
                      className="w-12 h-12 rounded-full object-cover border-2 border-purple-500/50 shrink-0"
                    />
                    <input
                      type="text"
                      value={config.profileAvatar}
                      onChange={(e) => onChangeConfig({ profileAvatar: e.target.value })}
                      placeholder="https://exemplo.com/foto.jpg"
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-purple-500"
                    />
                  </div>
                  <div className="flex gap-2 mt-2">
                    {avatarPresets.map((preset, idx) => (
                      <button
                        key={idx}
                        onClick={() => onChangeConfig({ profileAvatar: preset })}
                        className="w-8 h-8 rounded-full overflow-hidden border border-slate-700 hover:border-purple-500 transition"
                      >
                        <img src={preset} alt="Preset" className="w-full h-full object-cover" />
                      </button>
                    ))}
                  </div>

                  <label className="mt-2.5 w-full bg-slate-900 hover:bg-slate-800 border border-slate-800 hover:border-purple-500/50 rounded-xl py-2 px-3 flex items-center justify-center gap-2 cursor-pointer transition text-xs font-medium text-slate-300">
                    <Upload className="w-3.5 h-3.5 text-purple-400" />
                    <span>Fazer upload da foto do computador</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          const url = URL.createObjectURL(file);
                          onChangeConfig({ profileAvatar: url });
                        }
                      }}
                      className="hidden"
                    />
                  </label>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Nome da Página</label>
                  <input
                    type="text"
                    value={config.profileName}
                    onChange={(e) => onChangeConfig({ profileName: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Arroba (@)</label>
                  <div className="relative">
                    <span className="absolute left-3 top-2.5 text-slate-500 text-sm">@</span>
                    <input
                      type="text"
                      value={config.profileHandle}
                      onChange={(e) => onChangeConfig({ profileHandle: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl pl-8 pr-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <span className="text-xs font-medium text-slate-300">Selo de Verificado</span>
                  <input
                    type="checkbox"
                    checked={config.showVerified}
                    onChange={(e) => onChangeConfig({ showVerified: e.target.checked })}
                    className="w-4 h-4 accent-purple-600 rounded"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: HEADLINE */}
        {activeTab === 'headline' && (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                  <Type className="w-4 h-4 text-purple-400" />
                  Headline / Legenda do Topo
                </h3>
                <button
                  onClick={onOpenAI}
                  className="text-xs bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/40 px-2.5 py-1 rounded-lg transition flex items-center gap-1 font-medium"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  IA Hook
                </button>
              </div>
              <p className="text-xs text-slate-400 mb-4">
                Escreva a chamada ou citação que aparecerá logo acima do vídeo.
              </p>

              <div className="space-y-4">
                <div>
                  <textarea
                    rows={3}
                    value={config.headline}
                    onChange={(e) => onChangeConfig({ headline: e.target.value })}
                    placeholder='"e vou além" 👆'
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl p-3 text-sm text-white focus:outline-none focus:border-purple-500 resize-none"
                  />
                  <div className="flex gap-2 mt-2">
                    {['🔥', '👆', '🤯', '💡', '⚠️', '👇'].map((emoji) => (
                      <button
                        key={emoji}
                        onClick={() => onChangeConfig({ headline: config.headline + ' ' + emoji })}
                        className="bg-slate-900 hover:bg-slate-800 border border-slate-800 px-2.5 py-1 rounded-lg text-xs transition"
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Fonte</label>
                  <select
                    value={config.headlineFont}
                    onChange={(e) => onChangeConfig({ headlineFont: e.target.value })}
                    className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500"
                  >
                    <option value="Inter">Inter (Moderna)</option>
                    <option value="Montserrat">Montserrat (Impacto)</option>
                    <option value="Poppins">Poppins (Arredondada)</option>
                  </select>
                </div>

                <div>
                  <div className="flex justify-between text-xs text-slate-300 mb-1">
                    <span>Tamanho da Fonte</span>
                    <span>{config.headlineSize}px</span>
                  </div>
                  <input
                    type="range"
                    min="14"
                    max="32"
                    value={config.headlineSize}
                    onChange={(e) => onChangeConfig({ headlineSize: Number(e.target.value) })}
                    className="w-full accent-purple-500"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Alinhamento</label>
                    <div className="grid grid-cols-3 gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800">
                      {(['left', 'center', 'right'] as const).map((align) => (
                        <button
                          key={align}
                          onClick={() => onChangeConfig({ headlineAlign: align })}
                          className={`py-1.5 rounded-lg text-xs capitalize transition ${
                            config.headlineAlign === align ? 'bg-purple-600 text-white font-medium' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          {align === 'left' ? ' Esq' : align === 'center' ? 'Centro' : 'Dir'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1">Cor do Texto</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={config.headlineColor}
                        onChange={(e) => onChangeConfig({ headlineColor: e.target.value })}
                        className="w-10 h-9 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer p-1"
                      />
                      <input
                        type="text"
                        value={config.headlineColor}
                        onChange={(e) => onChangeConfig({ headlineColor: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white uppercase"
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: LAYOUT */}
        {activeTab === 'layout' && (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-semibold text-white mb-2 flex items-center gap-2">
                <Palette className="w-4 h-4 text-purple-400" />
                Formato e Fundo do Template
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                Escolha o formato do vídeo (Reels/TikTok 9:16) e a cor de fundo (Fundo branco padrão).
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Proporção (Aspect Ratio)</label>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { id: '9:16', label: '9:16 (Reels / TikTok)' },
                      { id: '1:1', label: '1:1 (Quadrado Feed)' },
                      { id: '4:5', label: '4:5 (Retrato Feed)' },
                      { id: '16:9', label: '16:9 (YouTube)' },
                    ].map((fmt) => (
                      <button
                        key={fmt.id}
                        onClick={() => onChangeConfig({ aspectRatio: fmt.id as any })}
                        className={`py-2 px-3 rounded-xl text-xs font-medium border transition text-left ${
                          config.aspectRatio === fmt.id
                            ? 'bg-purple-600/20 border-purple-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                        }`}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Cor de Fundo</label>
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="color"
                      value={config.backgroundColor}
                      onChange={(e) => onChangeConfig({ backgroundColor: e.target.value })}
                      className="w-10 h-9 bg-slate-900 border border-slate-800 rounded-xl cursor-pointer p-1"
                    />
                    <input
                      type="text"
                      value={config.backgroundColor}
                      onChange={(e) => onChangeConfig({ backgroundColor: e.target.value })}
                      className="w-full bg-slate-900 border border-slate-800 rounded-xl px-2 py-1.5 text-xs text-white uppercase"
                    />
                  </div>
                  <div className="flex gap-2">
                    {['#ffffff', '#f8fafc', '#0f172a', '#18181b', '#fee2e2', '#e0e7ff'].map((color) => (
                      <button
                        key={color}
                        onClick={() => onChangeConfig({ backgroundColor: color })}
                        className="w-7 h-7 rounded-lg border border-slate-700 shadow-sm transition hover:scale-110"
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-800 pt-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-slate-300">Barra Inferior (Ex: Super Chat / Ticker)</span>
                    <input
                      type="checkbox"
                      checked={config.showBottomBar}
                      onChange={(e) => onChangeConfig({ showBottomBar: e.target.checked })}
                      className="w-4 h-4 accent-purple-600 rounded"
                    />
                  </div>

                  {config.showBottomBar && (
                    <div>
                      <label className="block text-xs font-medium text-slate-300 mb-1">Texto da Barra Inferior</label>
                      <input
                        type="text"
                        value={config.bottomBarText}
                        onChange={(e) => onChangeConfig({ bottomBarText: e.target.value })}
                        className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:border-purple-500"
                      />
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}
