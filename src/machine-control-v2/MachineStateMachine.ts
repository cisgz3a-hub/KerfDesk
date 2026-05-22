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
  disconnected: {
    connectRequested: 'connecting',
  },
  connecting: {
    connected: 'idle',
    connectFailed: 'fault',
    disconnectRequested: 'disconnected',
  },
  idle: {
    startRequested: 'preflight',
    jogRequested: 'jogging',
    frameRequested: 'framing',
    testFireRequested: 'testFiring',
    alarmReceived: 'alarm',
    disconnectRequested: 'disconnected',
  },
  jogging: {
    jogComplete: 'idle',
    cancelJogRequested: 'idle',
    alarmReceived: 'alarm',
  },
  framing: {
    frameComplete: 'idle',
    stopRequested: 'stopping',
    alarmReceived: 'alarm',
  },
  testFiring: {
    testFireComplete: 'idle',
    stopRequested: 'stopping',
    alarmReceived: 'alarm',
  },
  preflight: {
    preflightPassed: 'armed',
    preflightFailed: 'idle',
    stopRequested: 'stopping',
  },
  armed: {
    streamStarted: 'streaming',
    stopRequested: 'stopping',
  },
  streaming: {
    pauseRequested: 'hold',
    stopRequested: 'stopping',
    alarmReceived: 'alarm',
    streamComplete: 'idle',
  },
  hold: {
    resumeRequested: 'streaming',
    stopRequested: 'stopping',
    alarmReceived: 'alarm',
  },
  stopping: {
    safeStopConfirmed: 'idle',
    stopFailed: 'fault',
  },
  alarm: {
    operatorAcknowledged: 'recovering',
  },
  fault: {
    operatorAcknowledged: 'recovering',
    disconnectRequested: 'disconnected',
  },
  recovering: {
    recoveryComplete: 'idle',
    disconnectRequested: 'disconnected',
    recoveryFailed: 'fault',
  },
};

export function canTransition(from: MachineControlState, event: string): boolean {
  return Boolean(transitions[from]?.[event]);
}

export function transitionMachineState(
  from: MachineControlState,
  event: string,
): MachineControlState {
  const next = transitions[from]?.[event];
  if (!next) {
    throw new Error(`Illegal machine transition: ${from} + ${event}`);
  }
  return next;
}
