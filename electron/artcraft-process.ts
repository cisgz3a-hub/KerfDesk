import { checkEditorLease, saveEditorLease } from './artcraft-process-lease.js';
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

export async function launchArtcraftProcess(
  executable: string,
  editor: ArtcraftEditor,
  directory: string,
): Promise<ArtcraftProcess> {
  await checkEditorLease(directory);
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
  let launchError: Error | null = null;
  child.on('error', (error) => {
    launchError = error;
  });
  const handle: ArtcraftProcess = {
    child,
    request: (method, params = {}) => artcraftRequest(options, method, params),
    running: () => launchError === null && child.exitCode === null && child.signalCode === null,
  };
  await saveEditorLease(directory, child.pid, executable);
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (launchError !== null) throw launchError;
    if (!handle.running()) throw new Error('The editor exited before it was ready.');
    try {
      await artcraftRequest({ ...options, timeoutMs: 1500 }, 'ui.inspect', {});
      child.unref();
      return handle;
    } catch {
      await delay(200);
    }
  }
  // Do not kill a visible editor: the operator may already have started drawing.
  child.unref();
  throw new Error(
    'The full editor opened but its connection is not ready. Close that editor and retry.',
  );
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
