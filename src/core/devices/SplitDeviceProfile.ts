/**
 * T3-46: split DeviceProfile into four orthogonal sections —
 * Device (machine geometry / mechanics / optics), Controller
 * (firmware / dialect identity), Transport (which physical link
 * the bytes ride on), and Output (format / dialect / templates).
 *
 * Pre-T3-46 the live `DeviceProfile` (see `./DeviceProfile.ts`) is
 * a single flat record holding all four concerns at once, with
 * GRBL-specific fields (`baudRate`, `gcodeHeaderTemplate`,
 * `homingEnabled`, `softLimitsEnabled`) sitting next to Falcon
 * WiFi-specific connection metadata. Audit 3A section 6.1-6.5 noted
 * that the Falcon WiFi profile keeps GRBL-shaped fields at default
 * values "so existing code paths don't crash", which makes profile
 * validation impossible (a profile can claim falcon-wifi transport
 * and grbl-line-stream output simultaneously without anyone
 * objecting).
 *
 * **This module is purely additive.** It defines the split shape,
 * a migration adapter `splitFromMonolithic`, and a validator
 * `validateSplitProfile` that enumerates the conflicts the audit
 * called out (e.g. controller family != 'grbl' but output.format ==
 * 'grbl', or transport falcon-wifi paired with line-stream output
 * when Falcon requires file upload). The live `DeviceProfile` type
 * stays as-is. Storage, migration scaffolding, and every consumer
 * that reads `profile.X` continue to work unchanged.
 *
 * Migrating storage to persist the split shape and consumers to
 * read from sections is filed as future T3-46 follow-up slices,
 * gated on a non-GRBL profile actually exercising the conflict
 * detection. Same foundation-first pattern T2-25, T3-44, and T3-45
 * used.
 */

import type { ControllerFamily } from '../../controllers/ControllerInterface';
import type { OutputFormat } from '../output/Output';
import type {
  DeviceConnection,
  DeviceConnectionKind,
  DeviceProfile,
  MachineOriginCorner,
} from './DeviceProfile';

/**
 * Geometry, mechanics, and optics. What you'd write on the side of
 * the machine. Independent of which controller talks to it.
 */
export interface DeviceSection {
  readonly machineType: 'diode' | 'co2' | 'fiber';
  readonly watts: number;
  readonly brand: string;
  readonly model: string;
  readonly bedWidth: number;
  readonly bedHeight: number;
  readonly originCorner: MachineOriginCorner;
  readonly homeCorner?: MachineOriginCorner;
  readonly maxFeedRate: number;
  readonly maxRateX?: number;
  readonly maxRateY?: number;
  readonly maxAccelX?: number;
  readonly maxAccelY?: number;
  readonly maxAccelMmPerS2?: number;
  readonly autoFocusSupported?: boolean;
  readonly autoFocusCommand?: string;
  readonly autoFocusTimeoutMs?: number;
  readonly overscanMm?: number;
}

/**
 * Controller firmware / dialect identity. What the bytes mean once
 * they reach the device. `family` is the canonical controller-family
 * union from `ControllerInterface`.
 */
export interface ControllerSection {
  readonly family: ControllerFamily;
  readonly maxSpindle: number;
  readonly homingEnabled: boolean;
  readonly softLimitsEnabled: boolean;
  readonly suppressWcsConsent?: boolean;
  readonly stopOnError?: boolean;
  readonly allowsNegativeWorkspace?: boolean;
}

/**
 * Transport — which physical link the bytes ride on. Mirrors the
 * existing `DeviceConnection` discriminated union so legacy
 * profiles can be split without inventing a parallel transport
 * vocabulary; the discriminant is `kind`.
 */
export interface TransportSection {
  readonly kind: DeviceConnectionKind;
  readonly serial?: {
    readonly baudRate: number;
    readonly preferredPort?: string;
  };
  readonly falconWifi?: {
    readonly ip: string;
    readonly macAddress?: string;
    readonly deviceModel?: string;
    readonly firmwareVersion?: string;
  };
}

/**
 * Output format and templates. What the compiler emits.
 */
export interface OutputSection {
  readonly format: OutputFormat;
  readonly dialect?: string;
  readonly headerTemplate?: string;
  readonly footerTemplate?: string;
  readonly startGcode?: string;
  readonly endGcode?: string;
}

/**
 * The split profile. Combines four orthogonal sections under the
 * same `id` / `name` identifiers the live profile uses, so save /
 * load code can roundtrip through this shape without losing
 * profile identity.
 */
