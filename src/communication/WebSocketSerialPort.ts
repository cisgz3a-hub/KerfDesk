import { type SerialPortLike } from './SerialPort';

export class WebSocketSerialPort implements SerialPortLike {
  private socket: WebSocket | null = null;
  private open = false;
  private lineBuffer = '';
  /** Complete lines received before onData() is registered (e.g. GRBL welcome on connect). */
  private _pendingMessages: string[] = [];
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
        ws.binaryType = 'arraybuffer';
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
        const msg = this.normalizeWsPayload(evt.data);
        if (msg === null) return;
        this.handleMessage(msg);
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
    for (const line of this._pendingMessages) {
      callback(line);
    }
    this._pendingMessages = [];
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
    this._pendingMessages = [];
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }
    this.closeCallback?.();
  }

  private normalizeWsPayload(data: unknown): string | null {
    if (typeof data === 'string') return data;
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      return new TextDecoder().decode(
        view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
      );
    }
    return null;
  }

  private deliverLine(line: string): void {
    if (!line) return;
    if (this.dataCallback) {
      this.dataCallback(line);
    } else {
      this._pendingMessages.push(line);
    }
  }

  /**
   * One WebSocket text frame often carries a single GRBL line without a trailing \\n (e.g. Wainlux bridge).
   * Frames that include \\r or \\n use buffered multi-line reassembly.
   */
  private handleMessage(text: string): void {
    if (!text.includes('\r') && !text.includes('\n')) {
      const line = text.trim();
      if (line) this.deliverLine(line);
      return;
    }

    this.lineBuffer += text;
    const parts = this.lineBuffer.split(/\r?\n/);
    this.lineBuffer = parts.pop() ?? '';
    for (const part of parts) {
      const line = part.trim();
      if (line) this.deliverLine(line);
    }
  }
}
