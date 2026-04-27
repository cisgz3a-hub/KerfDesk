/** Minimal Web Serial API typings when @types/w3c-web-serial is not installed */

export {};

declare global {
  interface ElectronAPI {
    saveFile?: (defaultName: string, content: string) => Promise<boolean>;
    saveGcode?: (defaultName: string, content: string) => Promise<boolean>;
    openFile?: () => Promise<{ filePath: string; content: string; ext: string } | null>;
    isElectron?: boolean;
    listPorts?: () => Promise<{ path: string; manufacturer?: string }[]>;
    connectPort?: (portPath: string, baudRate: number) => Promise<boolean>;
    disconnectPort?: () => Promise<void>;
    sendGcode?: (cmd: string) => Promise<void>;
    quit?: () => Promise<void>;
    storageGet?: (key: string) => Promise<string | null>;
    storageSet?: (key: string, value: string) => Promise<void>;
    storageRemove?: (key: string) => Promise<void>;
    storageList?: (prefix?: string) => Promise<string[]>;
    // T1-84: storageClear was removed from the IPC.
    acquireJobWakeLock?: () => Promise<number>;
    releaseJobWakeLock?: () => Promise<void>;
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
