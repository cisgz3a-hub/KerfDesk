# Controller Settings Controls Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new LaserForge machine-control v2 layer for controller settings, start, pause, resume, stop, jog, test fire, frame, unlock, homing, and WCS reset without deleting the current safety-tested implementation first.

**Architecture:** Add a parallel `src/machine-control-v2/` subsystem behind a feature flag. UI sends typed intents into a controller service; controller service validates machine state, profile, capabilities, and safety; GRBL driver emits commands through a transport that handles streaming and realtime semantics. The old `MachineService` remains until v2 passes transcript, unit, integration, and hardware-validation gates.

**Tech Stack:** TypeScript, existing `tsx` tests, current LaserForge controller interfaces, fake-controller transcripts, GRBL realtime command semantics, React adapter only after the pure core passes.

---

## File Structure

- Create `src/machine-control-v2/MachineIntent.ts` for typed button/keyboard/manual-console intents.
- Create `src/machine-control-v2/MachineStateMachine.ts` for legal states and transitions.
- Create `src/machine-control-v2/MachineReadiness.ts` for enabled/disabled button models and reasons.
- Create `src/machine-control-v2/ControllerProfile.ts` for GRBL/Falcon/simulator profile and settings snapshot.
- Create `src/machine-control-v2/ControllerCapabilitiesV2.ts` for operation capability checks.
- Create `src/machine-control-v2/grbl/GrblRealtime.ts` for `!`, `~`, `?`, `0x18`, and `0x85`.
- Create `src/machine-control-v2/grbl/GrblJog.ts` for `$J=` and old-firmware fallback command planning.
- Create `src/machine-control-v2/grbl/GrblSettingsModel.ts` for `$` setting normalization.
- Create `src/machine-control-v2/grbl/GrblTransportV2.ts` for byte-buffer accounting and realtime bypass.
- Create `src/machine-control-v2/MachineOperationService.ts` for start/pause/resume/stop/jog/test-fire/frame/unlock/home/WCS orchestration.
- Create `src/machine-control-v2/MachineCommandLog.ts` for command/event transcript capture.
- Create `src/machine-control-v2/ControllerPanelAdapter.ts` for React-facing button models.
- Create tests under `tests/machine-control-v2-*.test.ts`.

Do not modify `src/app/MachineService.ts`, `src/controllers/grbl/GrblController.ts`, or `src/ui/components/ConnectionPanelMain.tsx` until Tasks 1-7 pass.

### Task 1: Define Machine Intents and Operation Results

**Files:**
- Create: `src/machine-control-v2/MachineIntent.ts`
- Test: `tests/machine-control-v2-intents.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import {
  assertMachineIntent,
  machineIntentRequiresExclusiveOperation,
  type MachineIntent,
} from '../src/machine-control-v2/MachineIntent';

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

const start: MachineIntent = { kind: 'startJob', ticketId: 'ticket-1' };
const jog: MachineIntent = { kind: 'jog', axis: 'X', distanceMm: 10, feedMmPerMin: 2000 };
const pause: MachineIntent = { kind: 'pauseJob' };
const resetWcs: MachineIntent = { kind: 'resetWcsToBaseline', axes: ['X', 'Y'] };

assertMachineIntent(start);
assertMachineIntent(jog);
assertMachineIntent(pause);
assertMachineIntent(resetWcs);

assertEqual(machineIntentRequiresExclusiveOperation(start), true, 'start is exclusive');
assertEqual(machineIntentRequiresExclusiveOperation(jog), true, 'jog is exclusive');
assertEqual(machineIntentRequiresExclusiveOperation(pause), false, 'pause is realtime');
assertEqual(machineIntentRequiresExclusiveOperation({ kind: 'emergencyStop' }), false, 'emergency stop bypasses queue');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-intents.test.ts`

Expected: fails because `src/machine-control-v2/MachineIntent.ts` does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type Axis = 'X' | 'Y' | 'Z' | 'A';

export type MachineIntent =
  | { kind: 'connect'; targetId: string }
  | { kind: 'disconnect' }
  | { kind: 'startJob'; ticketId: string }
  | { kind: 'pauseJob' }
  | { kind: 'resumeJob' }
  | { kind: 'stopJob'; reason?: string }
  | { kind: 'emergencyStop' }
  | { kind: 'jog'; axis: Axis; distanceMm: number; feedMmPerMin: number }
  | { kind: 'cancelJog' }
  | { kind: 'frame'; ticketId: string }
  | { kind: 'testFire'; powerPercent: number; durationMs: number }
  | { kind: 'unlockAlarm' }
  | { kind: 'home'; axes?: readonly Axis[] }
  | { kind: 'resetWcsToBaseline'; axes: readonly Axis[] }
  | { kind: 'manualCommand'; line: string };