export interface SplitDeviceProfile {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly device: DeviceSection;
  readonly controller: ControllerSection;
  readonly transport: TransportSection;
  readonly output: OutputSection;
}

/**
 * Migration adapter — split a monolithic `DeviceProfile` into the
 * four sections. Lossy in one direction only: GRBL-specific fields
 * that are not in any of the four sections (e.g. `responseCurves`,
 * `scanningOffsets`, `frameDotFeedRate`, `accelAwarePower`,
 * `minPowerRatioAccel`, `smartOverscanEnabled`) are intentionally
 * omitted from the split shape because they sit in their own
 * domain (materials, raster planning, frame UX) rather than the
 * Device / Controller / Transport / Output axes T3-46 carves out.
 * Future slices may add a fifth section if needed.
 */
export function splitFromMonolithic(profile: DeviceProfile): SplitDeviceProfile {
  const connection: DeviceConnection | undefined = profile.connection;
  const transportKind: DeviceConnectionKind = connection?.kind ?? 'serial';

  const transport: TransportSection = {
    kind: transportKind,
    serial: transportKind === 'serial'
      ? {
          baudRate: profile.baudRate,
          preferredPort: profile.preferredPort,
        }
      : undefined,
    falconWifi: connection?.kind === 'falcon-wifi'
      ? {
          ip: connection.ip,
          macAddress: connection.macAddress,
          deviceModel: connection.deviceModel,
          firmwareVersion: connection.firmwareVersion,
        }
      : undefined,
  };

  const controllerFamily: ControllerFamily = transportKind === 'falcon-wifi'
    ? 'file-upload'
    : 'grbl';

  return {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
    updatedAt: profile.updatedAt,
    device: {
      machineType: profile.machineType,
      watts: profile.watts,
      brand: profile.brand,
      model: profile.model,
      bedWidth: profile.bedWidth,
      bedHeight: profile.bedHeight,
      originCorner: profile.originCorner,
      homeCorner: profile.homeCorner,
      maxFeedRate: profile.maxFeedRate,
      maxRateX: profile.maxRateX,
      maxRateY: profile.maxRateY,
      maxAccelX: profile.maxAccelX,
      maxAccelY: profile.maxAccelY,
      maxAccelMmPerS2: profile.maxAccelMmPerS2,
      autoFocusSupported: profile.autoFocusSupported,
      autoFocusCommand: profile.autoFocusCommand,
      autoFocusTimeoutMs: profile.autoFocusTimeoutMs,
      overscanMm: profile.overscanMm,
    },
    controller: {
      family: controllerFamily,
      maxSpindle: profile.maxSpindle,
      homingEnabled: profile.homingEnabled,
      softLimitsEnabled: profile.softLimitsEnabled,
      suppressWcsConsent: profile.suppressWcsConsent,
      stopOnError: profile.stopOnError,
      allowsNegativeWorkspace: profile.allowsNegativeWorkspace,
    },
    transport,
    output: {
      format: profile.outputFormat ?? 'grbl',
      dialect: profile.outputDialect,
      headerTemplate: profile.gcodeHeaderTemplate,
      footerTemplate: profile.gcodeFooterTemplate,
      startGcode: profile.startGcode,
      endGcode: profile.endGcode,
    },
  };
}

export type SplitProfileValidationCode =
  | 'transport-output-mismatch'
  | 'controller-output-mismatch'
  | 'transport-controller-mismatch'
  | 'invalid-bed-dimensions'
  | 'invalid-max-feed-rate'
  | 'falcon-wifi-missing-ip'
  | 'serial-missing-baud-rate';

export interface SplitProfileValidationIssue {
  readonly code: SplitProfileValidationCode;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly path: string;
}

export interface SplitProfileValidationResult {
  readonly ok: boolean;
  readonly issues: readonly SplitProfileValidationIssue[];
}

/**
 * Conflict detection per audit 3A section 6.5. Each rule maps a
 * documented mismatch to a structured issue with a path so UI can
 * surface both the field and the human-readable reason. Returns
 * `ok: true` and an empty issues array for a valid profile.
 *
 * Rules:
 * 1. transport.kind 'falcon-wifi' but output.format 'grbl' (line-
 *    stream) — Falcon WiFi requires file-upload execution; GRBL
 *    line-stream is not applicable.
 * 2. controller.family 'grbl' but output.format not in
 *    {'grbl','custom'} — GRBL controllers cannot consume non-GRBL
 *    dialect output.
 * 3. transport.kind 'serial' but controller.family 'file-upload' —
 *    a file-upload controller does not stream over serial.
 * 4. bedWidth or bedHeight non-positive.
 * 5. maxFeedRate non-positive.
 * 6. transport.kind 'falcon-wifi' but transport.falconWifi missing
 *    ip — required for the live HTTP/WebSocket connection.
 * 7. transport.kind 'serial' but transport.serial.baudRate missing
 *    or non-positive.
 */
