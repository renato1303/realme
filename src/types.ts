export type AspectRatio = '9:16' | '1:1' | '4:5' | '16:9';

export type BackgroundStyle = 'solid' | 'gradient' | 'pattern';

export interface TemplateConfig {
  profileName: string;
  profileHandle: string;
  profileAvatar: string;
  showVerified: boolean;
  headline: string;
  headlineFont: string;
  headlineSize: number;
  headlineColor: string;
  headlineAlign: 'left' | 'center' | 'right';
  backgroundColor: string;
  backgroundSecondaryColor: string;
  backgroundStyle: BackgroundStyle;
  aspectRatio: AspectRatio;
  videoFit: 'contain' | 'cover';
  videoRounded: number;
  videoShadow: boolean;
  videoBorder: boolean;
  videoBorderColor: string;
  paddingTop: number;
  paddingBottom: number;
  paddingSides: number;
  showBottomBar: boolean;
  bottomBarText: string;
  bottomBarBg: string;
}

export interface VideoItem {
  id: string;
  name: string;
  url: string;
  duration: number;
  file: File;
}

export interface TemplatePreset {
  id: string;
  name: string;
  description: string;
  thumbnail: string;
  config: Partial<TemplateConfig>;
}

export interface AIClip {
  id: string;
  startSeconds: number;
  endSeconds: number;
  title: string;
  score: number;
  reason: string;
  selected?: boolean;
}

