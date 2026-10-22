import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INCIDENT_AT,
  SAFETY_NOTICE,
  incidentEntry,
  incidentHistory,
  resetIncidentState,
  seedIncidentHistory,
} from '../../__fixtures__/controller-incidents';
import { classifyResponse, settingsMapToRows } from '../../core/controllers/grbl';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { useLaserStore } from '../state/laser-store';
import { useToastStore } from '../state/toast-store';
import { clearRendererProblems } from './renderer-problems';
import { saveSupportReport } from './save-support-report';

const SAVED_AT = new Date('2026-10-07T09:00:00.000Z');

function platform(cancelled = false, desktopLog = 'Local desktop log.') {
  const written: string[] = [];
  const calls: string[] = [];
  const target: SaveTarget = {
    displayName: 'd1-local-support-report.txt',
    write: async (data) => {
      calls.push('write');
      written.push(typeof data === 'string' ? data : await data.text());
    },
  };
  const readSupportLog = vi.fn(async () => {
    calls.push('log');
    return desktopLog;
  });
  const adapter: PlatformAdapter = {
    id: 'electron',
    pickFilesForOpen: async () => [],
    pickFileForSave: vi.fn(async () => {
      calls.push('pick');
      return cancelled ? null : target;
    }),
    readSupportLog,
    serial: { isSupported: () => true, requestPort: async () => null },
  };
  return { adapter, calls, written, readSupportLog };
}

beforeEach(() => {
  resetIncidentState();
  clearRendererProblems();
  useToastStore.setState({ toasts: [] });
});
afterEach(() => {
  resetIncidentState();
  clearRendererProblems();
  useToastStore.setState({ toasts: [] });
  vi.restoreAllMocks();
});

