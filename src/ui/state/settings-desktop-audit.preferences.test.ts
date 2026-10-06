import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.resetModules();
});

describe('desktop preference persistence regressions', () => {
  it('reports session-only choices and retries all current values before restart', async () => {
    const theme = await import('../theme/app-theme');
    const layout = await import('./workspace-layout-store');
    const nudge = await import('./nudge-preferences');
    const ui = await import('./ui-store');
    const labs = await import('./experimental-laser-features');
    const toast = await import('./toast-store');
    const persistence = await import('./preference-persistence');
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Synthetic storage quota boundary', 'QuotaExceededError');
    });

    theme.setAppThemePreference('dark');
    layout.useWorkspaceLayoutStore.getState().setPreference('spacious');
    nudge.useNudgeStore.getState().setNudgeSteps({ normalMm: 7 });
    ui.useUiStore.getState().setSnapSettings({ enabled: false, gridMm: 3.7 });
    ui.useUiStore.getState().setShowCanvasStartMarkers(false);
    labs.useExperimentalLaserFeatures.getState().setFeature('lowPowerFire', true);

    expect(theme.appThemePreference()).toBe('dark');
    expect(layout.useWorkspaceLayoutStore.getState().preference).toBe('spacious');
    expect(nudge.useNudgeStore.getState().nudgeSteps.normalMm).toBe(7);
    expect(ui.useUiStore.getState().snapSettings).toMatchObject({ enabled: false, gridMm: 3.7 });
    expect(ui.useUiStore.getState().showCanvasStartMarkers).toBe(false);
    expect(labs.useExperimentalLaserFeatures.getState().features.lowPowerFire).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(6);
    expect(toast.useToastStore.getState().toasts).toMatchObject([
      { message: persistence.PREFERENCE_SAVE_WARNING, variant: 'warning' },
    ]);
    expect(persistence.usePreferencePersistenceStore.getState().pending.size).toBe(6);
    expect(localStorage.length).toBe(0);

    setItem.mockRestore();
    persistence.retryComputerPreferences();
    expect(persistence.usePreferencePersistenceStore.getState().pending.size).toBe(0);
    vi.resetModules();
    const restartedTheme = await import('../theme/app-theme');
    const restartedLayout = await import('./workspace-layout-store');
    const restartedNudge = await import('./nudge-preferences');
    const restartedUi = await import('./ui-store');
    const restartedLabs = await import('./experimental-laser-features');
    expect(restartedTheme.appThemePreference()).toBe('dark');
    expect(restartedLayout.useWorkspaceLayoutStore.getState().preference).toBe('spacious');
    expect(restartedNudge.useNudgeStore.getState().nudgeSteps.normalMm).toBe(7);
    expect(restartedUi.useUiStore.getState().snapSettings).toMatchObject({
      enabled: false,
      gridMm: 3.7,
    });
    expect(restartedUi.useUiStore.getState().showCanvasStartMarkers).toBe(false);
    expect(restartedLabs.useExperimentalLaserFeatures.getState().features.lowPowerFire).toBe(true);
  });

  it('reloads preferences on a fresh document without changing another document live', async () => {
    const theme = await import('../theme/app-theme');
    const layout = await import('./workspace-layout-store');
    const nudge = await import('./nudge-preferences');
    const ui = await import('./ui-store');
    expect(theme.appThemePreference()).toBe('light');

    const writes: readonly [string, string][] = [
      ['kerfdesk.theme.v1', 'dark'],
      [layout.WORKSPACE_LAYOUT_STORAGE_KEY, 'spacious'],
      [nudge.NUDGE_STEPS_KEY, '{"fineMm":0.2,"normalMm":7,"largeMm":12}'],
      ['laserforge.snap-settings.v1', '{"enabled":false,"gridMm":3.7}'],
      ['laserforge.canvas-start-markers.v1', '0'],
    ];
    for (const [key, newValue] of writes) {
      localStorage.setItem(key, newValue);
      window.dispatchEvent(
        new StorageEvent('storage', { key, newValue, storageArea: localStorage }),
      );
    }

    expect(theme.appThemePreference()).toBe('light');
    expect(layout.useWorkspaceLayoutStore.getState().preference).toBe('auto');
    expect(nudge.useNudgeStore.getState().nudgeSteps.normalMm).toBe(1);
    expect(ui.useUiStore.getState().snapSettings.enabled).toBe(true);
    expect(ui.useUiStore.getState().showCanvasStartMarkers).toBe(true);

    vi.resetModules();
    expect((await import('../theme/app-theme')).appThemePreference()).toBe('dark');
    expect(
      (await import('./workspace-layout-store')).useWorkspaceLayoutStore.getState().preference,
    ).toBe('spacious');
    expect((await import('./nudge-preferences')).useNudgeStore.getState().nudgeSteps.normalMm).toBe(
      7,
    );
    expect((await import('./ui-store')).useUiStore.getState().snapSettings.enabled).toBe(false);
    expect((await import('./ui-store')).useUiStore.getState().showCanvasStartMarkers).toBe(false);
  });

  it('repairs corrupt fields individually and clamps finite out-of-range distances', async () => {
    const { normalizeNudgeSteps, readNudgeSteps } = await import('./nudge-preferences');
    const { normalizeSnapSettings } = await import('../workspace/snap-settings');
    expect(normalizeNudgeSteps({ fineMm: 0, normalMm: '7', largeMm: 5000 })).toEqual({
      fineMm: 0.01,
      normalMm: 1,
      largeMm: 1000,
    });
    expect(normalizeNudgeSteps({ fineMm: Infinity, normalMm: NaN, largeMm: 13 })).toEqual({
      fineMm: 0.1,
      normalMm: 1,
      largeMm: 13,
    });
    expect(readNudgeSteps({ getItem: () => '{incomplete', setItem: vi.fn() })).toEqual({
      fineMm: 0.1,
      normalMm: 1,
      largeMm: 10,
    });
    expect(
      normalizeSnapSettings({ enabled: false, snapToGrid: 'false', gridMm: 5000, distancePx: 0 }),
    ).toMatchObject({ enabled: false, snapToGrid: true, gridMm: 1000, distancePx: 1 });
  });

  it('keeps settings usable when even the localStorage property getter is denied', async () => {
    vi.spyOn(globalThis, 'localStorage', 'get').mockImplementation(() => {
      throw new DOMException('Synthetic denied storage getter', 'SecurityError');
    });
    const theme = await import('../theme/app-theme');
    const layout = await import('./workspace-layout-store');
    const nudge = await import('./nudge-preferences');
    const ui = await import('./ui-store');
    const labs = await import('./experimental-laser-features');
    expect(theme.appThemePreference()).toBe('light');
    expect(() => theme.setAppThemePreference('dark')).not.toThrow();
    expect(() => layout.useWorkspaceLayoutStore.getState().setPreference('compact')).not.toThrow();
    expect(() => nudge.useNudgeStore.getState().setNudgeSteps({ largeMm: 33 })).not.toThrow();
    expect(() => ui.useUiStore.getState().setSnapSettings({ enabled: false })).not.toThrow();
    expect(() => ui.useUiStore.getState().setShowCanvasStartMarkers(false)).not.toThrow();
    expect(() =>
      labs.useExperimentalLaserFeatures.getState().setFeature('printAndCut', true),
    ).not.toThrow();
    expect(theme.appThemePreference()).toBe('dark');
  });

  it.each([
    [
      'RTSP',
      'laserforge.camera.rtspUrl.v1',
      'rtsp://audit-user:audit-password@192.0.2.10:554/live',
    ],
    [
      'phone',
      'laserforge.camera.phone.v1',
      '{"app":"other","address":"https://audit-user:audit-password@192.0.2.10/video"}',
    ],
  ] as const)(
    'keeps a sanitized readable %s camera preference when cleanup cannot be saved',
    async (kind, key, value) => {
      localStorage.setItem(key, value);
      const camera = await import('./camera-preference-storage');
      const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('Synthetic read-only preference migration', 'QuotaExceededError');
      });
      const readable = kind === 'RTSP' ? camera.loadRtspCameraUrl() : camera.loadPhoneCamera();
      expect(readable).toEqual(
        kind === 'RTSP'
          ? 'rtsp://192.0.2.10:554/live'
          : { app: 'other', address: 'https://192.0.2.10/video' },
      );
      expect(JSON.stringify(readable)).not.toContain('audit-password');
      expect(localStorage.getItem(key)).toBe(value);
      setItem.mockRestore();
      const restored = kind === 'RTSP' ? camera.loadRtspCameraUrl() : camera.loadPhoneCamera();
      expect(restored).not.toBeNull();
      expect(JSON.stringify(restored)).not.toContain('audit-password');
    },
  );

  it('defers history trimming until the limit is saved and retries after storage recovers', async () => {
    localStorage.setItem('kerfdesk.recent-projects.limit.v1', '24');
    const { createMemoryRecentProjectStorage } =
      await import('../recent-projects/recent-project-storage');
    const recent = await import('../recent-projects/recent-projects-store');
    const persistence = await import('./preference-persistence');
    const entries = [1, 2, 3].map((number) => ({
      id: String(number),
      name: `${number}.lf2`,
      ref: null,
      pinned: false,
      lastUsedAt: number,
    }));
    const storage = createMemoryRecentProjectStorage(entries);
    recent.configureRecentProjectsForTests(storage);
    await recent.useRecentProjectsStore.getState().refresh();
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('Synthetic full preference storage');
    });
    await recent.useRecentProjectsStore.getState().setLimit(1);
    expect(recent.useRecentProjectsStore.getState().limit).toBe(1);
    expect((await storage.load()).map((entry) => entry.id)).toEqual(['1', '2', '3']);
    expect(localStorage.getItem('kerfdesk.recent-projects.limit.v1')).toBe('24');
    await recent.useRecentProjectsStore.getState().refresh();
    expect(recent.useRecentProjectsStore.getState().limit).toBe(1);
    expect(recent.useRecentProjectsStore.getState().entries).toHaveLength(3);
    await recent.useRecentProjectsStore.getState().record(
      {
        open: async () => ({ kind: 'missing' }),
        probe: async () => ({ kind: 'unknown' }),
        isSameFile: async () => false,
      },
      { name: '4.lf2', ref: null },
    );
    expect((await storage.load()).map((entry) => entry.name)).toHaveLength(4);
    denied.mockRestore();
    persistence.retryComputerPreferences();
    await recent.useRecentProjectsStore.getState().refresh();
    expect(localStorage.getItem('kerfdesk.recent-projects.limit.v1')).toBe('1');
    expect(recent.useRecentProjectsStore.getState().limit).toBe(1);
    expect(recent.useRecentProjectsStore.getState().entries).toHaveLength(1);
    expect(recent.useRecentProjectsStore.getState().entries[0]?.name).toBe('4.lf2');
    expect(persistence.usePreferencePersistenceStore.getState().pending.size).toBe(0);
  });

  it('retries unchanged nudge and snap values after their failed saves', async () => {
    const nudge = await import('./nudge-preferences');
    const ui = await import('./ui-store');
    const denied = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Synthetic temporary quota refusal', 'QuotaExceededError');
    });
    nudge.useNudgeStore.getState().setNudgeSteps({ normalMm: 7 });
    ui.useUiStore.getState().setSnapSettings({ gridMm: 3.7 });
    expect(denied).toHaveBeenCalledTimes(2);
    denied.mockRestore();
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    nudge.useNudgeStore.getState().setNudgeSteps({ normalMm: 7 });
    ui.useUiStore.getState().setSnapSettings({ gridMm: 3.7 });
    expect(writes).toHaveBeenCalledTimes(2);
    expect(nudge.readNudgeSteps().normalMm).toBe(7);
    expect((await import('./snap-preferences')).readSnapSettings().gridMm).toBe(3.7);
  });
});
