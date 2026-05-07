/**
 * T2-48: shared contract for simulator-backed controller tests.
 *
 * T2-47 gives us a GRBL firmware simulator. This file is the small
 * family-neutral layer that lets future Marlin, DSP, Wi-Fi, or native
 * simulator implementations plug into the same compliance harness
 * instead of growing parallel mock APIs.
 */

import type { ControllerFamily } from '../../src/controllers/ControllerInterface';
import type { ControllerCapabilities } from '../../src/controllers/ControllerCapabilities';
import type { ControllerFault } from '../helpers/ControllerFault';

export interface SimulatedControllerIdentity {
  readonly family: ControllerFamily;
  readonly protocol: string;
  readonly displayName: string;
}

export interface SimulatedControllerSnapshot {
  readonly state: string;
}

export interface SimulatedControllerDevice<
  TSnapshot extends SimulatedControllerSnapshot = SimulatedControllerSnapshot,
> {
  readonly identity: SimulatedControllerIdentity;
  readonly capabilities: ControllerCapabilities;

  receiveBytes(bytes: Uint8Array): void;
  readOutgoingBytes(): Uint8Array[];
  tick(elapsedMs: number): void;
  snapshot(): TSnapshot;

  injectFault(fault: ControllerFault): string;
  reset(): void;
}

export interface ComplianceCheckResult {
  readonly name: string;
  readonly passed: boolean;
  readonly message?: string;
}

function pass(name: string): ComplianceCheckResult {
  return { name, passed: true };
}

function fail(name: string, err: unknown): ComplianceCheckResult {
  return {
    name,
    passed: false,
    message: err instanceof Error ? err.message : String(err),
  };
}

function check(name: string, fn: () => void): ComplianceCheckResult {
  try {
    fn();
    return pass(name);
  } catch (err: unknown) {
    return fail(name, err);
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function decode(chunks: Uint8Array[]): string {
  return chunks.map(chunk => new TextDecoder().decode(chunk)).join('');
}

export function runControllerComplianceChecks(
  makeDevice: () => SimulatedControllerDevice,
): ComplianceCheckResult[] {
  return [
    check('identity', () => {
      const device = makeDevice();
      assert(device.identity.family.length > 0, 'family missing');
      assert(device.identity.protocol.length > 0, 'protocol missing');
      assert(device.identity.displayName.length > 0, 'displayName missing');
    }),
    check('capabilities', () => {
      const device = makeDevice();
      assert(device.capabilities.output.formats.length > 0, 'output formats missing');
      assert(device.capabilities.transport.supportedKinds.length > 0, 'transport kinds missing');
      assert(device.capabilities.motion.axes.length > 0, 'motion axes missing');
    }),
    check('io-bytes', () => {
      const device = makeDevice();
      device.receiveBytes(new TextEncoder().encode('?\n'));
      const output = decode(device.readOutgoingBytes());
      assert(output.length > 0, 'status query produced no output');
    }),
    check('tick-snapshot', () => {
      const device = makeDevice();
      device.tick(1);
      assert(typeof device.snapshot().state === 'string', 'snapshot state missing');
    }),
    check('reset', () => {
      const device = makeDevice();
      device.receiveBytes(new TextEncoder().encode('G1 X1 F600\n'));
      device.tick(10);
      device.reset();
      const output = decode(device.readOutgoingBytes());
      assert(output.length === 0, 'reset should clear pending output');
      assert(typeof device.snapshot().state === 'string', 'snapshot unavailable after reset');
    }),
  ];
}