export function validateSplitProfile(
  profile: SplitDeviceProfile,
): SplitProfileValidationResult {
  const issues: SplitProfileValidationIssue[] = [];

  // Rule 1: falcon-wifi transport + grbl-line-stream output mismatch.
  if (profile.transport.kind === 'falcon-wifi' && profile.output.format === 'grbl') {
    issues.push({
      code: 'transport-output-mismatch',
      severity: 'error',
      message:
        'Falcon WiFi transport cannot use GRBL line-stream output; the Falcon API requires a file-upload output flow.',
      path: 'output.format',
    });
  }

  // Rule 2: GRBL controller family must use grbl or custom output.
  if (
    profile.controller.family === 'grbl'
    && profile.output.format !== 'grbl'
    && profile.output.format !== 'custom'
  ) {
    issues.push({
      code: 'controller-output-mismatch',
      severity: 'error',
      message:
        `GRBL controller cannot consume '${profile.output.format}' output; expected 'grbl' or 'custom'.`,
      path: 'output.format',
    });
  }

  // Rule 3: file-upload controller cannot ride a serial transport.
  if (profile.transport.kind === 'serial' && profile.controller.family === 'file-upload') {
    issues.push({
      code: 'transport-controller-mismatch',
      severity: 'error',
      message:
        'File-upload controller cannot use a serial transport; expected a network/HTTP transport.',
      path: 'transport.kind',
    });
  }

  // Rule 4: bed geometry must be positive.
  if (!Number.isFinite(profile.device.bedWidth) || profile.device.bedWidth <= 0) {
    issues.push({
      code: 'invalid-bed-dimensions',
      severity: 'error',
      message: 'Bed width must be a positive number.',
      path: 'device.bedWidth',
    });
  }
  if (!Number.isFinite(profile.device.bedHeight) || profile.device.bedHeight <= 0) {
    issues.push({
      code: 'invalid-bed-dimensions',
      severity: 'error',
      message: 'Bed height must be a positive number.',
      path: 'device.bedHeight',
    });
  }

  // Rule 5: feed rate must be positive.
  if (!Number.isFinite(profile.device.maxFeedRate) || profile.device.maxFeedRate <= 0) {
    issues.push({
      code: 'invalid-max-feed-rate',
      severity: 'error',
      message: 'Max feed rate must be a positive number.',
      path: 'device.maxFeedRate',
    });
  }

  // Rule 6: falcon-wifi requires an IP.
  if (profile.transport.kind === 'falcon-wifi') {
    const ip = profile.transport.falconWifi?.ip;
    if (typeof ip !== 'string' || ip.trim() === '') {
      issues.push({
        code: 'falcon-wifi-missing-ip',
        severity: 'error',
        message: 'Falcon WiFi transport requires an IP / hostname.',
        path: 'transport.falconWifi.ip',
      });
    }
  }

  // Rule 7: serial requires a positive baud rate.
  if (profile.transport.kind === 'serial') {
    const baud = profile.transport.serial?.baudRate;
    if (!Number.isFinite(baud) || (baud as number) <= 0) {
      issues.push({
        code: 'serial-missing-baud-rate',
        severity: 'error',
        message: 'Serial transport requires a positive baud rate.',
        path: 'transport.serial.baudRate',
      });
    }
  }

  return {
    ok: issues.every((i) => i.severity !== 'error'),
    issues,
  };
}

/** Predicate: this is a Falcon WiFi profile (file-upload over wifi). */
export function isFalconWifiProfile(profile: SplitDeviceProfile): boolean {
  return profile.transport.kind === 'falcon-wifi';
}

/** Predicate: this is a serial GRBL profile (the historical default). */
export function isSerialGrblProfile(profile: SplitDeviceProfile): boolean {
  return (
    profile.transport.kind === 'serial'
    && profile.controller.family === 'grbl'
    && (profile.output.format === 'grbl' || profile.output.format === 'custom')
  );
}
