import { readArtcraftDocument } from './artcraft-document.js';
import { readEditorProcessIdentity } from './artcraft-process-identity.js';
import { checkEditorLease } from './artcraft-process-lease.js';
import type { ArtcraftWindowHost } from './artcraft-window-host.js';
import { prepareRecoveredSession } from './artcraft-recovery.js';
import { createHash, randomUUID } from 'node:crypto';
import { copyFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ARTCRAFT_VERSIONS, readArtcraftInstallation } from './artcraft-installation.js';
import { launchArtcraftProcess, type ArtcraftProcess } from './artcraft-process.js';
import {
  assertManagedDocument,
  initialiseEditor,
  inspectEditor,
  saveEditorRevision,
  workingFile,
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
  ArtcraftDocument,
  ArtcraftRect,
  ArtcraftOpen,
  ArtcraftRuntime,
  ArtcraftSession,
  ArtcraftSnapshot,
} from './artcraft-types.js';

export function createArtcraftRuntime(
  userDataPath: string,
  editorRoot?: string,
  hostProvider?: () => ArtcraftWindowHost,
): ArtcraftRuntime {
  return new DesktopStudio(path.join(userDataPath, 'artcraft-studio'), editorRoot, hostProvider);
}
class DesktopStudio implements ArtcraftRuntime {
  private readonly processes = new Map<string, ArtcraftProcess>();
  private readonly sessions = new Map<string, StoredArtcraftSession>();
  private readonly busy = new Set<string>();
  private readonly ready = new Set<string>();
  private readonly captured = new Map<string, { identity: string; document: ArtcraftDocument }>();
  private readonly restoring = new Map<string, Promise<ArtcraftSession>>();
  private loaded: Promise<void> | undefined;
  constructor(
    private readonly root: string,
    private readonly editorRoot: string | undefined,
    private readonly hostProvider: (() => ArtcraftWindowHost) | undefined,
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
      documentId: id,
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
      this.captured.delete(id);
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
      const documentId = session.documentId ?? id;
      const photo = session.editor === 'photo';
      const nativeDocument = this.nativeDocument(
        session,
        await boundedStudioRead(await studioFile(directory, frozenNative)),
      );
      this.captured.set(id, {
        identity: JSON.stringify([before.active, before.revision, before.documentPath]),
        document: nativeDocument,
      });
      return {
        id,
        documentId,
        editor: session.editor,
        revision,
        filename: `kerfdesk-studio-${documentId}.${photo ? 'png' : 'svg'}`,
        mime: photo ? 'image/png' : 'image/svg+xml',
        dataBase64: bytes.toString('base64'),
        nativeSaved: true,
        nativeDocument,
        ...(positive(before.widthMm) ? { widthMm: before.widthMm } : {}),
        ...(positive(before.heightMm) ? { heightMm: before.heightMm } : {}),
      };
    });
  }
  async restore(value: unknown): Promise<ArtcraftSession> {
    const { document, bytes } = readArtcraftDocument(value);
    await this.load();
    const key = `${document.id}:${document.editor}:${document.nativeSha256}`;
    const pending = this.restoring.get(key);
    if (pending !== undefined) return pending;
    const restore = this.restoreDocument(document, bytes);
    this.restoring.set(key, restore);
    try {
      return await restore;
    } finally {
      this.restoring.delete(key);
    }
  }
  private async restoreDocument(
    document: ArtcraftDocument,
    bytes: Buffer,
  ): Promise<ArtcraftSession> {
    const existing = await this.restoreMatchingSession(document);
    if (existing !== undefined) return existing;
    const id = randomUUID();
    const directory = studioDirectory(this.root, id);
    const nativeFile = workingFile(document.editor);
    const session: StoredArtcraftSession = {
      id,
      documentId: document.id,
      editor: document.editor,
      title: document.title,
      nativeFile,
    };
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, nativeFile), bytes, { flag: 'wx' });
    await saveStudioSession(this.root, session);
    this.sessions.set(id, session);
    return this.resume(id);
  }
  private async restoreMatchingSession(
    document: ArtcraftDocument,
  ): Promise<ArtcraftSession | undefined> {
    for (const session of this.sessions.values()) {
      if ((session.documentId ?? session.id) !== document.id || session.editor !== document.editor)
        continue;
      try {
        if (this.processes.get(session.id)?.running() === true) {
          // Capture live edits first: a previously matching revision must not reuse changed work.
          if ((await this.capture(session.id)).nativeSha256 === document.nativeSha256)
            return await this.resume(session.id);
          continue;
        }
        const directory = studioDirectory(this.root, session.id);
        // A disconnected editor may still own this directory. Candidate inspection must not
        // restore working files or bypass the launcher's independent lease check.
        await checkEditorLease(directory);
        const file = await studioFile(directory, workingFile(session.editor)).catch(
          (error: unknown) => {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            return session.nativeFile === undefined
              ? undefined
              : studioFile(directory, session.nativeFile);
          },
        );
        if (file === undefined) continue;
        const bytes = await boundedStudioRead(file);
        if (createHash('sha256').update(bytes).digest('hex') === document.nativeSha256)
          return await this.resume(session.id);
      } catch {
        // An unusable cached session cannot prevent restoring validated embedded bytes.
        // Preserve it for recovery and try another candidate, then a fresh directory.
      }
    }
    return undefined;
  }
  async capture(id: string): Promise<ArtcraftDocument> {
    await this.load();
    return this.exclusive(id, async () => {
      const session = this.session(id);
      const process = this.processes.get(id);
      if (process?.running() !== true || !this.ready.has(id))
        throw new Error('Reopen the editor before saving its current document.');
      const directory = studioDirectory(this.root, id);
      const before = await inspectEditor(process, session.editor, true);
      assertManagedDocument(before, session.editor, directory);
      const identity = JSON.stringify([before.active, before.revision, before.documentPath]);
      const cached = this.captured.get(id);
      if (cached?.identity === identity) return cached.document;
      await process.request('app.save', {});
      const bytes = await boundedStudioRead(
        await studioFile(directory, workingFile(session.editor)),
      );
      const after = await inspectEditor(process, session.editor, true);
      if (JSON.stringify(before) !== JSON.stringify(after))
        throw new Error('The editor changed during Save. Finish editing and save again.');
      if (bytes.length === 0) throw new Error('The editor saved an empty document.');
      const document = this.nativeDocument(session, bytes);
      this.captured.set(id, { identity, document });
      return document;
    });
  }
  private nativeDocument(session: StoredArtcraftSession, bytes: Buffer): ArtcraftDocument {
    const hash = createHash('sha256').update(bytes).digest('hex');
    return {
      id: session.documentId ?? session.id,
      editor: session.editor,
      title: session.title,
      editorVersion: ARTCRAFT_VERSIONS[session.editor],
      nativeFormat: session.editor === 'photo' ? 'pcraft' : 'vectorcraft',
      nativeBase64: bytes.toString('base64'),
      nativeSha256: hash,
      revision: hash,
    };
  }
  async host(id: string, rect: ArtcraftRect): Promise<unknown> {
    const session = this.session(id);
    const process = this.processes.get(id);
    if (process?.running() !== true || !this.ready.has(id) || process.child.pid === undefined)
      throw new Error('Reopen this editor before showing it.');
    if (this.hostProvider === undefined) throw new Error('Window hosting is unavailable.');
    const identity = await readEditorProcessIdentity(process.child.pid);
    if (identity === null) throw new Error('Editor process has exited.');
    const installation = await readArtcraftInstallation(this.editorRoot, session.editor);
    if (
      installation === null ||
      path.resolve(identity.executable).toLowerCase() !==
        path.resolve(installation.executable).toLowerCase()
    )
      throw new Error('Editor process identity changed.');
    return this.hostProvider().attach(id, identity, rect);
  }
  async hide(id: string): Promise<void> {
    this.session(id);
    await this.hostProvider?.().hide(id);
  }
  private session(id: string): StoredArtcraftSession {
    const session = this.sessions.get(id);
    if (session === undefined) throw new Error('Unknown studio session.');
    return session;
  }
  private describe(session: StoredArtcraftSession): ArtcraftSession {
    return {
      id: session.id,
      documentId: session.documentId ?? session.id,
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
