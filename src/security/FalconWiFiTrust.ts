/**
 * T2-126: Falcon WiFi treated as untrusted telemetry. Pre-T2-126
 * `electron/falcon-wifi/FalconHttpClient.ts:11` documents itself as
 * "No auth of any kind" — a local-network attacker (or fake Falcon
 * device, or compromised router doing DNS rebinding) can respond
 * to HTTP and WS queries with fabricated state. The connection
 * panel displays Falcon WiFi state with the same UI prominence as
 * serial state, so the user can't tell which is more trustworthy.
 *
 * Audit 5D Critical failure 10 + Required Priority 11.
 *
 * T2-126 ships the typed trust classifier + the per-action policy
 * gate + the UI labels + the identity-mismatch detector. Wiring
 * the labels into ConnectionPanelMain + the policy into job-start
 * paths is filed as T2-126-followup.
 */

export type ConnectionKind = 'usb-serial' | 'wifi' | 'simulator' | 'unknown';

export type TrustTier = 'trusted' | 'partial' | 'untrusted';

export interface TrustClassification {
  readonly kind: ConnectionKind;
  readonly tier: TrustTier;
  readonly label: string;
  readonly hint: string | null;
}

/**
 * Pure classifier. USB serial + simulator are trusted (direct
 * physical / explicit dev). WiFi is untrusted (no auth on the
 * Falcon protocol). Unknown returns 'partial' — caller should
 * surface this to the user as "we can't tell".
 */
export function classifyConnectionTrust(kind: ConnectionKind): TrustClassification {
  switch (kind) {
    case 'usb-serial':
      return { kind, tier: 'trusted', label: 'USB Serial', hint: null };
    case 'simulator':
      return { kind, tier: 'trusted', label: 'Simulator', hint: 'Development simulator — not a real device.' };
    case 'wifi':
      return {
        kind, tier: 'untrusted', label: 'WiFi (telemetry only)',
        hint: 'WiFi is not authenticated. Use USB for safety-critical operations.',
      };
    case 'unknown':
      return {
        kind, tier: 'partial', label: 'Unknown',
        hint: 'Connection type is undetermined. Treat as untrusted.',
      };
  }
}

/**
 * Audit-derived per-action gate kinds. Different operations have
 * different policies — UI uses these to decide which control to
 * render (disabled, override-button, plain).
 */
export type ActionPolicyKind =
  | 'allow'
  | 'allow-with-warning'
  | 'require-override'
  | 'block';

export type FalconWiFiAction =
  | 'start-job'
  | 'frame'
  | 'jog'
  | 'unlock'
  | 'home'
  | 'set-origin'
  | 'view-status'
  | 'pause'
  | 'stop';

export interface ActionPolicy {
  readonly action: FalconWiFiAction;
  readonly kind: ActionPolicyKind;
  readonly userMessage: string;
  /** True iff the policy lets the action proceed (with or without warning). */
  readonly allowed: boolean;
}

/**
 * Audit-derived policy choice. Three named policies the user can
 * pick in settings (T2-126-followup):
 *  - 'strictest': WiFi is read-only telemetry; all controls block.
 *  - 'medium': WiFi controls require explicit per-action override.
 *  - 'loosest': WiFi controls warn but allow.
 *
 * Returns the per-action policy.
 */
export type WiFiPolicyMode = 'strictest' | 'medium' | 'loosest';

export const ACTIONS_REQUIRING_TRUST: readonly FalconWiFiAction[] = [
  'start-job', 'frame', 'jog', 'unlock', 'home', 'set-origin',
] as const;

export const ALWAYS_SAFE_ACTIONS: readonly FalconWiFiAction[] = [
  'view-status', 'pause', 'stop',
] as const;

