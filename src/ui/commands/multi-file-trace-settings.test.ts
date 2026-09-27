import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform } from '../../__fixtures__/file-actions';
import type { SceneObject } from '../../core/scene';
import type { TraceSettingsRecord } from '../../core/scene/scene-object';
import { TRACE_PRESETS } from '../../core/trace';
import { useStore } from '../state';
import { mergeLightBurnTraceSettings } from '../trace/trace-options';
import { restoreTraceSettings } from '../trace/trace-settings-snapshot';
import type * as multiFileTraceAction from './multi-file-trace-action';
import { runMultiFileTrace } from './multi-file-trace-action';
import { batchTraceSettings, lastTraceSettingsRecord } from './multi-file-trace-settings';
import { runChosenMultiFileTrace, type MultiFileTraceSettings } from './MultiFileTraceDialog';
import { DEFAULT_TRACE_PAGE_SETTINGS } from './TracePageFields';
import { DEFAULT_TRACE_SIZE_SETTINGS } from './TraceSizeFields';

vi.mock('./multi-file-trace-action', async (importOriginal) => ({
  ...(await importOriginal<typeof multiFileTraceAction>()),
  runMultiFileTrace: vi.fn(async () => undefined),
}));

const RECORD: TraceSettingsRecord = {
  schemaVersion: 1,
  presetName: 'Smooth',
  overrides: { turnPolicy: 'connect-ink', thresholdLuma: 90, smoothness: 1.5 },
  output: 'vector',
  fillStyle: 'scanline',
  boundary: { x: 1, y: 1, width: 2, height: 2 },
};

function traced(id: string, record?: TraceSettingsRecord): SceneObject {
  return {
    kind: 'traced-image',
    id,
    ...(record === undefined ? {} : { traceSettings: record }),
  } as unknown as SceneObject;
}

const SETTINGS: MultiFileTraceSettings = {
  settingsSource: 'last-trace',
  presetName: 'Line Art',
  format: 'svg',
  groupContours: false,
  precisionMm: 0.01,
  ...DEFAULT_TRACE_PAGE_SETTINGS,
  ...DEFAULT_TRACE_SIZE_SETTINGS,
};

afterEach(() => vi.mocked(runMultiFileTrace).mockClear());

describe('Multi-File Trace settings choice (rank 20)', () => {
  it('finds the newest trace that recorded its settings', () => {
    const older: TraceSettingsRecord = { ...RECORD, presetName: 'Sharp' };
    expect(lastTraceSettingsRecord([traced('a', older), traced('b', RECORD), traced('c')])).toBe(
      RECORD,
    );
    expect(lastTraceSettingsRecord([traced('c')])).toBeNull();
  });

  it('merges the last Trace Image settings exactly as the Trace dialog does', () => {
    const chosen = batchTraceSettings('last-trace', 'Line Art', RECORD);
    const restored = restoreTraceSettings(RECORD, { width: 1, height: 1 });
    const smooth = TRACE_PRESETS['Smooth'];
    if (smooth === undefined) throw new Error('No Smooth preset.');
    expect(chosen.options).toEqual(mergeLightBurnTraceSettings(smooth, restored.overrides ?? {}));
    expect(chosen.options?.turnPolicy).toBe('connect-ink');
    expect(chosen.presetName).toBe('Smooth');
    expect(chosen.label).toBe('the last Trace Image settings (Smooth, 3 adjusted)');
  });

  it('keeps preset defaults identical to the preset', () => {
    expect(batchTraceSettings('preset', 'Centerline', RECORD).options).toBe(
      TRACE_PRESETS['Centerline'],
    );
    // No recorded trace: the choice falls back to the preset.
    expect(batchTraceSettings('last-trace', 'Centerline', null).options).toBe(
      TRACE_PRESETS['Centerline'],
    );
  });

  it('passes the merged options and names them in the batch notice', async () => {
    const before = useStore.getState().project;
    useStore.setState({
      project: { ...before, scene: { ...before.scene, objects: [traced('t', RECORD)] } },
    });
    try {
      const file = new File([new Uint8Array([1])], 'a.png');
      await runChosenMultiFileTrace(mockPlatform(), vi.fn(), SETTINGS, [file]);
    } finally {
      useStore.setState({ project: before });
    }
    const deps = vi.mocked(runMultiFileTrace).mock.calls[0]?.[2];
    expect(deps?.options).toEqual(batchTraceSettings('last-trace', 'Line Art', RECORD).options);
    expect(deps?.settingsLabel).toBe('the last Trace Image settings (Smooth, 3 adjusted)');
  });
});
