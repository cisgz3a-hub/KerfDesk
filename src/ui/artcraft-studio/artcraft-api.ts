import type { StudioDocument } from '../../core/scene/studio-document';
export type StudioEditor = 'photo' | 'vector';
export type StudioSession = {
  readonly id: string;
  readonly editor: StudioEditor;
  readonly title: string;
  readonly running: boolean;
  readonly documentId?: string;
};
export type StudioStatus = {
  readonly available: boolean;
  readonly editors: Record<StudioEditor, { readonly installed: boolean; readonly version: string }>;
  readonly sessions: readonly StudioSession[];
};
export type StudioSnapshot = {
  readonly id: string;
  readonly editor: StudioEditor;
  readonly revision: string;
  readonly filename: string;
  readonly mime: string;
  readonly dataBase64: string;
  readonly nativeSaved: true;
  readonly nativeDocument?: StudioDocument;
  readonly documentId?: string;
  readonly widthMm?: number;
  readonly heightMm?: number;
};

async function request<T>(body?: object): Promise<T> {
  const response = await fetch('app://app/api/artcraft-studio', {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'X-KerfDesk-Studio': '1', 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result: unknown = await response.json();
  if (!response.ok) {
    const message =
      result !== null && typeof result === 'object' && 'error' in result
        ? String(result.error)
        : 'The desktop editor did not respond.';
    throw new Error(message);
  }
  return result as T;
}

export const getStudioStatus = (): Promise<StudioStatus> => request();
export const getStudioSnapshot = (sessionId: string): Promise<StudioSnapshot> =>
  request({ action: 'snapshot', sessionId });

export async function openStudioEditor(
  editor: StudioEditor,
  file: File | null,
  dimensions: { readonly widthMm: number; readonly heightMm: number },
): Promise<StudioSession> {
  const source = file === null ? undefined : await sourceFile(file, editor);
  return request({
    action: 'open',
    editor,
    ...dimensions,
    ...(source === undefined ? {} : { source }),
  });
}

async function sourceFile(file: File, editor: StudioEditor) {
  if (file.size > 32 * 1024 * 1024) throw new Error('This preview accepts files up to 32 MiB.');
  const extension = file.name.split('.').pop()?.toLowerCase();
  const mediaType =
    extension === 'svg' && editor === 'vector'
      ? 'image/svg+xml'
      : extension === 'png' && editor === 'photo'
        ? 'image/png'
        : (extension === 'jpg' || extension === 'jpeg') && editor === 'photo'
          ? 'image/jpeg'
          : null;
  if (mediaType === null)
    throw new Error('Choose SVG for VectorCraft, or PNG/JPEG for PhotoCraft.');
  const dataBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '');
    reader.readAsDataURL(file);
  });
  return { name: file.name, mediaType, dataBase64 };
}

export function snapshotFile(snapshot: StudioSnapshot): File {
  if (snapshot.nativeSaved !== true)
    throw new Error('Save the native editor document before Apply.');
  const extension = snapshot.editor === 'vector' ? 'svg' : 'png';
  const mime = snapshot.editor === 'vector' ? 'image/svg+xml' : 'image/png';
  const documentId = snapshot.documentId ?? snapshot.id;
  if (snapshot.mime !== mime || !/^[a-zA-Z0-9-]+$/.test(documentId))
    throw new Error('The editor returned an unsupported artwork snapshot.');
  const bytes = Uint8Array.from(atob(snapshot.dataBase64), (character) => character.charCodeAt(0));
  const content = snapshot.editor === 'vector' ? vectorSnapshotSource(bytes, snapshot) : bytes;
  return new File([content], `kerfdesk-studio-${documentId}.${extension}`, { type: mime });
}

export const resumeStudioEditor = (sessionId: string): Promise<StudioSession> =>
  request({ action: 'resume', sessionId });

/** Preserve the exported viewBox coordinate system while restoring physical units. */
export function vectorSnapshotSource(bytes: Uint8Array, snapshot: StudioSnapshot): string {
  const source = new TextDecoder().decode(bytes);
  if (!hasPhysicalDimensions(snapshot)) return source;
  const document = new DOMParser().parseFromString(source, 'image/svg+xml');
  const root = document.documentElement;
  if (
    document.querySelector('parsererror') !== null ||
    root.localName !== 'svg' ||
    !hasValidViewBox(root)
  )
    throw new Error('The editor export has no valid SVG viewBox for its physical dimensions.');
  root.setAttribute('width', `${snapshot.widthMm}mm`);
  root.setAttribute('height', `${snapshot.heightMm}mm`);
  return new XMLSerializer().serializeToString(document);
}

function hasPhysicalDimensions(snapshot: StudioSnapshot): boolean {
  const { widthMm, heightMm } = snapshot;
  if (widthMm === undefined && heightMm === undefined) return false;
  if (
    widthMm === undefined ||
    heightMm === undefined ||
    !Number.isFinite(widthMm) ||
    !Number.isFinite(heightMm) ||
    widthMm <= 0 ||
    heightMm <= 0
  )
    throw new Error('The editor returned invalid physical dimensions.');
  return true;
}

function hasValidViewBox(root: Element): boolean {
  const viewBox = root.getAttribute('viewBox')?.trim().split(/[ ,]+/u).map(Number);
  return (
    viewBox?.length === 4 &&
    viewBox.every(Number.isFinite) &&
    (viewBox[2] ?? 0) > 0 &&
    (viewBox[3] ?? 0) > 0
  );
}

export const captureStudioDocument = (sessionId: string): Promise<StudioDocument> =>
  request({ action: 'capture', sessionId });
export const restoreStudioDocument = (document: StudioDocument): Promise<StudioSession> =>
  request({ action: 'restore', document });
export type StudioViewport = {
  x: number;
  y: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
};
export const hostStudioEditor = (sessionId: string, rect: StudioViewport): Promise<unknown> =>
  request({ action: 'host', sessionId, rect });
export const hideStudioEditor = (sessionId: string): Promise<unknown> =>
  request({ action: 'hide', sessionId });
