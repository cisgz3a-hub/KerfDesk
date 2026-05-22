/**
 * Product-level connection failure guidance.
 *
 * Low-level Web Serial and controller code must preserve original error
 * messages for diagnostics. The UI also needs a stable explanation that tells
 * operators what to do next without suggesting unsafe privilege workarounds.
 */

export type ConnectionFailureKind =
  | 'permission-denied'
  | 'no-device-selected'
  | 'port-busy'
  | 'unsupported-browser'
  | 'handshake-failed'
  | 'network-target'
  | 'unknown';

export interface ConnectionFailureGuidance {
  readonly kind: ConnectionFailureKind;
  readonly title: string;
  readonly message: string;
  readonly actions: readonly string[];
  readonly rawMessage: string;
}

export function classifyConnectionFailure(error: unknown): ConnectionFailureGuidance {
  const rawMessage = messageFromUnknown(error);
  const text = rawMessage.toLowerCase();

  if (/web serial.*not supported|serial.*not supported/.test(text)) {
    return {
      kind: 'unsupported-browser',
      title: 'USB laser connection is not available here',
      message: 'This browser or runtime does not expose Web Serial for direct USB control.',
      actions: [
        'Use Chrome, Edge, Opera, or the packaged LaserForge app for USB laser control.',
        'Use simulator mode if you only want to inspect the workflow on this device.',
      ],
      rawMessage,
    };
  }

  if (/notfounderror|no port selected|no device selected|user cancell?ed|no serial port/.test(text)) {
    return {
      kind: 'no-device-selected',
      title: 'No USB laser selected',
      message: 'LaserForge did not receive a serial port from the browser picker.',
      actions: [
        'Power on the laser and reconnect the USB cable.',
        'Click USB laser again and choose the laser port in the browser permission popup.',
      ],
      rawMessage,
    };
  }

  if (/notallowederror|permission denied|access denied|denied by user|permission/.test(text)) {
    return {
      kind: 'permission-denied',
      title: 'USB permission was denied',
      message: 'The browser or operating system refused access to the laser serial port.',
      actions: [
        'Allow the browser USB serial permission popup for the laser port.',
        'Close other laser or CNC software that may already hold the USB port.',
        'If the operating system keeps denying access, use the normal OS device-permission setup for your machine instead of running LaserForge as administrator/root.',
      ],
      rawMessage,
    };
  }

  if (/port busy|already open|in use|could not open|failed to acquire (writer|reader)|lock|networkerror/.test(text)) {
    return {
      kind: 'port-busy',
      title: 'USB serial port is busy',
      message: 'The laser port appears to be open or locked by another process.',
      actions: [
        'Close LightBurn, LaserGRBL, OpenBuilds CONTROL, browser tabs, or serial monitors using the same port.',
        'Unplug and reconnect the USB cable, then retry.',
      ],
      rawMessage,
    };
  }

  if (/handshake|welcome|bare ok|firmware|baud|timed? out|timeout|not.*grbl|wrong.*device/.test(text)) {
    return {
      kind: 'handshake-failed',
      title: 'Laser did not complete the GRBL handshake',
      message: 'The serial port opened, but the controller did not identify itself as the expected GRBL device.',
      actions: [
        'Check that the selected port belongs to the laser controller.',
        'Check the baud rate and firmware profile.',
        'Power-cycle the controller if it is stuck in boot, alarm, or firmware update mode.',
      ],
      rawMessage,
    };
  }

  if (/falcon|wifi|hostname|host|private.*ip|network target|target rejected|invalid target/.test(text)) {
    return {
      kind: 'network-target',
      title: 'Network laser target was rejected',
      message: 'LaserForge could not use the requested network laser target.',
      actions: [
        'Use a private LAN IP address for supported Falcon WiFi targets.',
        'Confirm the laser is on the same trusted network.',
      ],
      rawMessage,
    };
  }

  return {
    kind: 'unknown',
    title: 'Connection failed',
    message: 'LaserForge could not connect to the selected machine.',
    actions: [
      'Check power, cable, firmware profile, and whether another sender has the port open.',
      'Export a support bundle if the failure repeats.',
    ],
    rawMessage,
  };
}

export function formatConnectionFailureMessage(guidance: ConnectionFailureGuidance): string {
  const actions = guidance.actions.map(action => `- ${action}`).join(' ');
  return `${guidance.title}. ${guidance.message} ${actions} Raw error: ${guidance.rawMessage}`;
}

function messageFromUnknown(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  try {
    return String(error);
  } catch {
    return 'Unknown error';
  }
}
