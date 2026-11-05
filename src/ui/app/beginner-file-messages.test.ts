// File and crash messages a beginner can act on (UX audit U5-P3-8, U5-P3-9,
// U5-P3-10, U5-P3-11, U5-P3-12): a damaged project, a missing font, a broken
// SVG, a refused save and an uncaught error each say what happened and what to
// do, and keep the developer text under the toast's details.
import { describe, expect, it, vi } from 'vitest';
import {
  createLayer,
  createProject,
  IDENTITY_TRANSFORM,
  type Project,
  type TextObject,
} from '../../core/scene';
import { DEFAULT_FONT_KEY } from '../../core/text';
import { deserializeProject, serializeProject } from '../../io/project';
import { parseSvg } from '../../io/svg';
import { useStore } from '../state/store';
import { resetStore } from '../state/test-helpers';
import { missingFontOpenNotice, missingFontReason } from '../text/missing-font-notice';
import { EMPTY_PROJECT_FILE, projectOpenFailure } from './file-action-formatters';
import { parseOpenedProjectFile } from './project-open-parser';
import { describeImportError } from './import-toasts';
import { completeNativeProjectOpen } from './project-open-completion';
import { projectWriteFailureMessage } from './project-save-completion';

function projectWithText(fontKey: string): Project {
  const project = createProject();
  const text: TextObject = {
    kind: 'text',
    id: 'text-1',
    content: 'Hello',
    fontKey,
    sizeMm: 10,
    alignment: 'left',
    lineHeight: 1.2,
    letterSpacing: 0,
    color: '#000000',
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    transform: IDENTITY_TRANSFORM,
    paths: [],
  };
  return {
    ...project,
    scene: {
      layers: [createLayer({ id: '#000000', color: '#000000', mode: 'fill' })],
      objects: [text],
    },
  };
}

function failedOpen(text: string) {
  const result = deserializeProject(text);
  if (result.kind === 'ok') throw new Error('expected a failed open');
  return result;
}

describe('a damaged or empty project (U5-P3-8)', () => {
  it('names the damage and the next step, with the parser text under details', () => {
    const failure = projectOpenFailure('corrupt.lf2', failedOpen('{"schemaVersion": 21,'));
    expect(failure.message).toBe(
      "corrupt.lf2 is damaged or incomplete (it may have been cut off while saving or copying), so KerfDesk can't open it. Your current design is unchanged. Open an earlier copy of the file if you have one.",
    );
    expect(failure.message).not.toMatch(/JSON/);
    expect(failure.details).toEqual([
      expect.stringMatching(/^Could not open corrupt.lf2: not valid JSON: /),
    ]);
  });

  it('says an empty file is empty', async () => {
    const file = { name: 'empty.lf2', size: 2, text: async () => ' \n' };
    const parsed = await parseOpenedProjectFile(file, {}, vi.fn());
    expect(parsed).toEqual({ kind: 'native', result: EMPTY_PROJECT_FILE });
    const failure = projectOpenFailure('empty.lf2', EMPTY_PROJECT_FILE);
    expect(failure.message).toBe(
      'empty.lf2 is empty, so there is nothing to open. Your current design is unchanged. Open an earlier copy of the file if you have one.',
    );
    expect(failure.details).toEqual([]);
  });

  it('pushes the plain message with the details folded', () => {
    resetStore();
    const pushToast = vi.fn();
    const state = useStore.getState();
    const ctx = { setProject: state.setProject, markLoaded: state.markLoaded, pushToast };
    expect(completeNativeProjectOpen(ctx, 'corrupt.lf2', failedOpen('{'))).toBe(false);
    expect(pushToast).toHaveBeenCalledWith(
      expect.stringMatching(/^corrupt\.lf2 is damaged or incomplete/),
      'error',
      { details: [expect.stringMatching(/not valid JSON/)] },
    );
  });
});

