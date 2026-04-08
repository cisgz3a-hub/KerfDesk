/**
 * Web Serial API controller — works in Electron and Chrome
 * No native modules needed
 */

export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SerialEvents {
  onConnectionChange: (state: ConnectionState) => void;
  onMessage: (msg: string) => void;
  onError: (err: string) => void;
}

export class WebSerialController {
  private port: SerialPort | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private events: SerialEvents;
  private readLoopActive = false;
  private responseResolvers: Array<(line: string) => void> = [];

  constructor(events: SerialEvents) {
    this.events = events;
  }

  /** Check if Web Serial is available */
  static isSupported(): boolean {
    return typeof navigator !== 'undefined' && 'serial' in navigator;
  }

  /** Prompt user to select a serial port */
  async requestPort(): Promise<boolean> {
    try {
      this.port = await navigator.serial.requestPort();
      return true;
    } catch {
      this.events.onError('Port selection cancelled');
      return false;
    }
  }

  /** List already-granted ports */
  async getPorts(): Promise<SerialPort[]> {
    if (!WebSerialController.isSupported()) return [];
    return navigator.serial.getPorts();
  }

  /** Connect to the selected port */
  async connect(baudRate: number = 115200): Promise<boolean> {
    if (!this.port) {
      this.events.onError('No port selected');
      return false;
    }

    this.events.onConnectionChange('connecting');

    try {
      await this.port.open({ baudRate });
      this.writer = this.port.writable?.getWriter() ?? null;
      this.reader = this.port.readable?.getReader() ?? null;

      this.events.onConnectionChange('connected');
      this.events.onMessage('Connected to serial port');

      void this.startReadLoop();
      return true;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      this.events.onError(`Connection failed: ${msg}`);
      this.events.onConnectionChange('error');
      return false;
    }
  }

  /** Disconnect */
  async disconnect(): Promise<void> {
    this.readLoopActive = false;

    try {
      if (this.reader) {
        await this.reader.cancel();
        this.reader.releaseLock();
        this.reader = null;
      }
      if (this.writer) {
        this.writer.releaseLock();
        this.writer = null;
      }
      if (this.port) {
        await this.port.close();
        this.port = null;
      }
    } catch {
      /* Port may already be closed */
    }

    this.events.onConnectionChange('disconnected');
    this.events.onMessage('Disconnected');
  }

  /** Send a G-code line */
  async send(command: string): Promise<void> {
    if (!this.writer) {
      this.events.onError('Not connected');
      return;
    }

    const line = command.trim() + '\n';
    const encoder = new TextEncoder();
    await this.writer.write(encoder.encode(line));
    this.events.onMessage(`> ${command.trim()}`);
  }

  async sendAndWait(command: string, timeoutMs: number = 10000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.responseResolvers.shift();
        reject(new Error(`Timeout waiting for response to: ${command}`));
      }, timeoutMs);

      this.responseResolvers.push((response: string) => {
        clearTimeout(timer);
        resolve(response);
      });

      void this.send(command);
    });
  }

  /** Read loop — continuously reads from serial port */
  private async startReadLoop(): Promise<void> {
    if (!this.reader) return;
    this.readLoopActive = true;

    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (this.readLoopActive) {
        const { value, done } = await this.reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed) {
            this.events.onMessage(trimmed);

            // Resolve waiting command if ok or error
            if (trimmed === 'ok' || trimmed.startsWith('error:')) {
              const resolver = this.responseResolvers.shift();
              if (resolver) resolver(trimmed);
            }
          }
        }
      }
    } catch (e: unknown) {
      if (this.readLoopActive) {
        const msg = e instanceof Error ? e.message : String(e);
        this.events.onError(`Read error: ${msg}`);
      }
    }
  }
}
