import * as outputWorker from '../laser/output-preparation-worker-client';
import { prepareOutputRequest } from '../laser/output-preparation';
import { createHash } from 'node:crypto';
import { cncToolSectionProject } from '../../__fixtures__/cnc-tool-programs';
import type { Project } from '../../core/scene';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockPlatform, projectWithLine } from '../../__fixtures__/file-actions';
import { DEFAULT_CNC_MACHINE_CONFIG } from '../../core/scene';
import type { PlatformAdapter, SaveTarget } from '../../platform/types';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import type { SaveGcodeCtx } from './file-actions';
import { prebuildGcodeSave } from './transactional-gcode-save';
import { CncSetupDocumentExport } from './CncSetupDocumentExport';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.spyOn(outputWorker, 'prepareSaveOutputOffThread').mockImplementation(async (request) => {
    const response = await prepareOutputRequest(request);
    if (response.kind !== 'save') throw new Error('Expected Save worker response');
    return response.result;
  });
  resetStore();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  resetStore();
});
async function mount(
  pickFileForSave: PlatformAdapter['pickFileForSave'],
  project: Project = { ...projectWithLine(), machine: DEFAULT_CNC_MACHINE_CONFIG },
) {
  const pushToast = vi.fn(),
    advanceVariablesAfter = vi.fn(),
    onSaved = vi.fn();
  const ctx: SaveGcodeCtx = {
    project,
    savedName: 'part.lf2',
    platform: { ...mockPlatform(), pickFileForSave },
    pushToast,
    advanceVariablesAfter,
  };
  useStore.setState({ project });
  const artifact = await prebuildGcodeSave(ctx);
  if (artifact === null) throw new Error('CNC fixture failed to prepare');
  await act(async () =>
    root.render(<CncSetupDocumentExport artifact={artifact} ctx={ctx} onSaved={onSaved} />),
  );
  return { project, artifact, ctx, pushToast, advanceVariablesAfter, onSaved };
}
function saveButton(): HTMLButtonElement {
  const button = Array.from(host.querySelectorAll('button')).find((item) =>
    item.textContent?.includes('Save setup sheet'),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('Missing setup export');
  return button;
}
async function clickSave(): Promise<void> {
  await act(async () => saveButton().click());
}
function deferred<T>() {
  let resolve: (value: T) => void = () => {
    throw new Error('Missing resolver');
  };
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function changeProject(): void {
  useStore.setState((state) => ({
    project: {
      ...state.project,
      device: { ...state.project.device, name: 'Changed device while choosing a file' },
    },
  }));
}
function downloadedPayload(html: string, filename: string): Buffer {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const anchor = Array.from(parsed.querySelectorAll('a')).find(
    (item) => item.download === filename,
  );
  const encoded = anchor?.getAttribute('href')?.split(',')[1];
  if (encoded === undefined) throw new Error('Missing embedded exact artifact');
  return Buffer.from(encoded, 'base64');
}

describe('CNC setup document export', () => {
  it('writes the already prepared exact program bytes and matching manifest before advancing variables', async () => {
    const written: string[] = [];
    const write = vi.fn(async (data: string | Blob) => {
      written.push(typeof data === 'string' ? data : await data.text());
    });
    const pick = vi.fn(async () => ({ displayName: 'part.setup.html', write }));
    const mounted = await mount(pick);
    expect(pick).not.toHaveBeenCalled();
    await clickSave();
    expect(pick).toHaveBeenCalledWith({ suggestedName: 'part.setup.html', extensions: ['.html'] });
    const html = written[0];
    if (html === undefined) throw new Error('No setup sheet written');
    expect(downloadedPayload(html, 'part.gcode')).toEqual(
      Buffer.from(mounted.artifact.prepared.gcode, 'utf8'),
    );
    const manifest = JSON.parse(downloadedPayload(html, 'part.manifest.json').toString('utf8')) as {
      operations: unknown[];
      toolPlan: unknown[];
    };
    expect(manifest.operations).toEqual(mounted.artifact.prepared.cncProgramFacts?.operations);
    expect(manifest.toolPlan).toEqual(mounted.artifact.prepared.cncProgramFacts?.toolPlan);
    expect(mounted.advanceVariablesAfter).toHaveBeenCalledExactlyOnceWith(
      mounted.project,
      'successful-export',
    );
    expect(mounted.onSaved).toHaveBeenCalledOnce();
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(
      mounted.advanceVariablesAfter.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('keeps cancellation silent and never advances variables', async () => {
    const pick = vi.fn(async () => null);
    const mounted = await mount(pick);
    await clickSave();
    expect(pick).toHaveBeenCalledOnce();
    expect(mounted.pushToast).not.toHaveBeenCalled();
    expect(mounted.advanceVariablesAfter).not.toHaveBeenCalled();
    expect(mounted.onSaved).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });

  it('shows picker failure without advancing variables and permits another attempt', async () => {
    const mounted = await mount(async () => {
      throw new Error('Picker unavailable');
    });
    await clickSave();
    expect(mounted.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('Picker unavailable'),
      'error',
    );
    expect(mounted.advanceVariablesAfter).not.toHaveBeenCalled();
    expect(mounted.onSaved).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });

  it('shows incomplete write failure without treating the export as successful', async () => {
    const write = vi.fn(async () => {
      throw new Error('Disk full');
    });
    const mounted = await mount(async () => ({ displayName: 'part.setup.html', write }));
    await clickSave();
    expect(write).toHaveBeenCalledOnce();
    expect(mounted.pushToast).toHaveBeenCalledWith(expect.stringContaining('Disk full'), 'error');
    expect(mounted.advanceVariablesAfter).not.toHaveBeenCalled();
    expect(mounted.onSaved).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });

  it('refuses a stale prepared source before choosing a destination', async () => {
    const pick = vi.fn(async () => null);
    const mounted = await mount(pick);
    await act(async () => changeProject());
    await clickSave();
    expect(pick).not.toHaveBeenCalled();
    expect(mounted.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('project changed'),
      'warning',
    );
    expect(mounted.advanceVariablesAfter).not.toHaveBeenCalled();
    expect(mounted.onSaved).not.toHaveBeenCalled();
  });

  it('rechecks source identity after the destination picker resolves', async () => {
    const target = deferred<SaveTarget | null>();
    const write = vi.fn(async () => undefined);
    const mounted = await mount(() => target.promise);
    await clickSave();
    expect(saveButton().disabled).toBe(true);
    await act(async () => {
      changeProject();
      target.resolve({ displayName: 'part.setup.html', write });
    });
    expect(write).not.toHaveBeenCalled();
    expect(mounted.pushToast).toHaveBeenCalledWith(
      expect.stringContaining('project changed'),
      'warning',
    );
    expect(mounted.advanceVariablesAfter).not.toHaveBeenCalled();
    expect(mounted.onSaved).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });
});

it('recovers from a synchronous destination-adapter failure without advancing variables', async () => {
  const mounted = await mount(() => {
    throw new Error('Native dialog failed');
  });
  await clickSave();
  expect(mounted.pushToast).toHaveBeenCalledWith(
    expect.stringContaining('Native dialog failed'),
    'error',
  );
  expect(mounted.advanceVariablesAfter).not.toHaveBeenCalled();
  expect(mounted.onSaved).not.toHaveBeenCalled();
  expect(saveButton().disabled).toBe(false);
});

async function chooseSeparateTools(): Promise<void> {
  const select = host.querySelector<HTMLSelectElement>(
    'select[aria-label="Setup sheet output mode"]',
  );
  if (select === null) throw new Error('Missing output mode');
  await act(async () => {
    select.value = 'separate-tools';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

it('packages the prepared A-B-A files in one atomic HTML write after selecting separate-tool output', async () => {
  const written: string[] = [];
  const write = vi.fn(async (data: string | Blob) => {
    written.push(typeof data === 'string' ? data : await data.text());
  });
  const pick = vi.fn(async () => ({ displayName: 'part.setup.html', write }));
  const mounted = await mount(pick, cncToolSectionProject());
  expect(host.querySelector<HTMLSelectElement>('select')?.value).toBe('single-file');
  expect(mounted.artifact.prepared.cncToolPrograms?.map((program) => program.toolId)).toEqual([
    'A',
    'B',
    'A',
  ]);
  await chooseSeparateTools();
  await clickSave();
  expect(pick).toHaveBeenCalledOnce();
  expect(write).toHaveBeenCalledOnce();
  const html = written[0];
  if (html === undefined) throw new Error('No package written');
  const manifest = JSON.parse(downloadedPayload(html, 'part.manifest.json').toString('utf8')) as {
    exportMode: string;
    programs: { filename: string; sha256: string; byteLength: number }[];
  };
  expect(manifest.exportMode).toBe('separate-tools');
  expect(manifest.programs.map((program) => program.filename)).toEqual([
    'part-001-tool-A.gcode',
    'part-002-tool-B.gcode',
    'part-003-tool-A.gcode',
  ]);
  for (const [index, program] of manifest.programs.entries()) {
    const bytes = downloadedPayload(html, program.filename);
    expect(bytes).toEqual(
      Buffer.from(mounted.artifact.prepared.cncToolPrograms?.[index]?.gcode ?? '', 'utf8'),
    );
    expect(bytes.length).toBe(program.byteLength);
    expect('sha256:' + createHash('sha256').update(bytes).digest('hex')).toBe(program.sha256);
  }
  expect(html).not.toContain('download="part.gcode"');
  expect(mounted.advanceVariablesAfter).toHaveBeenCalledExactlyOnceWith(
    mounted.project,
    'successful-export',
  );
  expect(mounted.onSaved).toHaveBeenCalledOnce();
});

it('does not record any separate-tool download as saved when the atomic package picker is cancelled', async () => {
  const pick = vi.fn(async () => null);
  const mounted = await mount(pick, cncToolSectionProject());
  await chooseSeparateTools();
  await clickSave();
  expect(pick).toHaveBeenCalledOnce();
  expect(mounted.advanceVariablesAfter).not.toHaveBeenCalled();
  expect(mounted.onSaved).not.toHaveBeenCalled();
  expect(mounted.pushToast).not.toHaveBeenCalled();
});

it('disables separate-tool selection for an older prepared artifact that has no emitted tool programs', async () => {
  const mounted = await mount(async () => null);
  const { cncToolPrograms: _programs, ...prepared } = mounted.artifact.prepared;
  await act(async () =>
    root.render(
      <CncSetupDocumentExport
        artifact={{ ...mounted.artifact, prepared }}
        ctx={mounted.ctx}
        onSaved={mounted.onSaved}
      />,
    ),
  );
  expect(host.querySelector<HTMLOptionElement>('option[value="separate-tools"]')?.disabled).toBe(
    true,
  );
  expect(host.querySelector<HTMLSelectElement>('select')?.value).toBe('single-file');
});
