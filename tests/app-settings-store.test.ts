import {
  appSettingsInitialState,
  createAppSettingsStore,
  getProductionModeStorageKey,
} from '../src/ui/stores/appSettingsStore';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const store = createAppSettingsStore({ initialProductionMode: false });
  assert(store.getState().productionMode === false, 'production mode starts false');
  store.getState().setProductionMode(true);
  assert(store.getState().productionMode === true, 'production mode turns on');
  store.getState().setProductionMode(false);
  assert(store.getState().productionMode === false, 'production mode turns off');
  store.getState().resetSettings();
  assert(store.getState().productionMode === false, 'production mode resets to configured default');
}

{
  const store = createAppSettingsStore({ initialProductionMode: true });
  assert(store.getState().productionMode === true, 'production mode can start true');
  store.getState().setProductionMode(false);
  store.getState().resetSettings();
  assert(store.getState().productionMode === true, 'reset preserves configured default');
}

{
  assert(appSettingsInitialState.productionMode === false, 'static initial production mode is false');
  assert(getProductionModeStorageKey() === 'laserforge_production_mode', 'storage key is stable');
}
