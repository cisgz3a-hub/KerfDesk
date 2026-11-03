// Which Studio documents a copy on disk holds (ADR-590 Amendment 3).
import { describe, expect, it, vi } from 'vitest';
import type { DesignStudioDocument } from '../../core/design/design-studio-document';
import { createProject } from '../../core/scene';
import {
  diskCopyHoldsDesignDocument,
  noteProjectCopyInDoubt,
  noteProjectCopyOnDisk,
  subscribeDesignDocumentCopies,
} from './design-document-copies';

function studioDocument(): DesignStudioDocument {
  return {
    version: 1,
    sketch: { entities: [] },
    activeLayerId: 'design-layer-1',
    surface3d: false,
    appliedObjectIds: [],
    appliedOperationsByLayer: [],
    appliedEntityObjectIds: [],
  };
}

describe('design document copies', () => {
  it('holds a document once a copy is written, by identity, and tells listeners once', () => {
    const listener = vi.fn();
    const unsubscribe = subscribeDesignDocumentCopies(listener);
    const document = studioDocument();
    const project = { ...createProject(), designStudioDocument: document };
    expect(diskCopyHoldsDesignDocument(document)).toBe(false);
    noteProjectCopyOnDisk(project);
    // A later edit carries the same document over.
    noteProjectCopyOnDisk({ ...project, notes: 'edited' });
    expect(diskCopyHoldsDesignDocument(document)).toBe(true);
    expect(diskCopyHoldsDesignDocument(studioDocument())).toBe(false);
    expect(diskCopyHoldsDesignDocument(undefined)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(1);

    noteProjectCopyInDoubt(project);
    expect(diskCopyHoldsDesignDocument(document)).toBe(false);
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
