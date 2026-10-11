import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

type Pending = { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout };
/** Persistent, main-process-only channel to the Win32 host helper. */
export class ArtcraftWindowChannel {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, Pending>();
  private buffer = '';
  private errors = '';
  private closed = false;
  private disposed = false;
  constructor(helperPath: string, parentHandle: string, parentPid: number) {
    const powershell = path.join(
      process.env['SystemRoot'] ?? 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe',
    );
    this.child = spawn(
      powershell,
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath],
      {
        windowsHide: true,
        stdio: 'pipe',
        env: {
          ...process.env,
          KERFDESK_WINDOW_HOST_PID: String(parentPid),
          KERFDESK_WINDOW_HOST_HWND: parentHandle,
        },
      },
    );
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => this.receive(chunk));
    this.child.stderr.on('data', (chunk: string) => {
      this.errors = (this.errors + chunk).slice(-4096);
    });
    this.child.on('error', () => this.fail(new Error('Native window helper could not start')));
    this.child.stdin.on('error', () => this.fail(new Error('Native window helper channel closed')));
    this.child.on('exit', () =>
      this.fail(new Error(`Native window helper exited. ${this.errors}`.trim())),
    );
  }
  request(
    method: string,
    sessionId: string,
    params: Record<string, unknown> = {},
  ): Promise<unknown> {
    if (this.closed) return Promise.reject(new Error('Native window helper is closed'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Native window operation timed out; detach before closing KerfDesk'));
      }, 15_000);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ ...params, id, method, sessionId }) + '\n');
    });
  }
  async dispose(): Promise<void> {
    if (this.disposed) return;
    if (this.closed)
      throw new Error('Native host connection lost; editor detachment is unconfirmed.');
    await this.request('dispose', 'host');
    this.disposed = true;
    this.child.stdin.end();
  }
  private receive(chunk: string): void {
    this.buffer += chunk;
    if (this.buffer.length > 64 * 1024) {
      this.fail(new Error('Native window helper reply exceeded its limit'));
      this.child.stdin.end();
      return;
    }
    let newline: number;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (line) this.reply(line);
    }
  }
  private reply(line: string): void {
    try {
      const response: unknown = JSON.parse(line);
      if (
        !response ||
        typeof response !== 'object' ||
        !('id' in response) ||
        typeof response.id !== 'string'
      )
        throw new Error('Invalid host reply');
      const pending = this.pending.get(response.id);
      if (!pending) return;
      this.pending.delete(response.id);
      clearTimeout(pending.timer);
      if ('ok' in response && response.ok === true)
        pending.resolve('result' in response ? response.result : undefined);
      else
        pending.reject(
          new Error(
            'error' in response ? String(response.error) : 'Native window operation failed',
          ),
        );
    } catch {
      this.fail(new Error('Native window helper returned invalid JSON'));
      this.child.stdin.end();
    }
  }
  private fail(error: Error): void {
    this.closed = true;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
