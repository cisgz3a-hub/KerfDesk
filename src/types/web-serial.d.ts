/** Minimal Web Serial API typings when @types/w3c-web-serial is not installed */

export {};

declare global {
  interface ElectronAPI {
    saveFile?: (defaultName: string, content: string) => Promise<boolean>;
    saveGcode?: (defaultName: string, content: string) => Promise<boolean>;
    openFile?: () => Promise<{ fileName: string; content: string; ext: string } | null>;
    isElectron?: boolean;
    // T2-35: native Electron serial bridge declarations removed.
    quit?: () => Promise<void>;
    storage?: Record<string, {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<void>;
      remove(key: string): Promise<void>;
      list(): Promise<string[]>;
    }>;
    // T1-84: storageClear was removed from the IPC.
    acquireJobWakeLock?: () => Promise<number>;
    releaseJobWakeLock?: () => Promise<void>;
    updates?: {
      check(): Promise<unknown>;
      install(state?: { jobRunning?: boolean }): Promise<unknown>;
      onEvent(handler: (event: unknown) => void): () => void;
    };
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }

  interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
  }

  interface Navigator {
    readonly serial: {
      requestPort(): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
    };
  }
}
