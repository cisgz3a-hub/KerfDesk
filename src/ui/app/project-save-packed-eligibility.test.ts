import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { denseProjectSaveGeometry } from '../../__fixtures__/project-save-geometry';
import {
  ProjectSaveTestWorker,
  currentProjectSaveWorker,
} from '../../__fixtures__/project-save-worker';
import { unpackProjectMessage } from '../packed-project-transfer';
import { projectSaveGeometryCanPack } from './project-save-packed-eligibility';
import { prepareProjectSaveOffThread } from './project-save-preparation-client';
import {
  prepareProjectSaveMessage,
  prepareProjectRecoveryMessage,
  prepareProjectSaveRequest,
} from './project-save-preparation';
import { createProject } from '../../core/scene';

beforeEach(() => {
  ProjectSaveTestWorker.instances = [];
  vi.stubGlobal('Worker', ProjectSaveTestWorker);
});
afterEach(() => {
  for (const worker of ProjectSaveTestWorker.instances)
    worker.respond({ kind: 'failed', reason: 'test finished' });
  vi.unstubAllGlobals();
});

describe('manual Save packed geometry eligibility', () => {
  it('packs an exact dense geometry graph in one buffer and validates the identical captured values', async () => {
    const project = denseProjectSaveGeometry();
    expect(projectSaveGeometryCanPack(project)).toBe(true);
    const saving = prepareProjectSaveOffThread(project, new AbortController().signal);
    const worker = currentProjectSaveWorker();
    const message = worker.postMessage.mock.calls[0]![0];
    expect(message.project).toHaveProperty('kind', 'packed-project');
    expect(message.representation).toBe('packed');
    const transfer = (worker.postMessage.mock.calls[0] as unknown[])[1] as ArrayBuffer[];
    expect(transfer).toHaveLength(1);
    const captured = unpackProjectMessage(message.project);
    expect(captured).toEqual(project);
    const prepared = prepareProjectSaveRequest(message);
    const expected = prepareProjectSaveMessage(project);
    expect(prepared.kind).toBe('ok');
    if (prepared.kind === 'ok' && expected.kind === 'ok')
      expect(JSON.parse(prepared.json)).toEqual(JSON.parse(expected.json));
    worker.respond(prepared);
    await expect(saving).resolves.toEqual(prepared);
  });

  it.each([
    'numeric-string',
    'closed-string',
    'point-field',
    'polyline-field',
    'curve-field',
    'segment-field',
    'arc-flag',
  ])(
    'keeps %s unchanged so canonical drift validation cannot be bypassed by packing',
    async (mutation) => {
      const project = denseProjectSaveGeometry(mutation);
      expect(projectSaveGeometryCanPack(project)).toBe(false);
      const expected = prepareProjectSaveMessage(project);
      if (mutation === 'numeric-string' || mutation === 'closed-string' || mutation === 'arc-flag')
        expect(expected.kind).toBe('invalid');
      else {
        expect(expected.kind).toBe('ok');
        if (expected.kind === 'ok') expect(expected.json).toContain('"rawExtra": "preserve"');
      }
      const saving = prepareProjectSaveOffThread(project, new AbortController().signal);
      const worker = currentProjectSaveWorker();
      expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
        project,
        mode: 'canonical',
        representation: 'original',
      });
      worker.respond(prepareProjectSaveRequest(worker.postMessage.mock.calls[0]![0]));
      await expect(saving).resolves.toEqual(expected);
    },
  );

  it.each(['numeric-string', 'closed-string', 'curve-field'])(
    'exports raw %s values from the original graph without packing or silently dropping fields',
    async (mutation) => {
      const project = denseProjectSaveGeometry(mutation);
      const saving = prepareProjectSaveOffThread(project, new AbortController().signal, 'recovery');
      const worker = currentProjectSaveWorker();
      expect(worker.postMessage).toHaveBeenCalledExactlyOnceWith({
        project,
        mode: 'recovery',
        representation: 'original',
      });
      const raw = prepareProjectRecoveryMessage(project);
      worker.respond(prepareProjectSaveRequest(worker.postMessage.mock.calls[0]![0]));
      await expect(saving).resolves.toEqual(raw);
      if (raw.kind !== 'ok') throw new Error('Raw geometry could not be serialized.');
      if (mutation === 'numeric-string') expect(raw.json).toContain('"x": "0"');
      else if (mutation === 'closed-string') expect(raw.json).toContain('"closed": "false"');
      else expect(raw.json).toContain('"rawExtra": "preserve"');
    },
  );

  it.each(['canonical', 'recovery'] as const)(
    'decodes a raw project with a colliding kind field by its %s envelope',
    async (mode) => {
      const project = {
        ...createProject(),
        notes: 'keep me '.repeat(80_000),
        kind: 'packed-project',
      };
      const saving = prepareProjectSaveOffThread(project, new AbortController().signal, mode);
      const worker = currentProjectSaveWorker();
      const message = worker.postMessage.mock.calls[0]![0];
      expect(message).toEqual({ project, mode, representation: 'original' });
      const prepared = prepareProjectSaveRequest(message);
      expect(prepared).toEqual(
        mode === 'canonical'
          ? prepareProjectSaveMessage(project)
          : prepareProjectRecoveryMessage(project),
      );
      expect(prepared.kind).toBe('ok');
      if (mode === 'recovery' && prepared.kind === 'ok')
        expect(prepared.json).toContain('"kind": "packed-project"');
      worker.respond(prepared);
      await expect(saving).resolves.toEqual(prepared);
    },
  );
});
