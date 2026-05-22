import {
  canTransition,
  transitionMachineState,
  type MachineControlState,
} from '../src/machine-control-v2/MachineStateMachine';

function mustTransition(
  from: MachineControlState,
  event: string,
  to: MachineControlState,
): void {
  const actual = transitionMachineState(from, event);
  if (actual !== to) {
    throw new Error(`${from} + ${event}: expected ${to}, got ${actual}`);
  }
}

function mustReject(from: MachineControlState, event: string): void {
  if (canTransition(from, event)) {
    throw new Error(`${from} + ${event} should be rejected`);
  }
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
