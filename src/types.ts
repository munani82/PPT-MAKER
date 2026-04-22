export type LayerType = 'image' | 'color';

export interface Layer {
  id: string;
  name: string;
  type: LayerType;
  isVisible: boolean;
  content: string; // Base64 or Color hex
  scale: number;
}

export interface Slide {
  id: string;
  layers: Layer[];
}

export type LayoutOrientation = 'landscape' | 'portrait';