export type OperationTrust = 'trusted' | 'untrusted' | 'unknown';

export interface MachineOperationResult {
  readonly accepted: boolean;
  readonly intent: MachineIntent['kind'];
  readonly emittedCommands: readonly string[];
  readonly reason?: string;
  readonly positionTrust: OperationTrust;
  readonly laserOutputTrust: OperationTrust;
  readonly requiresRehome: boolean | 'unknown';
}

export function assertMachineIntent(intent: MachineIntent): void {
  if (!intent || typeof intent.kind !== 'string') {
    throw new Error('Invalid machine intent.');
  }
}

export function machineIntentRequiresExclusiveOperation(intent: MachineIntent): boolean {
  switch (intent.kind) {
    case 'pauseJob':
    case 'resumeJob':
    case 'stopJob':
    case 'emergencyStop':
    case 'cancelJog':
      return false;
    default:
      return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/machine-control-v2-intents.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/machine-control-v2/MachineIntent.ts tests/machine-control-v2-intents.test.ts
git commit -m "feat(machine-control): add typed operation intents"
```

### Task 2: Add the Machine State Machine

**Files:**
- Create: `src/machine-control-v2/MachineStateMachine.ts`
- Test: `tests/machine-control-v2-state-machine.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { canTransition, transitionMachineState, type MachineControlState } from '../src/machine-control-v2/MachineStateMachine';

function mustTransition(from: MachineControlState, event: string, to: MachineControlState): void {
  const actual = transitionMachineState(from, event);
  if (actual !== to) throw new Error(`${from} + ${event}: expected ${to}, got ${actual}`);
}

function mustReject(from: MachineControlState, event: string): void {
  if (canTransition(from, event)) throw new Error(`${from} + ${event} should be rejected`);
}

mustTransition('disconnected', 'connectRequested', 'connecting');
mustTransition('connecting', 'connected', 'idle');
mustTransition('idle', 'startRequested', 'preflight');
mustTransition('preflight', 'preflightPassed', 'armed');
mustTransition('armed', 'streamStarted', 'streaming');
mustTransition('streaming', 'pauseRequested', 'hold');
mustTransition('hold', 'resumeRequested', 'streaming');
mustTransition('streaming', 'stopRequested', 'stopping');
mustTransition('stopping', 'safeStopConfirmed', 'idle');
mustTransition('streaming', 'alarmReceived', 'alarm');
mustTransition('alarm', 'operatorAcknowledged', 'recovering');

mustReject('disconnected', 'startRequested');
mustReject('streaming', 'jogRequested');
mustReject('alarm', 'resumeRequested');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-state-machine.test.ts`

Expected: fails because state machine does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export type MachineControlState =
  | 'disconnected'
  | 'connecting'
  | 'idle'
  | 'jogging'
  | 'framing'
  | 'testFiring'
  | 'preflight'
  | 'armed'
  | 'streaming'
  | 'hold'
  | 'stopping'
  | 'alarm'
  | 'fault'
  | 'recovering';

const transitions: Record<MachineControlState, Record<string, MachineControlState>> = {
  disconnected: { connectRequested: 'connecting' },
  connecting: { connected: 'idle', connectFailed: 'fault', disconnectRequested: 'disconnected' },
  idle: {
    startRequested: 'preflight',
    jogRequested: 'jogging',
    frameRequested: 'framing',
    testFireRequested: 'testFiring',
    alarmReceived: 'alarm',
    disconnectRequested: 'disconnected',
  },
  jogging: { jogComplete: 'idle', cancelJogRequested: 'idle', alarmReceived: 'alarm' },
  framing: { frameComplete: 'idle', stopRequested: 'stopping', alarmReceived: 'alarm' },
  testFiring: { testFireComplete: 'idle', stopRequested: 'stopping', alarmReceived: 'alarm' },
  preflight: { preflightPassed: 'armed', preflightFailed: 'idle', stopRequested: 'stopping' },
  armed: { streamStarted: 'streaming', stopRequested: 'stopping' },
  streaming: { pauseRequested: 'hold', stopRequested: 'stopping', alarmReceived: 'alarm', streamComplete: 'idle' },
  hold: { resumeRequested: 'streaming', stopRequested: 'stopping', alarmReceived: 'alarm' },
  stopping: { safeStopConfirmed: 'idle', stopFailed: 'fault' },
  alarm: { operatorAcknowledged: 'recovering' },
  fault: { operatorAcknowledged: 'recovering', disconnectRequested: 'disconnected' },
  recovering: { recoveryComplete: 'idle', disconnectRequested: 'disconnected', recoveryFailed: 'fault' },
};

export function canTransition(from: MachineControlState, event: string): boolean {
  return Boolean(transitions[from]?.[event]);
}

export function transitionMachineState(from: MachineControlState, event: string): MachineControlState {
  const next = transitions[from]?.[event];
  if (!next) throw new Error(`Illegal machine transition: ${from} + ${event}`);
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/machine-control-v2-state-machine.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/machine-control-v2/MachineStateMachine.ts tests/machine-control-v2-state-machine.test.ts
git commit -m "feat(machine-control): add explicit machine state model"
```

### Task 3: Normalize Controller Profile and Settings

**Files:**
- Create: `src/machine-control-v2/ControllerProfile.ts`
- Create: `src/machine-control-v2/grbl/GrblSettingsModel.ts`
- Test: `tests/machine-control-v2-grbl-settings.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { parseGrblDollarSettings, toControllerProfile } from '../src/machine-control-v2/grbl/GrblSettingsModel';

const settings = parseGrblDollarSettings([
  '$20=1',
  '$22=1',
  '$30=1000',
  '$31=0',
  '$32=1',
  '$110=6000',
  '$111=5000',
  '$112=800',
  '$130=400',
  '$131=300',
  '$132=50',
]);

const profile = toControllerProfile({ family: 'grbl', firmwareVersion: '1.1h', settings });

if (!profile.softLimitsEnabled) throw new Error('soft limits should be true');
if (!profile.homingEnabled) throw new Error('homing should be true');
if (!profile.laserModeEnabled) throw new Error('laser mode should be true');
if (profile.spindleMax !== 1000) throw new Error('spindle max should be 1000');
if (profile.travelMm.X !== 400 || profile.travelMm.Y !== 300 || profile.travelMm.Z !== 50) {
  throw new Error(`wrong travel: ${JSON.stringify(profile.travelMm)}`);
}
if (profile.maxFeedMmPerMin.X !== 6000 || profile.maxFeedMmPerMin.Y !== 5000) {
  throw new Error(`wrong feed: ${JSON.stringify(profile.maxFeedMmPerMin)}`);
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-grbl-settings.test.ts`

Expected: fails because settings model does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { Axis } from '../MachineIntent';

export type ControllerFamily = 'grbl' | 'falcon-wifi' | 'simulator' | 'unknown';

export interface ControllerProfile {
  readonly family: ControllerFamily;
  readonly firmwareVersion?: string;
  readonly softLimitsEnabled: boolean;
  readonly homingEnabled: boolean;
  readonly laserModeEnabled: boolean;
  readonly spindleMin: number;
  readonly spindleMax: number;
  readonly travelMm: Record<Axis, number | null>;
  readonly maxFeedMmPerMin: Record<Axis, number | null>;
  readonly supportsRealtime: boolean;
  readonly supportsJogCancel: boolean;
}

export type GrblDollarSettings = ReadonlyMap<string, number>;
```

```ts
import type { Axis } from '../MachineIntent';
import type { ControllerFamily, ControllerProfile, GrblDollarSettings } from '../ControllerProfile';

export function parseGrblDollarSettings(lines: readonly string[]): GrblDollarSettings {
  const settings = new Map<string, number>();
  for (const line of lines) {
    const match = line.trim().match(/^(\$\d+)=(-?\d+(?:\.\d+)?)$/);
    if (!match) continue;
    settings.set(match[1], Number(match[2]));
  }
  return settings;
}

function setting(settings: GrblDollarSettings, key: string): number | null {
  return settings.has(key) ? settings.get(key)! : null;
}

function axisRecord(x: number | null, y: number | null, z: number | null, a: number | null = null): Record<Axis, number | null> {
  return { X: x, Y: y, Z: z, A: a };
}

export function toControllerProfile(args: {
  family: ControllerFamily;
  firmwareVersion?: string;
  settings: GrblDollarSettings;
}): ControllerProfile {
  const s = args.settings;
  return {
    family: args.family,
    firmwareVersion: args.firmwareVersion,
    softLimitsEnabled: setting(s, '$20') === 1,
    homingEnabled: setting(s, '$22') === 1,
    laserModeEnabled: setting(s, '$32') === 1,
    spindleMin: setting(s, '$31') ?? 0,
    spindleMax: setting(s, '$30') ?? 1000,
    travelMm: axisRecord(setting(s, '$130'), setting(s, '$131'), setting(s, '$132'), setting(s, '$133')),
    maxFeedMmPerMin: axisRecord(setting(s, '$110'), setting(s, '$111'), setting(s, '$112'), setting(s, '$113')),
    supportsRealtime: args.family === 'grbl',
    supportsJogCancel: args.family === 'grbl',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/machine-control-v2-grbl-settings.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/machine-control-v2/ControllerProfile.ts src/machine-control-v2/grbl/GrblSettingsModel.ts tests/machine-control-v2-grbl-settings.test.ts
git commit -m "feat(machine-control): normalize controller settings profile"
```

### Task 4: Implement GRBL Realtime and Jog Command Planning

**Files:**
- Create: `src/machine-control-v2/grbl/GrblRealtime.ts`
- Create: `src/machine-control-v2/grbl/GrblJog.ts`
- Test: `tests/machine-control-v2-grbl-jog-realtime.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { GRBL_REALTIME } from '../src/machine-control-v2/grbl/GrblRealtime';
import { planGrblJog } from '../src/machine-control-v2/grbl/GrblJog';
import type { ControllerProfile } from '../src/machine-control-v2/ControllerProfile';

const profile: ControllerProfile = {
  family: 'grbl',
  firmwareVersion: '1.1h',
  softLimitsEnabled: true,
  homingEnabled: true,
  laserModeEnabled: true,
  spindleMin: 0,
  spindleMax: 1000,
  travelMm: { X: 400, Y: 300, Z: null, A: null },
  maxFeedMmPerMin: { X: 6000, Y: 5000, Z: null, A: null },
  supportsRealtime: true,
  supportsJogCancel: true,
};

if (GRBL_REALTIME.feedHold !== '!') throw new Error('feed hold must be !');
if (GRBL_REALTIME.cycleStart !== '~') throw new Error('cycle start must be ~');
if (GRBL_REALTIME.softReset.charCodeAt(0) !== 0x18) throw new Error('soft reset must be ctrl-x');
if (GRBL_REALTIME.jogCancel.charCodeAt(0) !== 0x85) throw new Error('jog cancel must be 0x85');

const jog = planGrblJog({ profile, axis: 'X', distanceMm: 10, feedMmPerMin: 2000, absolute: false });
if (jog.command !== '$J=G91 G21 X10 F2000') throw new Error(jog.command);
if (jog.parserStateIndependent !== true) throw new Error('jog must be parser-state independent');

const tooFar = planGrblJog({ profile, axis: 'X', distanceMm: 500, feedMmPerMin: 2000, absolute: false });
if (tooFar.accepted) throw new Error('out-of-bounds jog should be rejected');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-grbl-jog-realtime.test.ts`

Expected: fails because GRBL realtime/jog modules do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export const GRBL_REALTIME = {
  feedHold: '!',
  cycleStart: '~',
  statusPoll: '?',
  softReset: String.fromCharCode(0x18),
  jogCancel: String.fromCharCode(0x85),
} as const;
```

```ts
import type { Axis } from '../MachineIntent';
import type { ControllerProfile } from '../ControllerProfile';

export interface PlannedJog {
  readonly accepted: boolean;
  readonly command: string;
  readonly reason?: string;
  readonly parserStateIndependent: boolean;
}

export function planGrblJog(args: {
  profile: ControllerProfile;
  axis: Axis;
  distanceMm: number;
  feedMmPerMin: number;
  absolute: boolean;
}): PlannedJog {
  const { profile, axis, distanceMm, feedMmPerMin, absolute } = args;
  if (!Number.isFinite(distanceMm) || distanceMm === 0) {
    return { accepted: false, command: '', reason: 'Jog distance must be non-zero.', parserStateIndependent: true };
  }
  if (!Number.isFinite(feedMmPerMin) || feedMmPerMin <= 0) {
    return { accepted: false, command: '', reason: 'Jog feed must be positive.', parserStateIndependent: true };
  }
  const maxFeed = profile.maxFeedMmPerMin[axis];
  if (maxFeed !== null && feedMmPerMin > maxFeed) {
    return { accepted: false, command: '', reason: `Jog feed exceeds ${axis} maximum.`, parserStateIndependent: true };
  }
  const travel = profile.travelMm[axis];
  if (!absolute && profile.softLimitsEnabled && travel !== null && Math.abs(distanceMm) > travel) {
    return { accepted: false, command: '', reason: `Jog exceeds ${axis} travel.`, parserStateIndependent: true };
  }
  const mode = absolute ? 'G90' : 'G91';
  return {
    accepted: true,
    command: `$J=${mode} G21 ${axis}${formatNumber(distanceMm)} F${formatNumber(feedMmPerMin)}`,
    parserStateIndependent: true,
  };
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/machine-control-v2-grbl-jog-realtime.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/machine-control-v2/grbl/GrblRealtime.ts src/machine-control-v2/grbl/GrblJog.ts tests/machine-control-v2-grbl-jog-realtime.test.ts
git commit -m "feat(machine-control): plan safe grbl realtime and jog commands"
```

### Task 5: Build Button Readiness From State and Capabilities

**Files:**
- Create: `src/machine-control-v2/ControllerCapabilitiesV2.ts`
- Create: `src/machine-control-v2/MachineReadiness.ts`
- Test: `tests/machine-control-v2-readiness.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { getMachineReadiness } from '../src/machine-control-v2/MachineReadiness';
import type { ControllerCapabilitiesV2 } from '../src/machine-control-v2/ControllerCapabilitiesV2';

const caps: ControllerCapabilitiesV2 = {
  canStart: true,
  canPause: true,
  canResume: true,
  canStop: true,
  canEmergencyStop: true,
  canJog: true,
  canHome: false,
  canUnlock: true,
  canResetWcs: true,
  canTestFire: true,
  canFrame: true,
};

const idle = getMachineReadiness({ state: 'idle', capabilities: caps, hasValidatedTicket: true, hasFrameProof: true });
if (!idle.start.enabled) throw new Error('start should be enabled');
if (!idle.jog.enabled) throw new Error('jog should be enabled');
if (idle.home.enabled) throw new Error('home should be disabled without capability');

const streaming = getMachineReadiness({ state: 'streaming', capabilities: caps, hasValidatedTicket: true, hasFrameProof: true });
if (streaming.start.enabled) throw new Error('start must be disabled while streaming');
if (!streaming.pause.enabled) throw new Error('pause should be enabled while streaming');
if (!streaming.stop.enabled) throw new Error('stop should be enabled while streaming');
if (streaming.jog.enabled) throw new Error('jog must be disabled while streaming');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-readiness.test.ts`

Expected: fails because readiness modules do not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface ControllerCapabilitiesV2 {
  readonly canStart: boolean;
  readonly canPause: boolean;
  readonly canResume: boolean;
  readonly canStop: boolean;
  readonly canEmergencyStop: boolean;
  readonly canJog: boolean;
  readonly canHome: boolean;
  readonly canUnlock: boolean;
  readonly canResetWcs: boolean;
  readonly canTestFire: boolean;
  readonly canFrame: boolean;
}
```

```ts
import type { MachineControlState } from './MachineStateMachine';
import type { ControllerCapabilitiesV2 } from './ControllerCapabilitiesV2';

export interface ReadinessButton {
  readonly enabled: boolean;
  readonly reason: string;
}

export interface MachineReadiness {
  readonly start: ReadinessButton;
  readonly pause: ReadinessButton;
  readonly resume: ReadinessButton;
  readonly stop: ReadinessButton;
  readonly emergencyStop: ReadinessButton;
  readonly jog: ReadinessButton;
  readonly home: ReadinessButton;
  readonly unlock: ReadinessButton;
  readonly resetWcs: ReadinessButton;
  readonly testFire: ReadinessButton;
  readonly frame: ReadinessButton;
}

export function getMachineReadiness(args: {
  state: MachineControlState;
  capabilities: ControllerCapabilitiesV2;
  hasValidatedTicket: boolean;
  hasFrameProof: boolean;
}): MachineReadiness {
  const { state, capabilities, hasValidatedTicket, hasFrameProof } = args;
  const idle = state === 'idle';
  const streaming = state === 'streaming';
  const hold = state === 'hold';
  const alarm = state === 'alarm';

  return {
    start: button(capabilities.canStart && idle && hasValidatedTicket && hasFrameProof, 'Start requires idle machine, validated ticket, and frame proof.'),
    pause: button(capabilities.canPause && streaming, 'Pause requires active streaming job.'),
    resume: button(capabilities.canResume && hold, 'Resume requires paused/hold state.'),
    stop: button(capabilities.canStop && (streaming || hold || state === 'framing' || state === 'testFiring'), 'Stop requires active operation.'),
    emergencyStop: button(capabilities.canEmergencyStop && state !== 'disconnected', 'Emergency stop requires a connected controller.'),
    jog: button(capabilities.canJog && idle, 'Jog requires idle machine.'),
    home: button(capabilities.canHome && idle, 'Home not supported or machine not idle.'),
    unlock: button(capabilities.canUnlock && alarm, 'Unlock requires alarm state.'),
    resetWcs: button(capabilities.canResetWcs && idle, 'WCS reset requires idle machine.'),
    testFire: button(capabilities.canTestFire && idle, 'Test fire requires idle machine.'),
    frame: button(capabilities.canFrame && idle, 'Frame requires idle machine.'),
  };
}

function button(enabled: boolean, disabledReason: string): ReadinessButton {
  return enabled ? { enabled: true, reason: '' } : { enabled: false, reason: disabledReason };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/machine-control-v2-readiness.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/machine-control-v2/ControllerCapabilitiesV2.ts src/machine-control-v2/MachineReadiness.ts tests/machine-control-v2-readiness.test.ts
git commit -m "feat(machine-control): derive button readiness from state"
```

### Task 6: Implement a GRBL Transport With Realtime Bypass

**Files:**
- Create: `src/machine-control-v2/grbl/GrblTransportV2.ts`
- Test: `tests/machine-control-v2-grbl-transport.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { GrblTransportV2 } from '../src/machine-control-v2/grbl/GrblTransportV2';

const sent: string[] = [];
const transport = new GrblTransportV2({
  rxBufferSize: 20,
  write: async (data) => { sent.push(data); },
});

await transport.sendGcodeLine('G1 X1');
if (transport.bufferCount !== 6) throw new Error(`buffer count after G-code should be 6, got ${transport.bufferCount}`);
await transport.sendRealtime('!');
if (transport.bufferCount !== 6) throw new Error('realtime command must not count against buffer');
transport.acceptResponse('ok\n');
if (transport.bufferCount !== 0) throw new Error(`buffer count after ok should be 0, got ${transport.bufferCount}`);
if (sent.join('|') !== 'G1 X1\\n|!') throw new Error(`wrong transcript: ${sent.join('|')}`);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-grbl-transport.test.ts`

Expected: fails because transport does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
export interface GrblTransportDeps {
  readonly rxBufferSize: number;
  readonly write: (data: string) => Promise<void>;
}

export class GrblTransportV2 {
  private readonly pendingLengths: number[] = [];
  private count = 0;

  constructor(private readonly deps: GrblTransportDeps) {}

  get bufferCount(): number {
    return this.count;
  }

  async sendGcodeLine(line: string): Promise<void> {
    const data = line.endsWith('\n') ? line : `${line}\n`;
    const len = Buffer.byteLength(data, 'ascii');
    if (len > this.deps.rxBufferSize) {
      throw new Error(`G-code line length ${len} exceeds GRBL RX buffer ${this.deps.rxBufferSize}.`);
    }
    if (this.count + len > this.deps.rxBufferSize) {
      throw new Error(`GRBL RX buffer full: ${this.count}/${this.deps.rxBufferSize}.`);
    }
    this.pendingLengths.push(len);
    this.count += len;
    await this.deps.write(data);
  }

  async sendRealtime(char: string): Promise<void> {
    await this.deps.write(char);
  }

  acceptResponse(text: string): void {
    const acks = text.split(/\r?\n/).filter((line) => line === 'ok' || line.startsWith('error:')).length;
    for (let i = 0; i < acks; i++) {
      const len = this.pendingLengths.shift() ?? 0;
      this.count = Math.max(0, this.count - len);
    }
  }

  reset(): void {
    this.pendingLengths.length = 0;
    this.count = 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/machine-control-v2-grbl-transport.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/machine-control-v2/grbl/GrblTransportV2.ts tests/machine-control-v2-grbl-transport.test.ts
git commit -m "feat(machine-control): add grbl transport buffer accounting"
```

### Task 7: Build MachineOperationService for Controls

**Files:**
- Create: `src/machine-control-v2/MachineOperationService.ts`
- Create: `src/machine-control-v2/MachineCommandLog.ts`
- Test: `tests/machine-control-v2-operations.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { MachineOperationService } from '../src/machine-control-v2/MachineOperationService';
import { GRBL_REALTIME } from '../src/machine-control-v2/grbl/GrblRealtime';

const sent: string[] = [];
const service = new MachineOperationService({
  sendLine: async (line) => { sent.push(line); },
  sendRealtime: async (char) => { sent.push(char); },
});

await service.jog({ kind: 'jog', axis: 'X', distanceMm: 5, feedMmPerMin: 1000 });
await service.pause();
await service.resume();
await service.stop('operator requested');

if (sent[0] !== '$J=G91 G21 X5 F1000') throw new Error(`wrong jog: ${sent[0]}`);
if (!sent.includes(GRBL_REALTIME.feedHold)) throw new Error('pause did not send feed hold');
if (!sent.includes(GRBL_REALTIME.cycleStart)) throw new Error('resume did not send cycle start');
if (!sent.includes('M5')) throw new Error('stop did not send laser off');
if (!sent.includes(GRBL_REALTIME.softReset)) throw new Error('stop did not soft reset');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-operations.test.ts`

Expected: fails because operation service does not exist.

- [ ] **Step 3: Write minimal implementation**

```ts
import type { MachineIntent, MachineOperationResult } from './MachineIntent';
import { GRBL_REALTIME } from './grbl/GrblRealtime';

export interface MachineCommandLogEntry {
  readonly at: string;
  readonly kind: string;
  readonly detail: string;
}

export class MachineCommandLog {
  private readonly entries: MachineCommandLogEntry[] = [];
  add(kind: string, detail: string): void {
    this.entries.push({ at: new Date(0).toISOString(), kind, detail });
  }
  snapshot(): readonly MachineCommandLogEntry[] {
    return [...this.entries];
  }
}
```

```ts
import type { MachineIntent, MachineOperationResult } from './MachineIntent';
import { planGrblJog } from './grbl/GrblJog';
import { GRBL_REALTIME } from './grbl/GrblRealtime';
import type { ControllerProfile } from './ControllerProfile';
import { MachineCommandLog } from './MachineCommandLog';

export interface MachineOperationDeps {
  readonly sendLine: (line: string) => Promise<void>;
  readonly sendRealtime: (char: string) => Promise<void>;
}

const defaultProfile: ControllerProfile = {
  family: 'grbl',
  firmwareVersion: '1.1h',
  softLimitsEnabled: false,
  homingEnabled: false,
  laserModeEnabled: true,
  spindleMin: 0,
  spindleMax: 1000,
  travelMm: { X: null, Y: null, Z: null, A: null },
  maxFeedMmPerMin: { X: null, Y: null, Z: null, A: null },
  supportsRealtime: true,
  supportsJogCancel: true,
};

export class MachineOperationService {
  readonly log = new MachineCommandLog();

  constructor(private readonly deps: MachineOperationDeps, private readonly profile: ControllerProfile = defaultProfile) {}

  async jog(intent: Extract<MachineIntent, { kind: 'jog' }>): Promise<MachineOperationResult> {
    const planned = planGrblJog({
      profile: this.profile,
      axis: intent.axis,
      distanceMm: intent.distanceMm,
      feedMmPerMin: intent.feedMmPerMin,
      absolute: false,
    });
    if (!planned.accepted) return this.rejected('jog', planned.reason ?? 'Jog rejected.');
    await this.deps.sendLine(planned.command);
    this.log.add('tx', planned.command);
    return this.accepted('jog', [planned.command], false);
  }

  async pause(): Promise<MachineOperationResult> {
    await this.deps.sendRealtime(GRBL_REALTIME.feedHold);
    this.log.add('tx-realtime', 'feedHold');
    return this.accepted('pauseJob', [GRBL_REALTIME.feedHold], false);
  }

  async resume(): Promise<MachineOperationResult> {
    await this.deps.sendRealtime(GRBL_REALTIME.cycleStart);
    this.log.add('tx-realtime', 'cycleStart');
    return this.accepted('resumeJob', [GRBL_REALTIME.cycleStart], false);
  }

  async stop(reason: string): Promise<MachineOperationResult> {
    await this.deps.sendLine('M5');
    await this.deps.sendRealtime(GRBL_REALTIME.softReset);
    this.log.add('tx', `M5 then softReset: ${reason}`);
    return {
      accepted: true,
      intent: 'stopJob',
      emittedCommands: ['M5', GRBL_REALTIME.softReset],
      positionTrust: 'untrusted',
      laserOutputTrust: 'unknown',
      requiresRehome: true,
    };
  }

  private accepted(intent: MachineOperationResult['intent'], emittedCommands: readonly string[], requiresRehome: boolean): MachineOperationResult {
    return { accepted: true, intent, emittedCommands, positionTrust: 'trusted', laserOutputTrust: 'trusted', requiresRehome };
  }

  private rejected(intent: MachineOperationResult['intent'], reason: string): MachineOperationResult {
    return { accepted: false, intent, emittedCommands: [], reason, positionTrust: 'unknown', laserOutputTrust: 'unknown', requiresRehome: 'unknown' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx tsx tests/machine-control-v2-operations.test.ts`

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/machine-control-v2/MachineOperationService.ts src/machine-control-v2/MachineCommandLog.ts tests/machine-control-v2-operations.test.ts
git commit -m "feat(machine-control): add typed operation service"
```

### Task 8: Integrate V2 Behind a Feature Flag

**Files:**
- Create: `src/machine-control-v2/ControllerPanelAdapter.ts`
- Modify only after Tasks 1-7 pass: `src/ui/components/ConnectionPanelMain.tsx`
- Test: `tests/machine-control-v2-panel-adapter.test.ts`

- [ ] **Step 1: Write the adapter test before touching UI**

```ts
import { buildControllerPanelModel } from '../src/machine-control-v2/ControllerPanelAdapter';

const model = buildControllerPanelModel({
  state: 'idle',
  capabilities: {
    canStart: true,
    canPause: true,
    canResume: true,
    canStop: true,
    canEmergencyStop: true,
    canJog: true,
    canHome: true,
    canUnlock: true,
    canResetWcs: true,
    canTestFire: true,
    canFrame: true,
  },
  hasValidatedTicket: true,
  hasFrameProof: true,
});

if (!model.buttons.start.enabled) throw new Error('start should be enabled');
if (!model.buttons.resetWcs.enabled) throw new Error('reset WCS should be enabled');
if (model.buttons.pause.enabled) throw new Error('pause should be disabled while idle');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-panel-adapter.test.ts`

Expected: fails because adapter does not exist.

- [ ] **Step 3: Implement adapter**

```ts
import type { ControllerCapabilitiesV2 } from './ControllerCapabilitiesV2';
import type { MachineControlState } from './MachineStateMachine';
import { getMachineReadiness } from './MachineReadiness';

export function buildControllerPanelModel(args: {
  state: MachineControlState;
  capabilities: ControllerCapabilitiesV2;
  hasValidatedTicket: boolean;
  hasFrameProof: boolean;
}) {
  return {
    buttons: getMachineReadiness(args),
  };
}
```

- [ ] **Step 4: Run adapter test**

Run: `npx tsx tests/machine-control-v2-panel-adapter.test.ts`

Expected: pass.

- [ ] **Step 5: Add feature flag wiring only after adapter passes**

Add a non-default flag, for example `VITE_MACHINE_CONTROL_V2_ENABLED=false`, and render v2 button-model diagnostics only in developer mode. Do not replace existing Start/Pause/Stop buttons in this task.

- [ ] **Step 6: Commit**

```bash
git add src/machine-control-v2/ControllerPanelAdapter.ts tests/machine-control-v2-panel-adapter.test.ts
git commit -m "feat(machine-control): add v2 panel adapter model"
```

### Task 9: Cutover One Control at a Time

**Files:**
- Modify: `src/ui/components/ConnectionPanelMain.tsx`
- Modify: `src/app/MachineService.ts`
- Tests: one test per button path, starting with WCS reset, then jog, then pause/resume, then stop, then start.

- [ ] **Step 1: Start with WCS reset only**

Write `tests/machine-control-v2-wcs-cutover.test.ts` proving the button dispatches `{ kind: 'resetWcsToBaseline', axes: ['X', 'Y'] }` and does not send raw G-code from UI.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx tsx tests/machine-control-v2-wcs-cutover.test.ts`

Expected: fail until WCS reset routes through v2 adapter.

- [ ] **Step 3: Wire WCS reset through v2**

Only WCS reset changes in this commit. Do not touch start/pause/jog.

- [ ] **Step 4: Run focused and baseline checks**

Run:

```bash
npx tsx tests/machine-control-v2-wcs-cutover.test.ts
npx tsc --noEmit --pretty false
```

Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/ui/components/ConnectionPanelMain.tsx src/app/MachineService.ts tests/machine-control-v2-wcs-cutover.test.ts
git commit -m "feat(machine-control): route WCS reset through v2 intent gate"
```

Repeat this exact one-button cutover for jog, pause, resume, stop, test fire, frame, unlock, home, and start. Start is last.

## Final Verification Before Deleting Old Code

Run:

```bash
npx tsc --noEmit --pretty false
npm run test:output
npm run build
npx eslint . --max-warnings 0
npm test
```

Then run hardware validation with a low-power GRBL machine:

1. connect
2. settings refresh
3. jog X/Y small steps
4. WCS reset to baseline
5. frame
6. test fire
7. start tiny vector job
8. pause
9. resume
10. stop
11. emergency stop
12. alarm/unlock
13. large spool-backed job

Only after all v2 controls pass transcript tests and hardware validation should the old controller paths be deleted.

## Self-Review

- Spec coverage: The plan covers controller settings, start, pause, resume, stop, jog, WCS reset, test fire, frame, unlock, homing, streaming, profiles, and UI button gating.
- Placeholder scan: The plan avoids blank "TBD" items and gives concrete files, tests, commands, and implementation snippets for the first seven foundation tasks.
- Type consistency: Types introduced in early tasks are reused by later tasks with the same names.

