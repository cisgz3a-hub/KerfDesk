export type UserMode = 'beginner' | 'advanced';

export interface UserModeGatePolicy {
  readonly mode: UserMode;
  readonly requireFrameBeforeStart: boolean;
  readonly allowStartWithoutFraming: boolean;
  readonly startWithoutFramingLabel: string | null;
  readonly showProductionConsole: boolean;
  readonly showManualGcodeSend: boolean;
}

export function getDefaultUserMode(): UserMode {
  return 'beginner';
}

export function getUserModeStorageKey(): string {
  return 'laserforge_user_mode';
}

export function isUserMode(value: unknown): value is UserMode {
  return value === 'beginner' || value === 'advanced';
}

export function computeUserModeGatePolicy(mode: UserMode): UserModeGatePolicy {
  if (mode === 'advanced') {
    return {
      mode,
      requireFrameBeforeStart: false,
      allowStartWithoutFraming: true,
      startWithoutFramingLabel: 'Start without framing',
      showProductionConsole: true,
      showManualGcodeSend: true,
    };
  }

  return {
    mode,
    requireFrameBeforeStart: true,
    allowStartWithoutFraming: false,
    startWithoutFramingLabel: null,
    showProductionConsole: false,
    showManualGcodeSend: false,
  };
}
