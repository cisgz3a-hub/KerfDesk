import { afterEach, expect, it } from 'vitest';
import { loadDevelopmentWorkspace } from './development-workspace-entry';

afterEach(() => document.head.querySelectorAll('script').forEach((script) => script.remove()));

it('waits for the external workspace module to finish loading', async () => {
  let loaded = false;
  const promise = loadDevelopmentWorkspace(document).then(() => {
    loaded = true;
  });
  await Promise.resolve();
  expect(loaded).toBe(false);
  const script = document.head.querySelector('script');
  expect(script?.type).toBe('module');
  expect(script?.getAttribute('src')).toBe('/src/ui/app/main.tsx');
  script?.dispatchEvent(new Event('load'));
  await promise;
  expect(loaded).toBe(true);
});

it('rejects a failed module load so the caller can show its explicit retry screen', async () => {
  const promise = loadDevelopmentWorkspace(document);
  const rejected = expect(promise).rejects.toThrow('Workspace module could not load');
  document.head.querySelector('script')?.dispatchEvent(new Event('error'));
  await rejected;
  expect(document.head.querySelector('script')).toBeNull();
});
