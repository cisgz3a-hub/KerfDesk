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
import * as externalRun from './external-run';
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
  vi.restoreAllMocks();
});

async function show(text: string): Promise<HTMLElement> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () =>
    root?.render(
      <RunGcodeFileDialog name="part.nc" text={text} onClose={vi.fn()} onStarted={vi.fn()} />,
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
    expect(body.textContent).toContain('6 lines');
    expect(body.textContent).toContain('G21 G90 first');
    expect(body.textContent).toContain('/ marks, % markers and blank lines left out');
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

  it('reviews and Frames the normalized executable bytes, not the original inspection', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const text = 'G21 G90\nG0 X0 Y0\nM4 S500\nG1 X10 F600\nG1 X1(note)00\nM5\n';
    const original = buildGcodeRenderModel(text);
    if (original.kind !== 'ok') throw new Error(original.reason);
    expect(original.model.stats.programBounds?.maxX).toBe(10);
    const body = await show(text);
    expect(body.textContent).toContain('100 mm × 0 mm');
    expect(body.textContent).not.toContain('unreadable line');
    expect(button(body, 'Frame').disabled).toBe(false);
    const frame = vi.spyOn(externalRun, 'frameExternalProgram').mockResolvedValue(null);
    await act(async () => button(body, 'Frame').click());
    expect(frame).toHaveBeenCalledWith(
      expect.objectContaining({
        gcode: 'G21G90\nG21G90\nG0X0Y0\nM4S500\nG1X10F600\nG1X100\nM5\n',
        envelope: { minX: 0, minY: 0, maxX: 100, maxY: 0 },
      }),
    );
  });

  it('lists warnings without blocking anything', async () => {
    const body = await show('G20 G90\nG0 X1 Y1\nM3 S500\nG1 X2 F20\n');
    expect(body.textContent).toContain('Warnings');
    expect(body.textContent).toContain('inches (G20)');
    expect(body.textContent).toContain('never sends M5');
  });

  it('shows the G10 displacement warning while preserving Frame and exact sendable bytes', async () => {
    useLaserStore.setState({
      connection: { kind: 'connected' },
      statusReport: parseStatusReport('<Idle|MPos:0.000,0.000,0.000|FS:0,0>'),
    });
    const text = 'G21 G90\nG0 X10 Y0\nG10L20P1X0Y0\nM4 S500\nG1 X20 F600\nM5\n';
    const body = await show(text);
    expect(body.textContent).toContain('work-coordinate offsets (G10 L20)');
    expect(body.textContent).toContain('may be displaced from the traced outline');
    expect(button(body, 'Frame').disabled).toBe(false);
    const frame = vi.spyOn(externalRun, 'frameExternalProgram').mockResolvedValue(null);
    await act(async () => button(body, 'Frame').click());
    expect(frame).toHaveBeenCalledWith(
      expect.objectContaining({
        gcode: 'G21G90\nG21G90\nG0X10Y0\nG10L20P1X0Y0\nM4S500\nG1X20F600\nM5\n',
      }),
    );
  });

  it('explains a file it cannot send, with no Frame or Start', async () => {
    const body = await show('G21\n$H\nG0 X1\n');
    expect(body.textContent).toContain('cannot send this file as a job');
    expect(body.textContent).toContain('Line 2 is a $ controller command');
    expect([...body.querySelectorAll('button')].map((each) => each.textContent)).toEqual(['Close']);
  });
});