export function evaluateWiFiActionPolicy(opts: {
  action: FalconWiFiAction;
  trust: TrustClassification;
  policyMode: WiFiPolicyMode;
}): ActionPolicy {
  // Trusted connections: all actions allowed plain.
  if (opts.trust.tier === 'trusted') {
    return {
      action: opts.action, kind: 'allow', allowed: true,
      userMessage: '',
    };
  }
  // 'view-status' / 'pause' / 'stop' always allowed regardless of policy.
  if ((ALWAYS_SAFE_ACTIONS as readonly FalconWiFiAction[]).includes(opts.action)) {
    return {
      action: opts.action, kind: 'allow', allowed: true,
      userMessage: '',
    };
  }
  // Untrusted/partial + safety-critical action — apply policyMode.
  switch (opts.policyMode) {
    case 'strictest':
      return {
        action: opts.action, kind: 'block', allowed: false,
        userMessage: 'WiFi is read-only telemetry. Use USB for this operation.',
      };
    case 'medium':
      return {
        action: opts.action, kind: 'require-override', allowed: true,
        userMessage:
          'WiFi connections are not authenticated. The device responding may not be your laser. ' +
          'Recommended: connect via USB. Override to proceed over WiFi.',
      };
    case 'loosest':
      return {
        action: opts.action, kind: 'allow-with-warning', allowed: true,
        userMessage:
          'WiFi is unauthenticated — proceeding without identity verification.',
      };
  }
}

/**
 * Identity check: when the user first pairs with a Falcon WiFi
 * device, store its serial number. On every subsequent connect,
 * verify the responding device's serial matches. A mismatch
 * suggests the user is talking to a different device than
 * expected (DHCP shuffle, attacker, second machine on the LAN).
 */
export type IdentityCheckResult =
  | { ok: true; reason: 'first-pairing' | 'serial-matches' }
  | {
      ok: false;
      reason: 'serial-mismatch' | 'no-serial-reported' | 'expected-but-no-stored';
      detail: string;
    };

export function checkFalconIdentity(opts: {
  storedSerial: string | null;
  observedSerial: string | null;
  isFirstPairing: boolean;
}): IdentityCheckResult {
  if (opts.isFirstPairing) {
    if (opts.observedSerial == null) {
      return {
        ok: false, reason: 'no-serial-reported',
        detail: 'Device did not report a serial number during pairing.',
      };
    }
    return { ok: true, reason: 'first-pairing' };
  }
  if (opts.observedSerial == null) {
    return {
      ok: false, reason: 'no-serial-reported',
      detail: 'Device did not report a serial number on this connect.',
    };
  }
  if (opts.storedSerial == null) {
    return {
      ok: false, reason: 'expected-but-no-stored',
      detail: 'No serial number was stored during initial pairing — please re-pair.',
    };
  }
  if (opts.storedSerial !== opts.observedSerial) {
    return {
      ok: false, reason: 'serial-mismatch',
      detail: `Expected serial ${opts.storedSerial} but observed ${opts.observedSerial}. The device responding may not be your previously paired laser.`,
    };
  }
  return { ok: true, reason: 'serial-matches' };
}

/**
 * UI label builder — used by `ConnectionPanelMain` to render the
 * "Falcon A1 Pro (192.168.1.42) [WiFi, telemetry only]" badge.
 */
export function buildConnectionBadge(opts: {
  modelName: string;
  address: string | null;
  trust: TrustClassification;
}): string {
  const addrSuffix = opts.address ? ` (${opts.address})` : '';
  return `${opts.modelName}${addrSuffix} [${opts.trust.label}]`;
}

/**
 * UI confirmation copy for the audit's "Start job over WiFi?"
 * dialog — used when policy is 'require-override' for start-job.
 */
export interface OverrideDialogCopy {
  readonly title: string;
  readonly body: string;
  readonly preferUsbLabel: string;
  readonly cancelLabel: string;
  readonly proceedLabel: string;
}

export function startOverWiFiDialog(): OverrideDialogCopy {
  return {
    title: 'Start job over WiFi?',
    body:
      'WiFi connections are not authenticated. The device responding may not be ' +
      'your laser. Recommended: connect via USB for jobs.',
    preferUsbLabel: 'Use USB instead',
    cancelLabel: 'Cancel',
    proceedLabel: 'Start over WiFi anyway',
  };
}
