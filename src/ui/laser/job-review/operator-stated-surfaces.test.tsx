// Where an operator-stated power scale is shown or sent (ADR-095 Amendment 1):
// Job Review's fact line, the phone remote's review, and the prompt of a run
// KerfDesk did not build. Each says it is the operator's statement; none says
// verified.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { marlinDriver } from '../../../core/controllers';
import { DEFAULT_DEVICE_PROFILE, type DeviceProfile } from '../../../core/devices';
import {
  createOperatorPowerScaleStatement,
  operatorStatedPowerScaleFact,
} from '../../../core/devices/power-scale-statement';
import { createProject } from '../../../core/scene';
import { externalLaserModeStartPrompt } from '../../gcode-inspector/external-run-readiness';
import { initialLaserState } from '../../state/laser-store-helpers';
import { beforeYouStartText, remoteReviewAcknowledgement } from './before-you-start';
import { JobReviewAcknowledgement } from './JobReviewAcknowledgement';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const MARLIN: DeviceProfile = {
  ...DEFAULT_DEVICE_PROFILE,
  controllerKind: 'marlin',
  gcodeDialect: { dialectId: 'marlin-inline' },
  maxPowerS: 255,
};
const STATEMENT = createOperatorPowerScaleStatement(MARLIN, '2026-11-11T10:00:00.000Z');
if (STATEMENT === null) throw new Error('fixture: Marlin takes a statement');
const FACT = operatorStatedPowerScaleFact(STATEMENT);

describe('Job Review', () => {
  it('shows the statement as one plain note, not the acknowledgement banner', () => {
    act(() =>
      root.render(
        <JobReviewAcknowledgement
          acknowledgement={{ kind: 'laser-operator-stated', statement: FACT }}
        />,
      ),
    );
    const note = host.querySelector('[role="note"]');
    expect(note?.getAttribute('aria-label')).toBe('Operator-stated power scale');
    expect(note?.textContent).toBe(FACT);
    expect(host.querySelector('.lf-banner')).toBeNull();
    expect(host.textContent).not.toMatch(/Confirm laser settings|confirms this|verified/i);
  });

  it('still shows the banner for an unverified laser', () => {
    act(() =>
      root.render(
        <JobReviewAcknowledgement acknowledgement={{ kind: 'laser-unverified', prompt: 'P?' }} />,
      ),
    );
    expect(host.querySelector('.lf-banner--warning')?.textContent).toContain('P?');
  });
});

describe('the phone remote review', () => {
  it('sends the fact line under a kind every deployed client knows, never as verified', () => {
    const sent = remoteReviewAcknowledgement(
      { kind: 'laser-operator-stated', statement: FACT },
      'laser',
    );
    expect(sent).toEqual({
      kind: 'laser-unverified',
      prompt: `${beforeYouStartText('laser')}\n\n${FACT}`,
    });
  });

  it('leaves the other kinds as they were', () => {
    expect(remoteReviewAcknowledgement({ kind: 'laser-verified' }, 'laser')).toEqual({
      kind: 'laser-verified',
      prompt: beforeYouStartText('laser'),
    });
    expect(remoteReviewAcknowledgement({ kind: 'cnc', prompt: 'Setup?' }, 'cnc')).toEqual({
      kind: 'cnc',
      prompt: `${beforeYouStartText('cnc')}\n\nSetup?`,
    });
  });
});

describe('a program KerfDesk did not build, on Marlin', () => {
  it('is asked about the file, in Marlin words', () => {
    const laser = {
      ...initialLaserState(),
      connection: { kind: 'connected' as const },
      capabilities: marlinDriver.capabilities,
      activeControllerKind: 'marlin' as const,
    };
    const prompt = externalLaserModeStartPrompt(createProject(MARLIN), laser, 'G1 X1 S10\n', null);
    expect(prompt).toContain('Marlin does not report its laser power scale');
    expect(prompt).toContain("this program's S values come from the file");
    expect(prompt).toMatch(/Start this laser program anyway\?$/);
    expect(prompt).not.toMatch(/\$3[0-2]|GRBL/);
  });
});
