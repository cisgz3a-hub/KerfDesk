import {
  appSettingsInitialState,
  createAppSettingsStore,
  getProductionModeStorageKey,
  getUserModeStorageKey,
} from '../src/ui/stores/appSettingsStore';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const store = createAppSettingsStore({ initialProductionMode: false });
  assert(store.getState().productionMode === false, 'production mode starts false');
  assert(store.getState().userMode === 'beginner', 'user mode starts beginner by default');
  store.getState().setProductionMode(true);
  assert(store.getState().productionMode === true, 'production mode turns on');
  store.getState().setUserMode('advanced');
  assert(store.getState().userMode === 'advanced', 'user mode turns advanced');
  store.getState().setUserMode('beginner');
  assert(store.getState().userMode === 'beginner', 'user mode turns beginner');
  store.getState().setProductionMode(false);
  assert(store.getState().productionMode === false, 'production mode turns off');
  store.getState().setUserMode('advanced');
  store.getState().resetSettings();
  assert(store.getState().productionMode === false, 'production mode resets to configured default');
  assert(store.getState().userMode === 'beginner', 'user mode resets to configured default');
}

{
  const store = createAppSettingsStore({ initialProductionMode: true, initialUserMode: 'advanced' });
  assert(store.getState().productionMode === true, 'production mode can start true');
  assert(store.getState().userMode === 'advanced', 'user mode can start advanced');
  store.getState().setProductionMode(false);
  store.getState().setUserMode('beginner');
  store.getState().resetSettings();
  assert(store.getState().productionMode === true, 'reset preserves configured default');
  assert(store.getState().userMode === 'advanced', 'reset preserves configured user mode default');
}

{
  assert(appSettingsInitialState.productionMode === false, 'static initial production mode is false');
  assert(appSettingsInitialState.userMode === 'beginner', 'static initial user mode is beginner');
  assert(getProductionModeStorageKey() === 'laserforge_production_mode', 'storage key is stable');
  assert(getUserModeStorageKey() === 'laserforge_user_mode', 'user mode storage key is stable');
}
