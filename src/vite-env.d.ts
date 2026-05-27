/// <reference types="vite/client" />

declare module '*.svg?raw' {
  const content: string;
  export default content;
}

// File System Access API — not yet in lib.dom.d.ts (as of TypeScript 5.9).
// PROJECT.md "Delivery targets" requires Chromium, where these are stable.
// Minimal declarations covering only what webAdapter uses.
type FilePickerAcceptType = {
  description?: string;
  accept: Record<string, string[]>;
};

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | BufferSource | Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandle {
  readonly kind: 'file';
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<FileSystemWritableFileStream>;
}

interface OpenFilePickerOptions {
  multiple?: boolean;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  excludeAcceptAllOption?: boolean;
  types?: FilePickerAcceptType[];
}

interface Window {
  showOpenFilePicker(options?: OpenFilePickerOptions): Promise<FileSystemFileHandle[]>;
  showSaveFilePicker(options?: SaveFilePickerOptions): Promise<FileSystemFileHandle>;
}

// Web Serial API — not in lib.dom.d.ts as of TypeScript 5.9. Minimal
// declarations covering what platform/web/web-serial.ts uses.
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
  dataBits?: 7 | 8;
  stopBits?: 1 | 2;
  parity?: 'none' | 'even' | 'odd';
  bufferSize?: number;
  flowControl?: 'none' | 'hardware';
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
  addEventListener(type: 'disconnect', listener: (this: SerialPort, ev: Event) => unknown): void;
  removeEventListener(type: 'disconnect', listener: (this: SerialPort, ev: Event) => unknown): void;
}

interface SerialPortRequestOptions {
  filters?: ReadonlyArray<{ usbVendorId?: number; usbProductId?: number }>;
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial: Serial;
}
