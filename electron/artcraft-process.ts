import { checkEditorLease, saveEditorLease } from './artcraft-process-lease.js';
import { ArtcraftSessionUnavailableError } from './artcraft-session-unavailable.js';
import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { artcraftRequest } from './artcraft-client.js';
import type { ArtcraftEditor } from './artcraft-types.js';

export type ArtcraftProcess = {
  child: ChildProcess;
  request(method: string, params?: Record<string, unknown>): Promise<unknown>;
  running(): boolean;
};

// Also retain ownership when a disk/identity failure prevents a durable lease.
// Never launch another editor against the same working file while this child lives.
const ownedDirectories = new Map<string, ChildProcess | null>();

export async function launchArtcraftProcess(
  executable: string,
  editor: ArtcraftEditor,
  directory: string,
): Promise<ArtcraftProcess> {
  const key =
    process.platform === 'win32' ? path.resolve(directory).toLowerCase() : path.resolve(directory);
  if (ownedDirectories.has(key)) {
    throw new ArtcraftSessionUnavailableError(
      'The previous editor for this session is still running. Close its window before retrying.',
    );
  }
  ownedDirectories.set(key, null);
  try {
    return await launchOwnedProcess(executable, editor, directory, key);
  } catch (error) {
    if (ownedDirectories.get(key) === null) ownedDirectories.delete(key);
    throw error;
  }
}

async function launchOwnedProcess(
  executable: string,
  editor: ArtcraftEditor,
  directory: string,
  key: string,
): Promise<ArtcraftProcess> {
  await checkSessionLease(directory);
  const port = await reservePort();
  const token = editor === 'photo' ? randomBytes(32).toString('hex') : undefined;
  const options = token === undefined ? { port } : { port, token };
  const args = [
    '--control',
    String(port),
    '--automation-read-root',
    directory,
    '--automation-write-root',
    directory,
  ];
  const env = editorEnvironment();
  const settings = path.join(directory, 'settings');
  await mkdir(settings, { recursive: true });
  env['APPDATA'] = settings;
  env['LOCALAPPDATA'] = settings;
  env['PHOTOCRAFT_CONFIG_DIR'] = path.join(settings, 'photocraft');
  if (token !== undefined) env['PHOTOCRAFT_CONTROL_TOKEN'] = token;
  // Keep native settings and recovery data scoped to this managed session.
  const child = spawn(executable, args, {
    cwd: directory,
    env,
    windowsHide: true,
    stdio: 'ignore',
  });
  ownedDirectories.set(key, child);
  const release = () => {
    if (ownedDirectories.get(key) === child) ownedDirectories.delete(key);
  };
  child.once('exit', release);
  let launchError: Error | null = null;
  child.on('error', (error) => {
    launchError = error;
    if (child.pid === undefined) release();
  });
  // Every post-spawn failure leaves the visible editor independent of KerfDesk.
  // The handshake's sockets/timers keep its awaited work alive while connecting.
  child.unref();
  const handle: ArtcraftProcess = {
    child,
    request: (method, params = {}) => artcraftRequest(options, method, params),
    running: () => launchError === null && child.exitCode === null && child.signalCode === null,
  };
  try {
    await saveEditorLease(directory, child.pid, executable);
  } catch (error) {
    if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) release();
    throw new Error(
      'Could not record the editor process. Close its native window before retrying or restarting KerfDesk.',
      { cause: error },
    );
  }
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (launchError !== null) throw launchError;
    if (!handle.running()) throw new Error('The editor exited before it was ready.');
    try {
      await artcraftRequest({ ...options, timeoutMs: 1500 }, 'ui.inspect', {});
      return handle;
    } catch {
      await delay(200);
    }
  }
  // Do not kill a visible editor: the operator may already have started drawing.
  throw new Error(
    'The full editor opened but its connection is not ready. Close that editor and retry.',
  );
}

async function checkSessionLease(directory: string): Promise<void> {
  try {
    await checkEditorLease(directory);
  } catch (error) {
    throw new ArtcraftSessionUnavailableError(
      error instanceof Error ? error.message : 'Cannot verify the previous editor process.',
      { cause: error },
    );
  }
}

function editorEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of [
    'SystemRoot',
    'WINDIR',
    'PATH',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TEMP',
    'TMP',
    'COMSPEC',
    'HOMEDRIVE',
    'HOMEPATH',
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return env;
}
function reservePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        server.close();
        reject(new Error('Could not allocate editor port'));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}
