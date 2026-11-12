// EPS / PostScript / Adobe Illustrator 3–8 artwork to SVG text (ADR-700).
// Clean-room subset interpreter: no Ghostscript (AGPL) and no rendering. The
// SVG goes through the ordinary SVG import, so sizing, colours, operations and
// white-fill handling match every other vector import.

import { aiOps, createAiState } from './ai-ops';
import { boundingBox, illustratorScript, isIllustratorFile, postscriptText } from './ps-source';
import { paintedSvg } from './ps-svg';
import { createPsVm, installOps } from './ps-system';
import { PsTokenizer } from './ps-tokenizer';
import { PsError, psDict, type PsValue } from './ps-types';
import type { PsVm } from './ps-vm';

export type PostscriptConversion =
  | {
      readonly kind: 'ok';
      readonly svg: string;
      readonly pathCount: number;
      readonly illustrator: boolean;
      readonly notes: readonly string[];
    }
  | { readonly kind: 'error'; readonly reason: string };

const NOTE_TEXT: Readonly<Record<string, (count: number) => string>> = {
  text: (n) =>
    `${n} text item${n === 1 ? ' was' : 's were'} skipped. Convert text to outlines before saving the file.`,
  clip: () => 'Clipping masks are ignored; the full shapes were imported.',
  dash: () => 'Dashed lines were imported as solid lines.',
  image: () => 'Placed or embedded images were skipped.',
  gradient: () => 'Gradient fills were imported as a solid colour.',
  shading: () => 'Gradient (shading) fills were skipped.',
  pattern: () => 'Pattern fills were imported as a solid colour.',
};

export type PostscriptOptions = {
  /** Milliseconds for the run's time limit; tests pass a scripted clock. */
  readonly clock?: () => number;
};

export function convertPostscript(
  bytes: Uint8Array,
  options: PostscriptOptions = {},
): PostscriptConversion {
  try {
    const text = postscriptText(bytes);
    const illustrator = isIllustratorFile(text);
    const vm = createPsVm(options.clock);
    const program = illustrator ? prepareIllustrator(vm, text) : text;
    vm.run(new PsTokenizer(program, (name) => immediate(vm, name)));
    if (vm.painted.length === 0) return { kind: 'error', reason: noPathsReason(illustrator) };
    const page = paintedSvg(vm.painted, boundingBox(text));
    const notes = [...vm.notes]
      .map(([code, count]) => NOTE_TEXT[code]?.(count))
      .filter((note): note is string => note !== undefined);
    if (page.outsideBox)
      notes.push("Some artwork lies outside the file's bounding box; all of it was imported.");
    if (/^%%Pages:\s*([2-9]|\d{2,})/m.test(text)) notes.push('Only the first page was imported.');
    return {
      kind: 'ok',
      svg: page.svg,
      pathCount: vm.painted.reduce((sum, path) => sum + path.subpaths.length, 0),
      illustrator,
      notes,
    };
  } catch (error) {
    return { kind: 'error', reason: failureReason(error) };
  }
}

function prepareIllustrator(vm: PsVm, text: string): string {
  const dict = psDict();
  installOps(dict, aiOps(createAiState()));
  vm.dicts.push(dict);
  vm.unknownName = () => void vm.operands.splice(0);
  return illustratorScript(text);
}

/** Illustrator 9 and later draw EPS artwork with their own procsets, not the AI 3–8 operators. */
function noPathsReason(illustrator: boolean): string {
  return illustrator
    ? 'No drawable paths were found. Files from Illustrator 9 or later keep their artwork in a form KerfDesk cannot read: save them as SVG or PDF.'
    : 'No drawable paths were found in the file.';
}

function immediate(vm: PsVm, name: string): PsValue {
  const value = vm.lookup(name);
  if (value === undefined)
    throw new PsError('undefined', `The file uses "${name}" before defining it.`);
  return value;
}

function failureReason(error: unknown): string {
  if (error instanceof PsError) {
    const advice =
      error.code === 'budget' || error.code === 'image'
        ? ''
        : ' Save it again as SVG or PDF from the program that made it.';
    return error.message + advice;
  }
  return 'The file could not be read as PostScript.';
}
