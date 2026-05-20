/** Minimal Web Serial API typings when @types/w3c-web-serial is not installed */

export {};

declare global {
  interface ElectronAPI {
    saveFile?: (defaultName: string, content: string) => Promise<boolean>;
    saveGcode?: (defaultName: string, content: string) => Promise<boolean>;
    saveBinaryFile?: (defaultName: string, base64Content: string) => Promise<boolean>;
    openFile?: () => Promise<{ fileName: string; content: string; ext: string } | null>;
    isElectron?: boolean;
    // T2-35: native Electron serial bridge declarations removed.
    quit?: () => Promise<unknown>;
    storage?: Record<string, {
      get(key: string): Promise<string | null>;
      set(key: string, value: string): Promise<void>;
      remove(key: string): Promise<void>;
      list(): Promise<string[]>;
    }>;
    // T1-84: storageClear was removed from the IPC.
    acquireJobWakeLock?: () => Promise<number>;
    releaseJobWakeLock?(token?: string): Promise<unknown>;
    acquireJobLifecycleToken?(ticketId: string): Promise<unknown>;
    releaseJobLifecycleToken?(token: string): Promise<unknown>;
    updates?: {
      check(): Promise<unknown>;
      install(state?: { jobRunning?: boolean }): Promise<unknown>;
      onEvent(handler: (event: unknown) => void): () => void;
    };
  }

  interface Window {
    electronAPI?: ElectronAPI;
  }

  interface SerialPortInfo {
    readonly usbVendorId?: number;
    readonly usbProductId?: number;
  }

  interface SerialOutputSignals {
    readonly dataTerminalReady?: boolean;
    readonly requestToSend?: boolean;
    readonly break?: boolean;
  }

  interface SerialPort {
    readonly readable: ReadableStream<Uint8Array> | null;
    readonly writable: WritableStream<Uint8Array> | null;
    open(options: { baudRate: number }): Promise<void>;
    close(): Promise<void>;
    setSignals?(signals: SerialOutputSignals): Promise<void>;
    /** Chrome 103+: revoke the persistent permission grant for this port. */
    forget?(): Promise<void>;
    /** Returns USB descriptor metadata when available. */
    getInfo?(): SerialPortInfo;
  }

  interface SerialConnectionEvent extends Event {
    readonly port: SerialPort;
  }

  interface Navigator {
    readonly serial: {
      requestPort(): Promise<SerialPort>;
      getPorts(): Promise<SerialPort[]>;
      addEventListener(type: 'connect', listener: (event: SerialConnectionEvent) => void): void;
      addEventListener(type: 'disconnect', listener: (event: SerialConnectionEvent) => void): void;
      removeEventListener(type: 'connect', listener: (event: SerialConnectionEvent) => void): void;
      removeEventListener(type: 'disconnect', listener: (event: SerialConnectionEvent) => void): void;
    };
  }
}
