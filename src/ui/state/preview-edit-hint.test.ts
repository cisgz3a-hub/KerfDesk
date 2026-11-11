import { afterEach, describe, expect, it } from 'vitest';
import {
  notePreviewBlockedEdit,
  notePreviewIgnoredClick,
  PREVIEW_EDIT_HINT,
} from './preview-edit-hint';
import { useStore } from './store';
import { useToastStore } from './toast-store';

function messages(): ReadonlyArray<string> {
  return useToastStore.getState().toasts.map((toast) => toast.message);
}

function setPreview(on: boolean): void {
  if (useStore.getState().previewMode !== on) useStore.getState().togglePreview();
}

afterEach(() => {
  setPreview(false);
  useToastStore.setState({ toasts: [] });
});

describe('Preview edit hint (A4-P2-5)', () => {
  it('says nothing for a click outside Preview', () => {
    notePreviewIgnoredClick();
    expect(messages()).toEqual([]);
  });

  it('answers the first ignored click of a visit to Preview, and only that one', () => {
    setPreview(true);
    notePreviewIgnoredClick();
    expect(messages()).toEqual([PREVIEW_EDIT_HINT]);

    useToastStore.setState({ toasts: [] });
    notePreviewIgnoredClick();
    notePreviewIgnoredClick();
    expect(messages()).toEqual([]);
  });

  it('answers again on the next visit, and takes the hint away on leaving', () => {
    setPreview(true);
    notePreviewIgnoredClick();
    setPreview(false);
    expect(messages()).toEqual([]);

    setPreview(true);
    notePreviewIgnoredClick();
    expect(messages()).toEqual([PREVIEW_EDIT_HINT]);
  });

  it('keeps one line however many editing keys are pressed', () => {
    setPreview(true);
    notePreviewBlockedEdit();
    notePreviewBlockedEdit();
    notePreviewBlockedEdit();
    expect(messages()).toEqual([PREVIEW_EDIT_HINT]);
  });
});
