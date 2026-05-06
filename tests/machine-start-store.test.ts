import {
  createMachineStartStore,
  getSavedOriginStorageKey,
  getStartModeStorageKey,
  machineStartInitialState,
} from '../src/ui/stores/machineStartStore';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

{
  const store = createMachineStartStore({
    initialStartMode: 'current',
    initialSavedOrigin: { x: 12.4, y: 98.6 },
  });

  assert(store.getState().profileRevision === 0, 'profile revision starts at zero');
  assert(store.getState().startMode === 'current', 'start mode uses configured initial value');
  assert(store.getState().savedOrigin?.x === 12.4, 'saved origin x uses configured initial value');
  assert(store.getState().savedOrigin?.y === 98.6, 'saved origin y uses configured initial value');
}

{
  const store = createMachineStartStore({
    initialStartMode: 'absolute',
    initialSavedOrigin: null,
  });

  store.getState().bumpProfileRevision();
  store.getState().bumpProfileRevision();
  assert(store.getState().profileRevision === 2, 'profile revision increments');

  store.getState().setStartMode('savedOrigin');
  assert(store.getState().startMode === 'savedOrigin', 'start mode setter updates state');

  const origin = { x: 10, y: 20 };
  store.getState().setSavedOrigin(origin);
  assert(store.getState().savedOrigin?.x === 10, 'saved origin setter updates x');
  assert(store.getState().savedOrigin?.y === 20, 'saved origin setter updates y');
  assert(store.getState().savedOrigin !== origin, 'saved origin setter snapshots caller object');

  origin.x = 999;
  assert(store.getState().savedOrigin?.x === 10, 'saved origin snapshot resists caller mutation');

  store.getState().clearSavedOrigin();
  assert(store.getState().savedOrigin === null, 'clearSavedOrigin removes saved origin');
}

{
  const store = createMachineStartStore({
    initialStartMode: 'current',
    initialSavedOrigin: null,
  });

  store.getState().resetCurrentModeAfterDisconnect();
  assert(store.getState().startMode === 'absolute', 'disconnect reset returns current mode to absolute');

  store.getState().setStartMode('savedOrigin');
  store.getState().resetCurrentModeAfterDisconnect();
  assert(store.getState().startMode === 'savedOrigin', 'disconnect reset leaves saved-origin mode alone');
}

{
  assert(machineStartInitialState.profileRevision === 0, 'static profile revision starts at zero');
  assert(machineStartInitialState.startMode === 'absolute', 'static start mode starts absolute');
  assert(machineStartInitialState.savedOrigin === null, 'static saved origin starts empty');
  assert(getStartModeStorageKey() === 'laserforge_start_mode', 'start-mode storage key is stable');
  assert(getSavedOriginStorageKey() === 'laserforge_saved_origin', 'saved-origin storage key is stable');
}
