// PlatformAdapter — the narrow interface that lets the UI / IO layers run
// against both web (File System Access API) and Electron (native dialogs +
// fs). Injected at React root per ADR-011. Phase A scope: file-pick (open) +
// file-pick (save). Phase B adds serial-port connection methods.

export type FileHandle = {
  readonly name: string;
  // Lazily read the file's text content. Cheap to call once; some platforms
  // (web File objects) consume the stream so callers shouldn't call twice.
  readonly text: () => Promise<string>;
};

export type SaveTarget = {
  readonly displayName: string;
  readonly write: (text: string) => Promise<void>;
};

export type FileOpenRequest = {
  readonly accept: ReadonlyArray<string>; // e.g. ['.svg'] or ['.lf2']
  readonly multiple: boolean;
};

export type FileSaveRequest = {
  readonly suggestedName: string;
  readonly extensions: ReadonlyArray<string>; // e.g. ['.gcode', '.nc']
};

// --- Serial port (Phase B) ---

export type SerialOpenRequest = {
  readonly baudRate: number;
};

export type SerialConnection = {
  // Write a string (UTF-8) to the port. Resolves when the bytes have been
  // queued to the OS — does not wait for the device to ack.
  readonly write: (data: string) => Promise<void>;
  // Subscribe to line events (incoming data split on '\n', \r stripped).
  // Returns an unsubscribe function.
  readonly onLine: (handler: (line: string) => void) => () => void;
  // Subscribe to the close event (port physically disconnected, OS revoked,
  // or close() called).
  readonly onClose: (handler: () => void) => () => void;
  readonly close: () => Promise<void>;
};

export type SerialPortRef = {
  // Open the port at the requested baud rate. The returned SerialConnection
  // is the active duplex stream until close() is called or the port drops.
  readonly open: (req: SerialOpenRequest) => Promise<SerialConnection>;
};

export type SerialAdapter = {
  // True when the underlying platform exposes a Serial API (Chromium-based
  // browsers / Electron with the right flags). UI gates Phase B features
  // behind this.
  readonly isSupported: () => boolean;
  // Prompt the user to pick a serial port. Resolves to null when cancelled.
  readonly requestPort: () => Promise<SerialPortRef | null>;
};

export type PlatformAdapter = {
  readonly id: 'web' | 'electron' | 'mock';

  // Show a file-open picker. Resolves to the chosen files (may be empty if
  // the user cancels).
  readonly pickFilesForOpen: (req: FileOpenRequest) => Promise<ReadonlyArray<FileHandle>>;

  // Show a file-save picker. Resolves to a SaveTarget the caller writes
  // through, or `null` if the user cancels.
  readonly pickFileForSave: (req: FileSaveRequest) => Promise<SaveTarget | null>;

  // Phase B: serial port access for connecting to the laser controller.
  readonly serial: SerialAdapter;
};
