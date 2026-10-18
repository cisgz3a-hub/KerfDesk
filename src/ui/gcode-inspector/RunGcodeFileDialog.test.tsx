import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildGcodeRenderModel } from '../../core/gcode-view';
import { parseStatusReport } from '../../core/controllers/grbl/status-parser';
import { createProject } from '../../core/scene';
import { useStore } from '../state';
import { useLaserStore } from '../state/laser-store';
import { initialLaserState } from '../state/laser-store-helpers';
import { resetStore } from '../state/test-helpers';
import { EXTERNAL_FRAME_FIRST } from './external-run';
import { analyzeGcodeModel } from './gcode-inspector-analysis';
import { inspectorRenderModel } from './inspector-model';
import { RunGcodeFileDialog } from './RunGcodeFileDialog';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  resetStore();
  useLaserStore.setState(initialLaserState());
  useStore.setState({ project: createProject() });
});

afterEach(async () => {
  if (root !== null) await act(async () => root?.unmount());
  host?.remove();
  host = null;
  root = null;
  useLaserStore.setState(initialLaserState());
  document.body.innerHTML = '';
});

async function show(text: string): Promise<HTMLElement> {
  const parsed = buildGcodeRenderModel(text, { machineKind: 'laser' });
  if (parsed.kind !== 'ok') throw new Error(parsed.reason);
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <RunGcodeFileDialog
        name="part.nc"
        text={text}
        model={inspectorRenderModel(parsed.model)}
        analysis={analyzeGcodeModel(parsed.model)}
        onClose={vi.fn()}
        onStarted={vi.fn()}
      />,
    ),
  );
  return document.body;
}

function button(body: HTMLElement, label: string): HTMLButtonElement {
  const found = [...body.querySelectorAll('button')].find((each) => each.textContent === label);
  if (found === undefined) throw new Error(`${label} missing`);
  return found;
}

describe('Run G-code file dialog (ADR-630)', () => {
  it('reviews what will be sent and keeps Start locked until a Frame', async () => {
    const body = await show('(job)\nG21 G90\nG0 X10 Y5\nM4 S500\nG1 X60 Y45 F1000\nM5\n');
    expect(body.textContent).toContain('5 lines');
    expect(body.textContent).toContain('Comments, % markers and blank lines are left out');
    expect(body.textContent).toContain('50 mm × 40 mm');
    expect(body.textContent).toContain('millimetres (G21)');
    expect(button(body, 'Start').disabled).toBe(true);
    expect(button(body, 'Start').title).toBe(EXTERNAL_FRAME_FIRST);
    expect(button(body, 'Frame').disabled).toBe(true);
    expect(button(body, 'Frame').title).toBe('Connect to the machine first.');
  });

  it('enables Frame on a connected, Idle machine', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const body = await show('G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 F600\nM5\n');
    expect(button(body, 'Frame').disabled).toBe(false);
  });

  it('lists warnings without blocking anything', async () => {
    const body = await show('G20 G90\nG0 X1 Y1\nM3 S500\nG1 X2 F20\n');
    expect(body.textContent).toContain('Warnings');
    expect(body.textContent).toContain('inches (G20)');
    expect(body.textContent).toContain('never sends M5');
  });

  it('explains a file it cannot send, with no Frame or Start', async () => {
    const body = await show('G21\n$H\nG0 X1\n');
    expect(body.textContent).toContain('cannot send this file as a job');
    expect(body.textContent).toContain('Line 2 is a $ controller command');
    expect([...body.querySelectorAll('button')].map((each) => each.textContent)).toEqual(['Close']);
  });
});
