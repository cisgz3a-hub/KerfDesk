// A Falcon A1 Pro profile saved before the preset gained its vendor command set
// (#796) connects with the generic grblHAL driver, whose Frame sends M9 just
// before Start (ADR-323). Re-applying the preset is the deliberate fix, so the
// picker must not show that copy as the selected preset (ADR-375).

import { act, useReducer } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ControllerKind, DeviceProfile } from '../../../core/devices';
import { FALCON_A1_PRO_GRBLHAL_PROFILE } from '../../../core/devices/falcon-profiles';
import { LASER_MACHINE_CONFIG } from '../../../core/scene';
import { DeviceSetupProfilePicker } from './DeviceSetupProfilePicker';
import { deviceSetupReducer, initDeviceSetup, type DeviceSetupState } from './device-setup-flow';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const { controllerCommandSet: _dropped, ...LEGACY_FALCON } = FALCON_A1_PRO_GRBLHAL_PROFILE;
const FALCON_CARD = `input[aria-label="Use ${FALCON_A1_PRO_GRBLHAL_PROFILE.name}"]`;
const STALE_NOTICE = 'This saved profile predates the preset’s vendor command set.';

let host: HTMLDivElement;
let root: Root;
let snapshot: DeviceSetupState;

beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function renderPicker(profile: DeviceProfile, detectedControllerKind?: ControllerKind): void {
  snapshot = initDeviceSetup(profile, null, {
    machine: LASER_MACHINE_CONFIG,
    ...(detectedControllerKind === undefined ? {} : { detectedControllerKind }),
  });
  function Harness(): JSX.Element {
    const [state, dispatch] = useReducer(deviceSetupReducer, snapshot);
    snapshot = state;
    return <DeviceSetupProfilePicker state={state} dispatch={dispatch} />;
  }
  act(() => root.render(<Harness />));
}

function falconCard(): HTMLInputElement {
  const card = host.querySelector<HTMLInputElement>(FALCON_CARD);
  if (card === null) throw new Error('Falcon A1 Pro card missing from the preview');
  return card;
}

describe('profile picker for a saved preset copy that lacks its command set (ADR-375)', () => {
  it.each([
    ['no detected firmware', undefined],
    // A "Grbl" banner makes the Falcon card a manual choice; the copy still leads.
    ['a GRBL banner', 'grbl-v1.1' as const],
  ])('leads with the unselected Falcon card and re-applies it with %s', (_label, detected) => {
    renderPicker(LEGACY_FALCON, detected);
    const card = falconCard();
    expect(card.checked).toBe(false);
    expect(card.closest('article')?.textContent).toContain(STALE_NOTICE);
    expect(host.querySelector('input[type="radio"]')).toBe(card);

    act(() => card.click());

    expect(snapshot.draft.controllerCommandSet).toBe('creality-falcon-a1-pro');
    expect(snapshot.draft.profileId).toBe(FALCON_A1_PRO_GRBLHAL_PROFILE.profileId);
    expect(falconCard().checked).toBe(true);
    expect(host.textContent).not.toContain(STALE_NOTICE);
  });

  // A copy moved to a non-GRBL family dropped the command set on purpose;
  // selectControllerDriver applies vendor command sets to GRBL families only.
  it.each([
    ['the current Falcon preset', FALCON_A1_PRO_GRBLHAL_PROFILE],
    ['a copy moved to FluidNC', { ...LEGACY_FALCON, controllerKind: 'fluidnc' as const }],
  ])('keeps %s selected without the notice', (_label, profile) => {
    renderPicker(profile);
    expect(falconCard().checked).toBe(true);
    expect(host.textContent).not.toContain(STALE_NOTICE);
  });
});
