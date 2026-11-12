import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_DEVICE_PROFILE } from '../../core/devices';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import {
  K40_ROTARY_NOTE,
  MOSHI_ROTARY_NOTE,
  RotarySetupHost,
  RUIDA_ROTARY_NOTE,
} from './RotarySetupHost';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// Code quality audit C2 D2-P3-5 (ADR-127 Amendment 5): on a Ruida the .rd file
// already carries KerfDesk's Y scale, so Rotary Setup says to keep the
// controller's own rotary off.

const originalProject = useStore.getState().project;
let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  useStore.setState({ project: originalProject });
});

async function render(
  controllerKind: 'ruida' | 'grbl-v1.1' | 'lihuiyu' | 'moshi',
): Promise<string> {
  useStore.setState({ project: createProject({ ...DEFAULT_DEVICE_PROFILE, controllerKind }) });
  host = document.createElement('div');
  document.body.appendChild(host);
  await act(async () => {
    root = createRoot(host as HTMLDivElement);
    root.render(<RotarySetupHost onClose={() => undefined} />);
  });
  return document.body.textContent ?? '';
}

describe('Rotary Setup on a Ruida', () => {
  it('says the .rd file carries the rotary and the controller rotary stays off', async () => {
    expect(await render('ruida')).toContain(RUIDA_ROTARY_NOTE);
    expect(RUIDA_ROTARY_NOTE).toContain("Leave the controller's own rotary function off");
    // C2 verify E1-P2-2 (ADR-127 Amd 7): the .rd burns a curved stroke in pieces.
    expect(RUIDA_ROTARY_NOTE).toContain('a curved stroke is burned in pieces');
  });

  it('says nothing of the kind on a G-code controller', async () => {
    expect(await render('grbl-v1.1')).not.toContain('On a Ruida');
    expect(document.body.textContent).not.toContain(K40_ROTARY_NOTE);
    expect(document.body.textContent).not.toContain(MOSHI_ROTARY_NOTE);
  });
});

// ADR-703 Amendment 2 (C2 verification E2-P1-1): a K40 sets each stroke's
// speed in classes 5 % apart; a Moshiboard in whole mm/s (ADR-705 Amd 1).
describe('Rotary Setup on a K40 or Moshiboard', () => {
  it('says how a K40 runs the rotary', async () => {
    const text = await render('lihuiyu');
    expect(text).toContain(K40_ROTARY_NOTE);
    expect(text).not.toContain('whole mm/s');
  });

  it('says how a Moshiboard runs the rotary', async () => {
    expect(await render('moshi')).toContain(MOSHI_ROTARY_NOTE);
  });
});