describe('D1 local support-report incident evidence', () => {
  it('saves retained incidents when rolling console and current fault fields no longer contain them', async () => {
    const retained = [
      incidentEntry(1, { raw: 'ALARM:2', decoded: 'Retained alarm diagnosis' }),
      incidentEntry(2, { kind: 'error', raw: 'error:20', decoded: 'Retained error diagnosis' }),
      incidentEntry(3, {
        kind: 'blocked',
        direction: 'system',
        source: 'system',
        raw: 'Connect before sending a command.',
      }),
      incidentEntry(4, {
        kind: 'disconnect',
        direction: 'system',
        source: 'system',
        raw: 'USB connection lost.',
      }),
    ];
    seedIncidentHistory(retained, {
      log: Array.from({ length: 200 }, (_, i) => `ok-${i}`),
      transcript: [],
      connection: { kind: 'connected' },
      lastError: null,
      alarmCode: null,
    });
    const h = platform();
    await saveSupportReport(h.adapter, () => SAVED_AT);
    expect(h.calls).toEqual(['pick', 'log', 'write']);
    const report = h.written[0] ?? '';
    for (const entry of retained) {
      expect(report).toContain(new Date(entry.at).toISOString());
      expect(report).toContain(entry.raw);
      if (entry.decoded !== undefined) expect(report).toContain(entry.decoded);
    }
    expect(incidentHistory()).toEqual(retained);
    expect(report).toContain('Connection: connected');
    expect(report).toContain('ok-199');
  });

  it('escapes incident delimiters and applies report licence-key redaction to their raw and decoded text', async () => {
    const retained = incidentEntry(1, {
      kind: 'error',
      raw: 'error:20\tKD1.audit.secret\nport',
      decoded: 'Detail KD1.other.secret',
    });
    seedIncidentHistory([retained]);
    const h = platform();
    await saveSupportReport(h.adapter, () => SAVED_AT);
    const report = h.written[0] ?? '';
    expect(report).toContain(new Date(retained.at).toISOString());
    expect(report).toContain('error:20\\tKD1.[licence key removed]\\nport');
    expect(report).toContain('Detail KD1.[licence key removed]');
    expect(report).not.toContain('KD1.audit.secret');
    expect(report).not.toContain('KD1.other.secret');
  });

  // Audit 27-P2-3: grblHAL prints its password settings in `$$` unless its WebUI
  // is connected, and the console, incidents and desktop log repeat the wire.
  it('removes controller passwords and sign-ins from every section', async () => {
    const dump = [
      '$32=1',
      '$75=sta pw 75',
      '$77=ap-pw-77',
      '$330=admin-pw-330',
      '$331=user-pw-331',
      '$533=mqtt-pw-533',
      '$750=5',
    ];
    const settings = new Map<number, string>();
    for (const line of dump) {
      const response = classifyResponse(line);
      if (response.kind === 'setting') settings.set(response.id, response.value);
    }
    seedIncidentHistory([incidentEntry(1, { kind: 'error', raw: '$533=mqtt-pw-533\r\nerror:9' })], {
      grblSettingsRows: settingsMapToRows(settings),
      lastSettingsReadAt: SAVED_AT.getTime(),
      log: [
        ...dump.map((line) => `< ${line}`),
        '> $Sta/Password=fluid sta pw',
        '> $AP/Password=fluid-ap-pw',
        '> [ESP101]esp-sta-pw',
      ],
    });
    const h = platform(
      false,
      'WARN camera rtsp://cam:cam@pw@10.0.0.9/live failed\nINFO GET /lic?token=tok-123&page=2',
    );
    await saveSupportReport(h.adapter, () => SAVED_AT);
    const report = h.written[0] ?? '';
    for (const secret of ['pw 75', 'pw-77', 'pw-330', 'pw-331', 'pw-533', 'sta pw', 'ap-pw'])
      expect(report).not.toContain(secret);
    for (const secret of ['esp-sta-pw', 'cam:cam', 'tok-123']) expect(report).not.toContain(secret);
    expect(report).toContain('$75=[password removed]\n$77=[password removed]');
    expect(report).toContain('< $331=[password removed]');
    expect(report).toContain('$533=[password removed]\\r\\nerror:9');
    expect(report).toContain('> $Sta/Password=[password removed]');
    expect(report).toContain('> [ESP101][password removed]');
    expect(report).toContain('rtsp://[sign-in removed]@10.0.0.9/live failed');
    expect(report).toContain('token=[removed]&page=2');
    expect(report).toContain('$32=1');
    expect(report).toContain('$750=5');
  });

  it('export never acknowledges the outstanding SafetyNotice or deletes retained incidents', async () => {
    const retained = incidentEntry(1);
    seedIncidentHistory([retained], { safetyNotice: SAFETY_NOTICE });
    const h = platform();
    await saveSupportReport(h.adapter, () => SAVED_AT);
    expect(h.written).toHaveLength(1);
    expect(incidentHistory()).toEqual([retained]);
    expect(useLaserStore.getState().safetyNotice).toEqual(SAFETY_NOTICE);
  });

  it('cancelled save gathers nothing and leaves incidents and SafetyNotice intact', async () => {
    const retained = incidentEntry(1, { at: INCIDENT_AT });
    seedIncidentHistory([retained], { safetyNotice: SAFETY_NOTICE });
    const h = platform(true);
    await saveSupportReport(h.adapter, () => SAVED_AT);
    expect(h.calls).toEqual(['pick']);
    expect(h.readSupportLog).not.toHaveBeenCalled();
    expect(h.written).toEqual([]);
    expect(incidentHistory()).toEqual([retained]);
    expect(useLaserStore.getState().safetyNotice).toEqual(SAFETY_NOTICE);
    expect(useToastStore.getState().toasts).toEqual([]);
  });

  it('preserves the existing newest-100 console limit when no incidents exist', async () => {
    seedIncidentHistory([], { log: Array.from({ length: 200 }, (_, i) => `D1-console-${i}-end`) });
    const h = platform();
    await saveSupportReport(h.adapter, () => SAVED_AT);
    const report = h.written[0] ?? '';
    expect(report).toContain('D1-console-100-end');
    expect(report).toContain('D1-console-199-end');
    expect(report).not.toContain('D1-console-99-end');
    expect(report).toContain('Local desktop log.');
    expect(incidentHistory()).toEqual([]);
  });
});
