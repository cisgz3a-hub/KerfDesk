import { describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { deserializeProject, serializeProject } from '../../io/project';
import { completeNativeProjectOpen } from './project-open-completion';

function parsed(command: string) {
  const project = createProject();
  return deserializeProject(
    serializeProject({
      ...project,
      device: { ...project.device, autofocusCommand: command },
    }),
  );
}

function open(command: string) {
  const result = parsed(command);
  const pushToast = vi.fn();
  const setProject = vi.fn(() => ({ kind: 'loaded' as const }));
  const opened = completeNativeProjectOpen(
    { setProject, markLoaded: vi.fn(), pushToast },
    'focus.lf2',
    result,
  );
  return { result, opened, pushToast, setProject };
}

describe('native project Auto-focus repair notice', () => {
  it.each(['G30', 'G38.2 Z-10', 'G38.3 Z-10 F100'])(
    'opens %s after removing it and tells the operator to review Auto-focus',
    (command) => {
      const { result, opened, pushToast, setProject } = open(command);
      expect(result).toMatchObject({ kind: 'ok', project: { device: { autofocusCommand: '' } } });
      expect(opened).toBe(true);
      expect(setProject).toHaveBeenCalledOnce();
      expect(pushToast).toHaveBeenCalledWith(
        expect.stringMatching(/Auto-focus command.*removed.*Review Auto-focus/i),
        'warning',
      );
    },
  );

  it.each(['', '$HZ1', 'G38.2 Z-10 F100'])(
    'does not claim a valid or empty command %s was removed',
    (command) => {
      const { pushToast } = open(command);
      expect(
        pushToast.mock.calls.some(([message]) => /Auto-focus command.*removed/i.test(message)),
      ).toBe(false);
    },
  );
});
