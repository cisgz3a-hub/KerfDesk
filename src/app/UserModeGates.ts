export type UserMode = 'beginner' | 'advanced';

export interface UserModeGatePolicy {
  readonly mode: UserMode;
  readonly requireFrameBeforeStart: boolean;
  readonly allowStartWithoutFraming: boolean;
  readonly startWithoutFramingLabel: string | null;
  readonly requireProfileConfirmationOnConnect: boolean;
  readonly requireMaterialSafetyChecklist: boolean;
  readonly showProductionConsole: boolean;
  readonly showManualGcodeSend: boolean;
  readonly showGcodeTemplateEditing: boolean;
  readonly maxTestFireDeadmanMs: number;
  readonly recoveryCardsDismissable: boolean;
  readonly guidedSetupSkippable: boolean;
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
      requireProfileConfirmationOnConnect: false,
      requireMaterialSafetyChecklist: false,
      showProductionConsole: true,
      showManualGcodeSend: true,
      showGcodeTemplateEditing: true,
      maxTestFireDeadmanMs: 30_000,
      recoveryCardsDismissable: true,
      guidedSetupSkippable: true,
    };
  }

  return {
    mode,
    requireFrameBeforeStart: true,
    allowStartWithoutFraming: false,
    startWithoutFramingLabel: null,
    requireProfileConfirmationOnConnect: true,
    requireMaterialSafetyChecklist: true,
    showProductionConsole: false,
    showManualGcodeSend: false,
    showGcodeTemplateEditing: false,
    maxTestFireDeadmanMs: 5_000,
    recoveryCardsDismissable: false,
    guidedSetupSkippable: false,
  };
}
