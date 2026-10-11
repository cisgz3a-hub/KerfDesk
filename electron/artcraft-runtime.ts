import { prepareRecoveredSession } from './artcraft-recovery.js';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTCRAFT_VERSIONS, readArtcraftInstallation } from './artcraft-installation.js';
import { launchArtcraftProcess, type ArtcraftProcess } from './artcraft-process.js';
import {
  assertManagedDocument,
  initialiseEditor,
  inspectEditor,
  saveEditorRevision,
} from './artcraft-operations.js';
import {
  boundedStudioRead,
  loadStudioSessions,
  saveStudioSession,
  studioDirectory,
  studioFile,
  type StoredArtcraftSession,
} from './artcraft-storage.js';
import type {
  ArtcraftOpen,
  ArtcraftRuntime,
  ArtcraftSession,
  ArtcraftSnapshot,
} from './artcraft-types.js';

export function createArtcraftRuntime(userDataPath: string, editorRoot?: string): ArtcraftRuntime {
  return new DesktopStudio(path.join(userDataPath, 'artcraft-studio'), editorRoot);
}
class DesktopStudio implements ArtcraftRuntime {
  private readonly processes = new Map<string, ArtcraftProcess>();
  private readonly sessions = new Map<string, StoredArtcraftSession>();
  private readonly busy = new Set<string>();
  private readonly ready = new Set<string>();
  private loaded: Promise<void> | undefined;
  constructor(
    private readonly root: string,
    private readonly editorRoot: string | undefined,
  ) {}
  private load(): Promise<void> {
    this.loaded ??= loadStudioSessions(this.root).then((sessions) => {
      for (const session of sessions) this.sessions.set(session.id, session);
    });
    return this.loaded;
  }
  async status() {
    await this.load();
    const [photo, vector] = await Promise.all([
      readArtcraftInstallation(this.editorRoot, 'photo'),
      readArtcraftInstallation(this.editorRoot, 'vector'),
    ]);
    return {
      available: photo !== null || vector !== null,
      editors: {
        photo: { installed: photo !== null, version: ARTCRAFT_VERSIONS.photo },
        vector: { installed: vector !== null, version: ARTCRAFT_VERSIONS.vector },
      },
      sessions: [...this.sessions.values()].map((session) => this.describe(session)),
    };
  }
  async open(input: ArtcraftOpen): Promise<ArtcraftSession> {
    await this.load();
    const id = randomUUID();
    const directory = studioDirectory(this.root, id);
    const session: StoredArtcraftSession = {
      id,
      editor: input.editor,
      title: input.source?.name ?? (input.editor === 'photo' ? 'Photo artwork' : 'Vector artwork'),
      ...(input.widthMm === undefined ? {} : { widthMm: input.widthMm }),
      ...(input.heightMm === undefined ? {} : { heightMm: input.heightMm }),
    };
    // Validate the upload before creating any session or launching an application.
    const source = sourceBytes(input);
    await mkdir(directory, { recursive: true });
    if (source !== null) {
      session.sourceFile = source.filename;
      await writeFile(path.join(directory, source.filename), source.bytes, { flag: 'wx' });
    }
    await saveStudioSession(this.root, session);
    this.sessions.set(id, session);
    return this.resume(id);
  }
  async resume(id: string): Promise<ArtcraftSession> {
    await this.load();
    return this.exclusive(id, async () => {
      const session = this.session(id);
      const current = this.processes.get(id);
      if (current?.running() === true) {
        if (!this.ready.has(id))
          throw new Error(
            'Editor initialization failed. Close its window and reopen this session.',
          );
        await current.request('ui.focus', {});
        return this.describe(session);
      }
      this.ready.delete(id);
      const installation = await readArtcraftInstallation(this.editorRoot, session.editor, true);
      if (installation === null)
        throw new Error('Full editor is not installed or verified. Run the studio setup.');
      const directory = studioDirectory(this.root, id);
      const process = await launchArtcraftProcess(
        installation.executable,
        session.editor,
        directory,
      );
      this.processes.set(id, process);
      const prepared = await prepareRecoveredSession(session, directory);
      await initialiseEditor(process, prepared, directory);
      this.ready.add(id);
      return this.describe(session);
    });
  }
  async snapshot(id: string): Promise<ArtcraftSnapshot> {
    await this.load();
    return this.exclusive(id, async () => {
      const session = this.session(id),
        process = this.processes.get(id);
      if (process?.running() !== true || !this.ready.has(id))
        throw new Error('Reopen this editor before applying artwork.');
      const before = await inspectEditor(process, session.editor);
      assertManagedDocument(before, session.editor, studioDirectory(this.root, id));
      const revision = randomUUID(),
        relative = `revisions/${revision}`;
      const directory = studioDirectory(this.root, id);
      await mkdir(path.join(directory, relative), { recursive: true });
      const files = await saveEditorRevision(process, session.editor, directory, relative);
      const frozenNative =
        relative + '/source.' + (session.editor === 'photo' ? 'pcraft' : 'vectorcraft');
      await copyFile(await studioFile(directory, files.native), path.join(directory, frozenNative));
      const after = await inspectEditor(process, session.editor);
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error('The editor changed during Apply. Finish the edit and apply again.');
      }
      await studioFile(directory, files.native);
      const bytes = await boundedStudioRead(await studioFile(directory, files.output));
      if (bytes.byteLength === 0) throw new Error('The editor exported an empty artwork file.');
      session.nativeFile = frozenNative;
      await saveStudioSession(this.root, session);
      const photo = session.editor === 'photo';
      return {
        id,
        editor: session.editor,
        revision,
        filename: `kerfdesk-studio-${id}.${photo ? 'png' : 'svg'}`,
        mime: photo ? 'image/png' : 'image/svg+xml',
        dataBase64: bytes.toString('base64'),
        nativeSaved: true,
        ...(positive(before.widthMm) ? { widthMm: before.widthMm } : {}),
        ...(positive(before.heightMm) ? { heightMm: before.heightMm } : {}),
      };
    });
  }
  private session(id: string): StoredArtcraftSession {
    const session = this.sessions.get(id);
    if (session === undefined) throw new Error('Unknown studio session.');
    return session;
  }
  private describe(session: StoredArtcraftSession): ArtcraftSession {
    return {
      id: session.id,
      editor: session.editor,
      title: session.title,
      running: this.ready.has(session.id) && (this.processes.get(session.id)?.running() ?? false),
    };
  }
  private async exclusive<T>(id: string, work: () => Promise<T>): Promise<T> {
    if (this.busy.has(id)) throw new Error('An operation is already in progress for this editor.');
    this.busy.add(id);
    try {
      return await work();
    } finally {
      this.busy.delete(id);
    }
  }
}
function positive(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value) && value > 0;
}
function sourceBytes(input: ArtcraftOpen): { filename: string; bytes: Buffer } | null {
  if (input.source === undefined) return null;
  const extensions: Record<string, string> =
    input.editor === 'photo'
      ? { 'image/png': 'png', 'image/jpeg': 'jpg' }
      : { 'image/svg+xml': 'svg' };
  const extension = extensions[input.source.mediaType];
  if (extension === undefined)
    throw new Error('Open SVG in VectorCraft or PNG/JPEG in PhotoCraft.');
  const bytes = Buffer.from(input.source.dataBase64, 'base64');
  if (bytes.length === 0 || bytes.length > 32 * 1024 * 1024)
    throw new Error('Artwork must be between 1 byte and 32 MB.');
  return { filename: `input.${extension}`, bytes };
}
