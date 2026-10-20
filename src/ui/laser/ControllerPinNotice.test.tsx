// ADR-644 (protocol audit P-6): a pressed E-stop or a motor fault from the
// `Pn:` field shows on the machine rail even before an alarm explains it.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { ControllerPinNotice } from './ControllerPinNotice';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function noticeFor(report: string): string | null {
  act(() => useLaserStore.setState({ statusReport: parseStatusReport(report) }));
  act(() => root.render(<ControllerPinNotice />));
  return host.querySelector('[role="status"]')?.textContent ?? null;
}

beforeEach(() => {
  useLaserStore.setState(initialLaserState());
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState(initialLaserState());
});

describe('ControllerPinNotice', () => {
  it('names a pressed E-stop and a motor fault', () => {
    expect(noticeFor('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:E>')).toBe(
      'The controller reports its E-stop pressed.',
    );
    expect(noticeFor('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:F>')).toBe(
      'The controller reports a motor fault.',
    );
    expect(noticeFor('<Alarm:10|MPos:0.000,0.000,0.000|FS:0,0|Pn:EF>')).toBe(
      'The controller reports its E-stop pressed and a motor fault.',
    );
  });

  it('shows nothing for other pins, a motor warning alone, or no report', () => {
    expect(noticeFor('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:XPD>')).toBeNull();
    expect(noticeFor('<Idle|MPos:0.000,0.000,0.000|FS:0,0|Pn:M>')).toBeNull();
    expect(noticeFor('<Idle|MPos:0.000,0.000,0.000|FS:0,0>')).toBeNull();
  });
});
