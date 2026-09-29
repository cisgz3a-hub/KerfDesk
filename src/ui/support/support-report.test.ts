import { describe, expect, it } from 'vitest';
import type { LicenceStatus } from '../../platform/types';
import { UNRESTRICTED_EDITION, type EditionValue } from '../licensing/edition';
import {
  describeEdition,
  formatSupportReport,
  machineReportLines,
  type MachineReportInput,
  type SupportReportFacts,
} from './support-report';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 8, 29, 7, 12);

const MACHINE: MachineReportInput = {
  device: {
    name: 'Falcon 2',
    vendor: 'Creality',
    model: 'CR-Laser Falcon 2 22W',
    controllerKind: 'grbl-v1.1',
    bedWidth: 400,
    bedHeight: 415,
  },
  machineKind: 'laser',
  connection: { kind: 'connected' },
  usb: { usbVendorId: 0x1a86, usbProductId: 0x7523 },
  detectedController: 'grbl-v1.1',
  qualification: 'ready (settings verified)',
  state: 'Alarm',
  alarmCode: 1,
  lastError: 9,
  resetRequired: false,
  machinePosition: { x: 0, y: 0, z: 0 },
  workPosition: { x: -12.5, y: 3, z: 0 },
  workOrigin: 'set (g54-persistent)',
  homing: 'unknown',
  jobRunning: false,
  firmwareLines: ['[VER:1.1h.20190825:]', '[OPT:V,15,128]'],
};

function facts(overrides: Partial<SupportReportFacts> = {}): SupportReportFacts {
  return {
    savedAt: new Date(NOW),
    build: { version: '0.9.1', commit: 'abc1234', builtAt: '2026-09-28T12:00:00Z' },
    app: 'electron',
    edition: 'KerfDesk Pro trial: trial ends 2026-10-29',
    system: {
      userAgent: 'Mozilla/5.0 KerfDesk/0.9.1 Electron/44.0.0',
      languages: ['en-ZA', 'af'],
      screen: '1920 × 1080 at 125% scale, window 1536 × 816',
      online: true,
    },
    machine: machineReportLines(MACHINE),
    machineSettings: { readAt: NOW - 60_000, lines: ['$0=10', '$32=1'] },
    machineConsole: ["< Grbl 1.1h ['$' for help]", '[lf2] Controller alarm: ALARM:1'],
    problems: [{ at: NOW - 5000, kind: 'error', message: 'TypeError: layer is undefined' }],
    desktopLog: {
      kind: 'read',
      text: '2026-09-29T07:00:00.000Z INFO  [app] KerfDesk 0.9.1 started.\n',
    },
    ...overrides,
  };
}

function status(overrides: Partial<LicenceStatus>): LicenceStatus {
  return {
    channel: 'commercial',
    edition: 'pro',
    state: 'ready',
    tier: 'paid',
    accessExpiresAt: null,
    updatesUntil: null,
    perpetualUpdates: false,
    licenseKey: 'KD1.lic_42.s3cr3t',
    deactivationPending: false,
    paymentPending: false,
    paymentOrderId: 'order-77',
    storeUnreadable: false,
    message: null,
    ...overrides,
  };
}

function edition(value: Partial<EditionValue>): EditionValue {
  return { ...UNRESTRICTED_EDITION, pro: false, ...value };
}

describe('support report text', () => {
  it('lists the version, computer, machine, problems and desktop log in order', () => {
    const text = formatSupportReport(facts());
    const headings = text.split('\n').filter((line) => line.startsWith('== '));
    expect(headings).toEqual([
      '== KerfDesk ==',
      '== Computer ==',
      '== Machine ==',
      '== Machine settings ($$), read 2026-09-29T07:11:00.000Z ==',
      '== Machine console, newest last ==',
      '== Problems in this window, newest last ==',
      '== Desktop log, newest last ==',
    ]);
    expect(text).toContain('Version: 0.9.1 (commit abc1234, built 2026-09-28T12:00:00Z)');
    expect(text).toContain('App: desktop app');
    expect(text).toContain('$32=1');
    expect(text).toContain('2026-09-29T07:11:55.000Z error: TypeError: layer is undefined');
    expect(text).toContain('INFO  [app] KerfDesk 0.9.1 started.');
    expect(text.endsWith('\n')).toBe(true);
  });

  it('never carries a licence key, wherever one turns up', () => {
    const text = formatSupportReport(
      facts({
        machineConsole: ['activate KD1.lic_42.s3cr3t'],
        problems: [{ at: NOW, kind: 'crash', message: 'Bad key KD1.lic_42.s3cr3t-Value' }],
      }),
    );
    expect(text).not.toMatch(/s3cr3t|lic_42/);
    expect(text).toContain('Bad key KD1.[licence key removed]');
  });

  it('shows the web app without a desktop log, and says what is empty', () => {
    const text = formatSupportReport(
      facts({
        app: 'web',
        machineSettings: { readAt: null, lines: [] },
        machineConsole: [],
        problems: [],
        desktopLog: { kind: 'none' },
      }),
    );
    expect(text).toContain('App: web app');
    expect(text).toContain('== Machine settings ($$) ==\nNot read.');
    expect(text).toContain('== Machine console, newest last ==\nEmpty.');
    expect(text).toContain('== Problems in this window, newest last ==\nNone.');
    expect(text).not.toContain('Desktop log');
  });

  it('says when the desktop log could not be read', () => {
    const text = formatSupportReport(
      facts({
        desktopLog: { kind: 'failed', message: 'The desktop log could not be read (404).' },
      }),
    );
    expect(text).toContain(
      '== Desktop log, newest last ==\nCould not be read: The desktop log could not be read (404).',
    );
  });
});

