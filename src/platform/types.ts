// PlatformAdapter — the narrow interface that lets the UI / IO layers run
// against both web (File System Access API) and Electron (native dialogs +
// fs). Injected at React root per ADR-011. Phase A scope: file-pick (open) +
// file-pick (save). Phase B adds serial-port connection methods.

export type FileHandle = {
  readonly name: string;
  // Byte size when the adapter can supply it cheaply (web File.size, Electron
  // fs.stat). Lets callers gate an oversize-import confirm BEFORE reading the
  // whole file into memory. Optional: adapters/mocks that don't set it fall
  // back to gating on the loaded length.
  readonly size?: number;
  // Lazily read the file's text content. Cheap to call once; some platforms
  // (web File objects) consume the stream so callers shouldn't call twice.
  readonly text: () => Promise<string>;
  // Lazily read the original binary payload. Image workflows use this instead
  // of hidden DOM file inputs so all picker access stays behind PlatformAdapter.
  readonly blob?: () => Promise<Blob>;
};

export type SaveTarget = {
  readonly displayName: string;
  readonly write: (data: string | Blob) => Promise<void>;
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
  // Explicit permission revocation. Normal Disconnect must retain the pairing.
  readonly forget?: () => Promise<void>;
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

// --- Camera (Camera Mode, ADR-107) ---

export type CameraDevice = {
  readonly deviceId: string;
  // May be empty until the user has granted camera access once — browsers
  // hide device labels before the first permission grant.
  readonly label: string;
};

export type CameraStream = {
  // The live MediaStream to attach to a <video> element for the overlay.
  readonly stream: MediaStream;
  // Actual track identity/settings after getUserMedia resolves. Calibration
  // binds to these values, not merely to the pre-permission picker choice.
  readonly sourceId: string;
  readonly resizeMode: 'none' | 'crop-and-scale' | 'unknown';
  // Stop every track and release the camera.
  readonly stop: () => void;
};

// A machine-integrated HTTP camera (e.g. the Creality Falcon A1 Pro) reached
// over the laser's RNDIS-over-USB link. It is NOT a UVC webcam — the OS never
// lists it — so it is polled as still JPEG frames from `frameUrl` rather than
// streamed. Display-only: an <img> shows it cross-origin over http, but pixel
// readback and https pages are blocked (mixed content) without a proxy.
export type NetworkCamera = {
  // HTTP URL returning one JPEG per GET (poll with a cache-buster to refresh).
  readonly frameUrl: string;
};

export type CameraAdapter = {
  // True when the platform exposes getUserMedia (Chromium browsers / the
  // Electron renderer) over an https / secure context. UI gates Camera Mode
  // behind this.
  readonly isSupported: () => boolean;
  // Enumerate available video input devices. Resolves to [] when unsupported
  // or denied; labels may be empty before the first permission grant.
  readonly listCameras: () => Promise<ReadonlyArray<CameraDevice>>;
  // Open a live stream for `deviceId` (or the default camera). Resolves to
  // null when the user denies permission; other errors propagate.
  readonly openStream: (deviceId?: string) => Promise<CameraStream | null>;
  // Probe the local RNDIS link for a machine-integrated HTTP camera (Falcon
  // A1 Pro). Resolves to its frame URL, or null if none is reachable.
  readonly discoverNetworkCamera: () => Promise<NetworkCamera | null>;
};

export type CameraBridgeProbeRequest = {
  readonly url: string;
};

export type CameraBridgeProbeResult =
  | {
      readonly kind: 'ok';
      readonly url: string;
      readonly codec?: string;
      readonly ffmpegAvailable: boolean;
      readonly previewUrl?: string;
    }
  | { readonly kind: 'invalid'; readonly reason: string }
  | { readonly kind: 'unavailable'; readonly reason: string };

// Machine-camera discovery through the bridge's /discover route (ADR-116).
// Browser-side probes are CSP-blocked in the desktop app and on the deployed
// site, so the bridge probes the candidate hosts server-side.
export type MachineCameraDiscovery =
  | { readonly kind: 'found'; readonly cameraUrl: string; readonly proxyFrameUrl: string }
  | { readonly kind: 'not-found' }
  // Bridge missing or unreachable; `reason` tells the user how to start it.
  | { readonly kind: 'unavailable'; readonly reason: string };

// Bridge liveness + capabilities, surfaced in the camera diagnostics row.
export type CameraBridgeHealth =
  | { readonly kind: 'ok'; readonly ffmpegAvailable: boolean; readonly frameProxy: boolean }
  | { readonly kind: 'unavailable'; readonly reason: string };

export type CameraBridgeAdapter = {
  readonly isSupported: () => boolean;
  readonly probeRtspCamera: (req: CameraBridgeProbeRequest) => Promise<CameraBridgeProbeResult>;
  // Probe the machine's snapshot camera server-side via the bridge (ADR-116).
  readonly discoverMachineCamera: () => Promise<MachineCameraDiscovery>;
  // Bridge frame-proxy URL for a camera URL. Responses carry CORS for this
  // app origin, so frames fetched through it are pixel-readable.
  readonly proxiedFrameUrl: (cameraUrl: string) => string;
  readonly health: () => Promise<CameraBridgeHealth>;
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

  // Camera Mode (ADR-107): overhead-camera capture. Optional — present on
  // platforms that expose getUserMedia; UI hides Camera Mode when absent.
  readonly camera?: CameraAdapter;

  // Optional local camera bridge for RTSP/network cameras. Web-only runs can
  // report unavailable; Electron starts the bridge in the main process.
  readonly cameraBridge?: CameraBridgeAdapter;
};
