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
  documentId?: string;
};
export type ArtcraftSnapshot = {
  id: string;
  editor: ArtcraftEditor;
  revision: string;
  filename: string;
  mime: string;
  dataBase64: string;
  nativeSaved: true;
  nativeDocument?: ArtcraftDocument;
  documentId?: string;
  widthMm?: number;
  heightMm?: number;
};
export type ArtcraftStatus = {
  available: boolean;
  editors: Record<ArtcraftEditor, { installed: boolean; version: string }>;
  sessions: ArtcraftSession[];
};
export type ArtcraftDocument = {
  id: string;
  editor: ArtcraftEditor;
  title: string;
  editorVersion: string;
  nativeFormat: 'pcraft' | 'vectorcraft';
  nativeBase64: string;
  nativeSha256: string;
  revision: string;
};
export type ArtcraftRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};
export interface ArtcraftRuntime {
  capture?(id: string): Promise<ArtcraftDocument>;
  restore?(document: unknown): Promise<ArtcraftSession>;
  host?(id: string, rect: ArtcraftRect): Promise<unknown>;
  hide?(id: string): Promise<void>;
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
