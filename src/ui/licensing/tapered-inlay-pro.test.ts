import { beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_CNC_TAPERED_INLAY } from '../../core/scene/cnc-tapered-inlay';
import { proProject } from '../app/pro-project-test-fixtures';
import {
  preserveUnadmittedProProject,
  usePendingProProjectStore,
} from '../state/pending-pro-project';
import { resetStore } from '../state/test-helpers';
import { operationProFeature } from './pro-operation-policy';

// ADR-540 Amendment 6 (audit 02-P2-2): a tapered V-bit inlay pair cuts V-carve
// passes, so it is V-carve everywhere the edition decides; the straight pair is Free.

vi.mock('../../platform/build-capabilities', () => ({ BROWSER_FREE_BUILD: true }));

beforeEach(() => {
  resetStore();
  usePendingProProjectStore.setState({ pending: null });
});

const TAPERED = { cutType: 'inlay-pair', taperedInlay: DEFAULT_CNC_TAPERED_INLAY } as const;

const operation = (project = proProject()) => project.scene.layers.at(-1) ?? {};

it('classes a tapered V-bit inlay pair as V-carve and keeps the straight pair Free', () => {
  expect(operationProFeature(operation(proProject(TAPERED)))).toBe('vcarve');
  expect(operationProFeature(operation(proProject({ cutType: 'inlay-pair' })))).toBeNull();
});

it('keeps a project holding a tapered inlay out of browser Free, as V-carve', () => {
  expect(preserveUnadmittedProProject(proProject(TAPERED))?.features).toEqual(['vcarve']);
  expect(preserveUnadmittedProProject(proProject({ cutType: 'inlay-pair' }))).toBeNull();
});
