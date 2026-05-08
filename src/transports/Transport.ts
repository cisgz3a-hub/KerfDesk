/**
 * T3-45: protocol-neutral transport contracts.
 *
 * Controllers should depend on line, byte, or job-upload capabilities instead
 * of forcing every connection type to pretend it is a serial port.
 */

export type Unsubscribe = () => void;

export type TransportKind =
  | 'web-serial'
  | 'mock-serial'
  | 'electron-serial'
  | 'tcp'
  | 'http'
  | 'websocket'
  | 'usb-binary'
  | 'file-export';

export interface TransportCapabilities {
  readonly line: boolean;
  readonly byte: boolean;
  readonly httpJob: boolean;
  readonly realtimeByte: boolean;
  readonly criticalWrites: boolean;
  readonly userGestureOpenRequired?: boolean;
}

export interface TransportOpenOptions {
  readonly baudRate?: number;
  readonly signal?: AbortSignal;
  readonly endpoint?: string;
}

export interface Transport {
  readonly kind: TransportKind;
  readonly capabilities: TransportCapabilities;
  readonly isOpen: boolean;

  open(options?: TransportOpenOptions): Promise<void>;
  close(): Promise<void>;
  onError(callback: (error: Error) => void): Unsubscribe;
  onClose(callback: () => void): Unsubscribe;
}

export interface LineTransport extends Transport {
  writeLine(line: string): Promise<void>;
  writeCriticalLine(line: string): Promise<void>;
  writeRealtimeByte(byte: number): void;
  writeCriticalRealtimeByte(byte: number): Promise<void>;
  onLine(callback: (line: string) => void): Unsubscribe;
}

export interface ByteTransport extends Transport {
  writeBytes(bytes: Uint8Array): Promise<void>;
  onBytes(callback: (bytes: Uint8Array) => void): Unsubscribe;
}

export interface TransportJobMetadata {
  readonly name?: string;
  readonly sizeBytes?: number;
  readonly contentType?: string;
  readonly outputHash?: string;
}

export interface TransportJobHandle {
  readonly id: string;
  readonly startedAt?: number;
}

export interface HttpJobTransport extends Transport {
  uploadJob(job: Blob | Uint8Array, metadata: TransportJobMetadata): Promise<TransportJobHandle>;
  startJob(handle: TransportJobHandle): Promise<void>;
  stopJob(handle: TransportJobHandle, reason?: string): Promise<void>;
  getJobProgress?(handle: TransportJobHandle): Promise<number>;
}

export const LINE_TRANSPORT_CAPABILITIES: TransportCapabilities = {
  line: true,
  byte: false,
  httpJob: false,
  realtimeByte: true,
  criticalWrites: true,
};

export function isLineTransport(value: unknown): value is LineTransport {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<LineTransport>;
  return (
    typeof candidate.open === 'function'
    && typeof candidate.close === 'function'
    && typeof candidate.writeLine === 'function'
    && typeof candidate.writeCriticalLine === 'function'
    && typeof candidate.writeRealtimeByte === 'function'
    && typeof candidate.writeCriticalRealtimeByte === 'function'
    && typeof candidate.onLine === 'function'
    && candidate.capabilities?.line === true
  );
}

export function isByteTransport(value: unknown): value is ByteTransport {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<ByteTransport>;
  return (
    typeof candidate.open === 'function'
    && typeof candidate.close === 'function'
    && typeof candidate.writeBytes === 'function'
    && typeof candidate.onBytes === 'function'
    && candidate.capabilities?.byte === true
  );
}

export function isHttpJobTransport(value: unknown): value is HttpJobTransport {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<HttpJobTransport>;
  return (
    typeof candidate.open === 'function'
    && typeof candidate.close === 'function'
    && typeof candidate.uploadJob === 'function'
    && typeof candidate.startJob === 'function'
    && typeof candidate.stopJob === 'function'
    && candidate.capabilities?.httpJob === true
  );
}
