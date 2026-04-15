import { type SerialPortLike } from './SerialPort';

export class WebSocketSerialPort implements SerialPortLike {
  private socket: WebSocket | null = null;
  private open = false;
  private lineBuffer = '';
  private dataCallback: ((line: string) => void) | null = null;
  private errorCallback: ((error: Error) => void) | null = null;
  private closeCallback: (() => void) | null = null;

  get isOpen(): boolean {
    return this.open;
  }

  async connect(url: string): Promise<void> {
    if (this.socket) this.close();

    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.addEventListener('open', () => {
        this.socket = ws;
        this.open = true;
        resolve();
      }, { once: true });
      ws.addEventListener('error', () => {
        const err = new Error(`Failed to connect to ${url}`);
        this.errorCallback?.(err);
        reject(err);
      }, { once: true });
      ws.addEventListener('message', (evt) => {
        this.handleMessage(evt.data);
      });
      ws.addEventListener('close', () => {
        const wasOpen = this.open;
        this.open = false;
        this.socket = null;
        if (wasOpen) this.closeCallback?.();
      });
    });
  }

  write(data: string): void {
    if (!this.socket || !this.open) throw new Error('Port is not open');
    this.socket.send(data);
  }

  writeByte(byte: number): void {
    if (!this.socket || !this.open) throw new Error('Port is not open');
    // Bridges (e.g. wainlux-bridge.mjs) decode realtime GRBL bytes from this prefix.
    this.socket.send(`__BYTE__:${byte}`);
  }

  onData(callback: (line: string) => void): void {
    this.dataCallback = callback;
  }

  onError(callback: (error: Error) => void): void {
    this.errorCallback = callback;
  }

  onClose(callback: () => void): void {
    this.closeCallback = callback;
  }

  close(): void {
    const ws = this.socket;
    this.socket = null;
    this.open = false;
    this.lineBuffer = '';
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    this.closeCallback?.();
  }

  private handleMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    this.lineBuffer += data;
    const parts = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (line) this.dataCallback?.(line);
    }
  }
}