describe('support report edition', () => {
  it.each([
    [edition({ proInDesktop: true }), 'KerfDesk Free (Pro is in the desktop app)'],
    [UNRESTRICTED_EDITION, 'Every tool (sales have not opened)'],
    [
      edition({ status: status({ channel: 'free', edition: 'pro', tier: null }), pro: true }),
      'Every tool (a desktop build without licensing)',
    ],
    [
      edition({
        status: status({
          tier: 'trial',
          accessExpiresAt: NOW + 30 * DAY,
          updatesUntil: NOW + 30 * DAY,
        }),
      }),
      'KerfDesk Pro trial: trial ends 2026-10-29, updates until 2026-10-29',
    ],
    [
      edition({ status: status({ tier: 'developer', perpetualUpdates: true, updatesUntil: NOW }) }),
      'KerfDesk Pro (developer licence): updates for every version',
    ],
    [
      edition({
        status: status({
          edition: 'free',
          tier: 'trial',
          state: 'trial-expired',
          accessExpiresAt: NOW,
        }),
      }),
      'KerfDesk Free: trial ends 2026-09-29, licence state trial-expired',
    ],
    [
      edition({
        status: status({
          state: 'clock-error',
          storeUnreadable: true,
          message: 'Check the clock.',
        }),
      }),
      'KerfDesk Pro: licence state clock-error, saved licence unreadable, message "Check the clock."',
    ],
  ])('describes %#', (value, expected) => {
    expect(describeEdition(value)).toBe(expected);
  });

  it('never repeats the key or payment order', () => {
    const text = describeEdition(edition({ status: status({ paymentPending: true }) }));
    expect(text).toBe('KerfDesk Pro: payment pending');
  });
});

describe('support report machine', () => {
  it('summarises the profile, connection, state, position and firmware', () => {
    expect(machineReportLines(MACHINE)).toEqual([
      'Profile: Falcon 2 (Creality CR-Laser Falcon 2 22W), laser, grbl-v1.1, bed 400 × 415 mm',
      'Connection: connected (USB 1a86:7523)',
      'Controller: grbl-v1.1, ready (settings verified)',
      'State: Alarm, alarm 1, last error 9',
      'Position: machine X0.000 Y0.000 Z0.000, work X-12.500 Y3.000 Z0.000',
      'Origin: set (g54-persistent); homing unknown',
      'Job: none running',
      'Firmware: [VER:1.1h.20190825:] [OPT:V,15,128]',
    ]);
  });

  it('reports a failed connection before any status', () => {
    const lines = machineReportLines({
      ...MACHINE,
      device: { name: '4040 router', bedWidth: 400, bedHeight: 400, baudRate: 115200 },
      machineKind: 'cnc',
      connection: { kind: 'failed', error: 'The port is already open in another program.' },
      usb: null,
      detectedController: null,
      qualification: 'not checked',
      state: null,
      alarmCode: null,
      lastError: null,
      resetRequired: true,
      machinePosition: null,
      workPosition: null,
      firmwareLines: [],
    });
    expect(lines).toEqual([
      'Profile: 4040 router, CNC router, grbl-v1.1, bed 400 × 400 mm, 115200 baud',
      'Connection: failed: The port is already open in another program.',
      'Controller: not identified yet, not checked',
      'State: no status report yet, reset required',
      'Origin: set (g54-persistent); homing unknown',
      'Job: none running',
    ]);
  });
});
