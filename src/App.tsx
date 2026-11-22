import React, { useState } from 'react';
import { Navbar } from './components/Navbar';
import { Sidebar } from './components/Sidebar';
import { PreviewCanvas } from './components/PreviewCanvas';
import { ExportModal } from './components/ExportModal';
import { PresetsModal } from './components/PresetsModal';
import { AIHeadlineModal } from './components/AIHeadlineModal';
import { ClipsTab } from './components/ClipsTab';
import { HistoryTab } from './components/HistoryTab';
import { TEMPLATE_PRESETS } from './presets';
import { TemplateConfig, VideoItem } from './types';

export default function App() {
  const [currentTab, setCurrentTab] = useState<'editor' | 'clips' | 'history'>('editor');
  const [config, setConfig] = useState<TemplateConfig>({
    ...(TEMPLATE_PRESETS[0].config as TemplateConfig),
  });

  const [videos, setVideos] = useState<VideoItem[]>([
    {
      id: 'sample-1',
      name: 'Exemplo The Office (Podcast).mp4',
      url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
      duration: 15,
      file: new File([], 'sample.mp4'),
    },
  ]);

  const [activeVideoId, setActiveVideoId] = useState<string>('sample-1');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [isPresetsOpen, setIsPresetsOpen] = useState(false);
  const [isAIOpen, setIsAIOpen] = useState(false);

  const activeVideo = videos.find((v) => v.id === activeVideoId) || videos[0] || null;

  const handleUpdateConfig = (newConfig: Partial<TemplateConfig>) => {
    setConfig((prev) => ({ ...prev, ...newConfig }));
  };

  const handleAddVideo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newVideos: VideoItem[] = [];
    Array.from(files).forEach((file) => {
      const url = URL.createObjectURL(file);
      const newVideo: VideoItem = {
        id: `vid-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        name: file.name,
        url,
        duration: 10,
        file,
      };
      newVideos.push(newVideo);
    });

    setVideos((prev) => [...prev, ...newVideos]);
    if (!activeVideoId && newVideos.length > 0) {
      setActiveVideoId(newVideos[0].id);
    } else if (videos.length === 0 && newVideos.length > 0) {
      setActiveVideoId(newVideos[0].id);
    }
  };

  const handleAddTrimmedVideo = (videoItem: VideoItem) => {
    setVideos((prev) => [...prev, videoItem]);
    setActiveVideoId(videoItem.id);
    setCurrentTab('editor');
  };

  const handleDeleteVideo = (id: string) => {
    setVideos((prev) => prev.filter((v) => v.id !== id));
    if (activeVideoId === id) {
      const remaining = videos.filter((v) => v.id !== id);
      setActiveVideoId(remaining.length > 0 ? remaining[0].id : '');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-['Inter',sans-serif] overflow-hidden">
      <Navbar
        currentTab={currentTab}
        onTabChange={(tab) => setCurrentTab(tab)}
        onOpenExport={() => setIsExportOpen(true)}
        onOpenPresets={() => setIsPresetsOpen(true)}
        onOpenAI={() => setIsAIOpen(true)}
      />

      {currentTab === 'editor' && (
        <div className="flex flex-1 overflow-hidden">
          <Sidebar
            config={config}
            onChangeConfig={handleUpdateConfig}
            videos={videos}
            activeVideo={activeVideo}
            onAddVideo={handleAddVideo}
            onSelectVideo={(id) => setActiveVideoId(id)}
            onDeleteVideo={handleDeleteVideo}
            onOpenAI={() => setIsAIOpen(true)}
          />

          <PreviewCanvas config={config} activeVideo={activeVideo} />
        </div>
      )}

      {currentTab === 'clips' && (
        <ClipsTab
          onAddVideo={handleAddTrimmedVideo}
          onSetHeadline={(headline) => handleUpdateConfig({ headline })}
          config={config}
        />
      )}

      {currentTab === 'history' && <HistoryTab />}

      <ExportModal
        isOpen={isExportOpen}
        onClose={() => setIsExportOpen(false)}
        activeVideo={activeVideo}
        videos={videos}
        config={config}
      />

      <PresetsModal
        isOpen={isPresetsOpen}
        onClose={() => setIsPresetsOpen(false)}
        onApplyPreset={(presetConfig) => handleUpdateConfig(presetConfig)}
      />

      <AIHeadlineModal
        isOpen={isAIOpen}
        onClose={() => setIsAIOpen(false)}
        onSelectHeadline={(headline) => handleUpdateConfig({ headline })}
      />
    </div>
  );
}
