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
  assert(beginner.requireFrameBeforeStart === true, 'beginner mode requires a fresh frame before start');
  assert(beginner.allowStartWithoutFraming === false, 'beginner mode cannot start without framing');
  assert(beginner.startWithoutFramingLabel === null, 'beginner mode does not expose an unframed-start label');
  assert(beginner.showProductionConsole === false, 'beginner mode hides production console');
  assert(beginner.showManualGcodeSend === false, 'beginner mode hides raw manual G-code send');
}

{
  const advanced = computeUserModeGatePolicy('advanced');
  assert(advanced.requireFrameBeforeStart === false, 'advanced mode does not require framing before start');
  assert(advanced.allowStartWithoutFraming === true, 'advanced mode can explicitly start without framing');
  assert(advanced.startWithoutFramingLabel === 'Start without framing', 'advanced mode exposes explicit override label');
  assert(advanced.showProductionConsole === true, 'advanced mode shows production console');
  assert(advanced.showManualGcodeSend === true, 'advanced mode shows raw manual G-code send');
}

{
  const roundTrip: UserMode[] = ['beginner', 'advanced'];
  assert(roundTrip.map(mode => computeUserModeGatePolicy(mode).mode).join(',') === 'beginner,advanced',
    'policy preserves requested mode');
}