describe('a project with a missing font (U5-P3-9)', () => {
  it('warns on open, naming the font and the panel controls', () => {
    resetStore();
    const pushToast = vi.fn();
    const state = useStore.getState();
    const ctx = { setProject: state.setProject, markLoaded: state.markLoaded, pushToast };
    const opened = deserializeProject(serializeProject(projectWithText('system:Bauhaus 93')));
    expect(completeNativeProjectOpen(ctx, 'missing-font.lf2', opened)).toBe(true);
    expect(pushToast).toHaveBeenCalledWith('Opened missing-font.lf2', 'success');
    expect(pushToast).toHaveBeenCalledWith(
      "This project uses a font that isn't on this computer (Bauhaus 93). Its text will burn as saved; to edit that text, choose Import or System fonts... in the text panel.",
      'warning',
    );
  });

  it('says nothing when every font is bundled', () => {
    expect(missingFontOpenNotice(projectWithText(DEFAULT_FONT_KEY))).toBeNull();
  });

  it("gives the text panel a reason that names its real controls, not 'Relink'", () => {
    const reason = missingFontReason('system:Bauhaus 93');
    expect(reason).toBe(
      "The font Bauhaus 93 isn't on this computer. Choose a font with Import or System fonts... to edit this text.",
    );
    expect(reason).not.toMatch(/Relink/);
  });
});

describe('a broken or empty SVG (U5-P3-10)', () => {
  it('turns the XML parser line into a next step', () => {
    // Chrome's parsererror line, as parse-svg passes it through.
    const error = new Error('SVG parse error: 1:134: unexpected close tag.');
    const toast = describeImportError('broken.svg', error);
    expect(toast.message).toBe(
      "broken.svg isn't a complete SVG file (it is damaged or was cut off), so nothing was imported. Export it again from your design program, or save it as plain SVG.",
    );
    expect(toast.details).toEqual([expect.stringMatching(/^SVG parse error: /)]);
  });

  it('says an empty SVG is empty', () => {
    let error: unknown;
    try {
      parseSvg({ svgText: '', id: 'a', source: 'empty.svg' });
    } catch (caught) {
      error = caught;
    }
    expect(describeImportError('empty.svg', error)).toEqual({
      message: 'empty.svg is empty, so nothing was imported.',
      variant: 'error',
    });
  });

  it('keeps other import errors as they were', () => {
    expect(describeImportError('a.svg', new Error('Not an SVG document: root is <html>'))).toEqual({
      message: 'Could not import a.svg: Not an SVG document: root is <html>',
      variant: 'error',
    });
  });
});

describe('a refused save (U5-P3-11)', () => {
  it('names a folder it cannot write and the way out', () => {
    const readOnly = new DOMException(
      'An attempt was made to modify an object where modifications are not allowed.',
      'NoModificationAllowedError',
    );
    expect(projectWriteFailureMessage(readOnly)).toBe(
      "KerfDesk couldn't write to that file or folder. Choose another place, such as Documents, with File > Save As. Your design is still open and nothing was lost.",
    );
    expect(projectWriteFailureMessage(new DOMException('no', 'NotAllowedError'))).toMatch(
      /^KerfDesk couldn't write to that file or folder\./,
    );
    expect(
      projectWriteFailureMessage(new Error("EACCES: permission denied, open 'C:\\x.lf2'")),
    ).toMatch(/^KerfDesk couldn't write/);
  });

  it('names a full disk', () => {
    expect(projectWriteFailureMessage(new DOMException('full', 'QuotaExceededError'))).toBe(
      "There isn't enough free space to save there. Free some space, or choose another drive with File > Save As. Your design is still open and nothing was lost.",
    );
    expect(projectWriteFailureMessage(new Error('ENOSPC: no space left on device'))).toMatch(
      /^There isn't enough free space/,
    );
  });

  it('keeps an unknown failure and still says the design is kept', () => {
    expect(projectWriteFailureMessage(new Error('disk on fire'))).toBe(
      'Could not save project: disk on fire. Your design is still open and nothing was lost. Try File > Save As to choose another place.',
    );
  });
});
