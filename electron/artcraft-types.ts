export type ArtcraftEditor = 'photo' | 'vector';
export type ArtcraftSource = { name: string; dataBase64: string; mediaType: string };
export type ArtcraftOpen = {
  editor: ArtcraftEditor;
  source?: ArtcraftSource;
  widthMm?: number;
  heightMm?: number;
};
export type ArtcraftSession = {
  id: string;
  editor: ArtcraftEditor;
  title: string;
  running: boolean;
};
export type ArtcraftSnapshot = {
  id: string;
  editor: ArtcraftEditor;
  revision: string;
  filename: string;
  mime: string;
  dataBase64: string;
  nativeSaved: true;
  widthMm?: number;
  heightMm?: number;
};
export type ArtcraftStatus = {
  available: boolean;
  editors: Record<ArtcraftEditor, { installed: boolean; version: string }>;
  sessions: ArtcraftSession[];
};
export interface ArtcraftRuntime {
  status(): Promise<ArtcraftStatus>;
  open(input: ArtcraftOpen): Promise<ArtcraftSession>;
  snapshot(id: string): Promise<ArtcraftSnapshot>;
  resume(id: string): Promise<ArtcraftSession>;
}
export function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid editor response');
  }
  return value as Record<string, unknown>;
}
