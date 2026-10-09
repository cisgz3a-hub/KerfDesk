import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createProject } from '../../core/scene';
import { artworkCreationCommands } from '../commands/artwork-creation-commands';
import { useStore } from '../state';
import { resetStore } from '../state/test-helpers';
import { ArtworkCreationHost } from './ArtworkCreationHost';
import { openArtworkCreation, useArtworkCreationStore } from './artwork-creation-store';

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  resetStore();
  useArtworkCreationStore.getState().close();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  useArtworkCreationStore.getState().close();
  resetStore();
  vi.unstubAllGlobals();
});
describe('artwork creation sessions', () => {
  it.each(['sketch', 'part'] as const)(
    'closes the %s creation draft when the document changes',
    async (kind) => {
      await act(async () => {
        root.render(<ArtworkCreationHost />);
        openArtworkCreation(kind);
      });
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
      const replacement = createProject();
      await act(async () => {
        useStore.getState().setProject(replacement);
      });
      expect(host.querySelector('[role="dialog"]')).toBeNull();
      expect(useArtworkCreationStore.getState().kind).toBeNull();
      expect(useStore.getState().project).toBe(replacement);
      expect(useStore.getState().undoStack).toHaveLength(0);
      await act(async () => {
        openArtworkCreation(kind);
      });
      expect(host.querySelector('[role="dialog"]')).not.toBeNull();
    },
  );
  it('keeps CNC-only creation unavailable in Laser while leaving 2D authoring reachable', () => {
    const commands = artworkCreationCommands('laser');
    expect(commands.map((command) => [command.id, command.enabled])).toEqual([
      ['tools.constrained-sketch', true],
      ['tools.parametric-part', true],
      ['tools.editable-relief', false],
    ]);
    expect(artworkCreationCommands('cnc').every((command) => command.enabled)).toBe(true);
  });
});
