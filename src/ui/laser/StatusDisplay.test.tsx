// GRBL sends WCO in only some status reports, so until the first one the
// origin is unknown; it may be a persistent G54 or a kept G92 offset. The row
// said "machine 0,0" until then (ADR-375).
// https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/doc/markdown/interface.md#L561-L568

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { grblDriver, marlinDriver } from '../../core/controllers';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { StatusDisplay } from './StatusDisplay';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const originalCapabilities = useLaserStore.getState().capabilities;
let host: HTMLDivElement;
let root: Root;

function originRow(): string {
  act(() => root.render(<StatusDisplay />));
  const row = [...host.querySelectorAll('div')].find((div) =>
    div.textContent?.startsWith('Origin:'),
  );
  return row?.textContent ?? '';
}

beforeEach(() => {
  useLaserStore.setState({
    ...initialLaserState(),
    capabilities: grblDriver.capabilities,
    connection: { kind: 'connected' },
    statusReport: {
      state: 'Idle',
      subState: null,
      mPos: { x: 0, y: 0, z: 0 },
      wPos: null,
      wco: null,
      feed: 0,
      spindle: 0,
    },
  });
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  useLaserStore.setState({ ...initialLaserState(), capabilities: originalCapabilities });
});

describe('StatusDisplay origin row', () => {
  it('says the origin is not reported yet instead of claiming machine 0,0', () => {
    expect(originRow()).toBe('Origin: not reported yet');
  });

  it('shows machine 0,0 once a zero offset is reported', () => {
    useLaserStore.setState({ wcoCache: { x: 0, y: 0, z: 0 } });
    expect(originRow()).toBe('Origin: machine 0,0');
  });

  it('shows a reported custom offset', () => {
    useLaserStore.setState({ wcoCache: { x: 150, y: 100, z: 0 } });
    expect(originRow()).toBe('Origin: X 150.000 Y 100.000 (custom)');
  });

  // Marlin's M114 has no offset field; KerfDesk records the shift it sets.
  it('drops "yet" for a controller whose reports never carry the offset', () => {
    useLaserStore.setState({ capabilities: marlinDriver.capabilities });
    expect(originRow()).toBe('Origin: not reported');
  });
});
