import { fileURLToPath } from 'node:url';
import { ArtcraftWindowChannel } from './artcraft-window-channel.js';
import {
  validEditorProcessIdentity,
  type EditorProcessIdentity,
} from './artcraft-process-identity.js';

export type ArtcraftWindowRect = {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The renderer's window.innerWidth/innerHeight, in the same CSS coordinate space. */
  viewportWidth: number;
  viewportHeight: number;
};
export type ArtcraftWindowState = {
  window: string;
  parent: string;
  pid: number;
  x: number;
  y: number;
  width: number;
  height: number;
  parentWidth: number;
  parentHeight: number;
  dpi: number;
  visible: boolean;
};
export interface ArtcraftWindowHost {
  attach(
    sessionId: string,
    identity: EditorProcessIdentity,
    rect: ArtcraftWindowRect,
  ): Promise<ArtcraftWindowState>;
  layout(sessionId: string, rect: ArtcraftWindowRect): Promise<ArtcraftWindowState>;
  hide(sessionId: string): Promise<void>;
  focus(sessionId: string): Promise<void>;
  detach(sessionId: string): Promise<void>;
  dispose(): Promise<void>;
}
export function nativeHandleString(handle: Buffer): string {
  if (handle.length === 8) return handle.readBigUInt64LE().toString();
  if (handle.length === 4) return String(handle.readUInt32LE());
  throw new Error('Unsupported native window handle');
}
export function validateArtcraftWindowRect(rect: ArtcraftWindowRect): void {
  const values = [rect.x, rect.y, rect.width, rect.height, rect.viewportWidth, rect.viewportHeight];
  if (values.some((value) => !Number.isFinite(value) || value < 0 || value > 100_000))
    throw new Error('Invalid editor viewport bounds');
  if (rect.width <= 0 || rect.height <= 0 || rect.viewportWidth <= 0 || rect.viewportHeight <= 0)
    throw new Error('Editor viewport is empty');
  if (
    rect.x + rect.width > rect.viewportWidth + 1 ||
    rect.y + rect.height > rect.viewportHeight + 1
  )
    throw new Error('Editor viewport is outside KerfDesk');
}
function sessionKey(id: string): void {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error('Invalid hosted editor session');
}
/** Construct only in Electron main, using BrowserWindow.getNativeWindowHandle(). */
export function createArtcraftWindowHost(
  parentHandle: Buffer,
  helperPath = fileURLToPath(new URL('../scripts/artcraft-window-host.ps1', import.meta.url)),
): ArtcraftWindowHost {
  if (process.platform !== 'win32') throw new Error('Embedded desktop editors require Windows');
  const parent = nativeHandleString(parentHandle);
  const createChannel = (): ArtcraftWindowChannel =>
    new ArtcraftWindowChannel(helperPath, parent, process.pid);
  return new NativeEditorHost(createChannel(), createChannel);
}
class NativeEditorHost implements ArtcraftWindowHost {
  constructor(
    private readonly channel: ArtcraftWindowChannel,
    private readonly createChannel: () => ArtcraftWindowChannel,
  ) {}
  async attach(
    id: string,
    identity: EditorProcessIdentity,
    rect: ArtcraftWindowRect,
  ): Promise<ArtcraftWindowState> {
    sessionKey(id);
    validateArtcraftWindowRect(rect);
    if (!validEditorProcessIdentity(identity)) throw new Error('Invalid editor process identity');
    await this.channel.request('attach', id, identity);
    return this.layout(id, rect);
  }
  async layout(id: string, rect: ArtcraftWindowRect): Promise<ArtcraftWindowState> {
    sessionKey(id);
    validateArtcraftWindowRect(rect);
    return (await this.channel.request('layout', id, { rect })) as ArtcraftWindowState;
  }
  async hide(id: string): Promise<void> {
    sessionKey(id);
    await this.channel.request('hide', id);
  }
  async focus(id: string): Promise<void> {
    sessionKey(id);
    await this.channel.request('focus', id);
  }
  async detach(id: string): Promise<void> {
    sessionKey(id);
    await this.channel.request('detach', id);
  }
  async dispose(): Promise<void> {
    try {
      await this.channel.dispose();
    } catch (error) {
      // A lost pipe is insufficient: the original helper must have stopped so
      // an in-flight attach cannot race the fresh ownership verification.
      if (!this.channel.hasExited) throw error;
      const verifier = this.createChannel();
      try {
        await verifier.request('verifyDetached', 'host');
      } finally {
        verifier.stopReadOnlyProbe();
      }
    }
  }
}
