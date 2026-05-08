import {
  computeUserModeGatePolicy,
  getDefaultUserMode,
  getUserModeStorageKey,
  isUserMode,
  type UserMode,
} from '../src/app/UserModeGates';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  assert(getDefaultUserMode() === 'beginner', 'new users default to beginner mode');
  assert(getUserModeStorageKey() === 'laserforge_user_mode', 'user mode storage key is stable');
  assert(isUserMode('beginner'), 'beginner is a valid user mode');
  assert(isUserMode('advanced'), 'advanced is a valid user mode');
  assert(!isUserMode('production'), 'production is not a user mode');
  assert(!isUserMode(null), 'null is not a user mode');
}

{
  const beginner = computeUserModeGatePolicy('beginner');
  assert(beginner.requireFrameBeforeStart === false, 'beginner mode recommends framing without blocking start');
  assert(beginner.allowStartWithoutFraming === true, 'beginner mode can start without framing when other gates are safe');
  assert(beginner.startWithoutFramingLabel === 'Start without framing', 'beginner mode exposes explicit unframed-start label');
  assert(beginner.requireProfileConfirmationOnConnect === true, 'beginner mode requires profile confirmation');
  assert(beginner.requireMaterialSafetyChecklist === true, 'beginner mode requires material safety checks');
  assert(beginner.showProductionConsole === false, 'beginner mode hides production console');
  assert(beginner.showManualGcodeSend === false, 'beginner mode hides raw manual G-code send');
  assert(beginner.showGcodeTemplateEditing === false, 'beginner mode hides G-code template editing');
  assert(beginner.maxTestFireDeadmanMs === 5000, 'beginner test-fire deadman is fixed at 5 seconds');
  assert(beginner.recoveryCardsDismissable === false, 'beginner recovery cards stay prominent');
  assert(beginner.guidedSetupSkippable === false, 'beginner setup is not skippable by policy');
}

{
  const advanced = computeUserModeGatePolicy('advanced');
  assert(advanced.requireFrameBeforeStart === false, 'advanced mode does not require framing before start');
  assert(advanced.allowStartWithoutFraming === true, 'advanced mode can explicitly start without framing');
  assert(advanced.startWithoutFramingLabel === 'Start without framing', 'advanced mode exposes explicit override label');
  assert(advanced.requireProfileConfirmationOnConnect === false, 'advanced mode can use cached profile confirmation');
  assert(advanced.requireMaterialSafetyChecklist === false, 'advanced mode makes material safety checks optional');
  assert(advanced.showProductionConsole === true, 'advanced mode shows production console');
  assert(advanced.showManualGcodeSend === true, 'advanced mode shows raw manual G-code send');
  assert(advanced.showGcodeTemplateEditing === true, 'advanced mode shows G-code template editing');
  assert(advanced.maxTestFireDeadmanMs === 30000, 'advanced test-fire deadman can extend to 30 seconds');
  assert(advanced.recoveryCardsDismissable === true, 'advanced recovery cards are dismissable');
  assert(advanced.guidedSetupSkippable === true, 'advanced setup is skippable by policy');
}

{
  const roundTrip: UserMode[] = ['beginner', 'advanced'];
  assert(roundTrip.map(mode => computeUserModeGatePolicy(mode).mode).join(',') === 'beginner,advanced',
    'policy preserves requested mode');
}
