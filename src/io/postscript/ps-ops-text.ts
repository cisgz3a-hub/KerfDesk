// Font, text and file operators. Text is never drawn: each show counts as a
// skipped text item so the import can tell the operator to outline it first.
// Embedded encrypted fonts (eexec) are skipped; any other read from the file
// itself (image data, filters) stops the import with a clear reason.

import type { OpTable } from './ps-ops-stack';
import type { PsVm } from './ps-vm';
import { PsError, psDict, psName, type PsDict } from './ps-types';

const skipText =
  (operands: number) =>
  (vm: PsVm): void => {
    for (let i = 0; i < operands; i += 1) vm.pop();
    vm.note('text');
  };

export const TEXT_OPS: OpTable = {
  findfont: (vm) => {
    vm.pop();
    vm.push(fontDict());
  },
  scalefont: (vm) => {
    vm.pop();
  },
  makefont: (vm) => {
    vm.pop();
  },
  setfont: (vm) => void vm.pop(),
  selectfont: (vm) => {
    vm.pop();
    vm.pop();
  },
  currentfont: (vm) => vm.push(fontDict()),
  rootfont: (vm) => vm.push(fontDict()),
  definefont: (vm) => {
    const font = vm.pop();
    vm.pop();
    vm.push(font);
  },
  undefinefont: (vm) => void vm.pop(),
  composefont: (vm) => {
    vm.pop();
    vm.pop();
    vm.pop();
    vm.push(fontDict());
  },
  show: skipText(1),
  ashow: skipText(3),
  widthshow: skipText(4),
  awidthshow: skipText(6),
  kshow: skipText(2),
  cshow: skipText(2),
  xshow: skipText(2),
  yshow: skipText(2),
  xyshow: skipText(2),
  glyphshow: skipText(1),
  charpath: skipText(2),
  stringwidth: (vm) => {
    vm.pop();
    vm.push(0);
    vm.push(0);
  },
  setcachedevice: (vm) => void vm.popNumbers(6),
  setcachedevice2: (vm) => void vm.popNumbers(10),
  setcharwidth: (vm) => void vm.popNumbers(2),
  currentfile: (vm) => vm.push({ kind: 'file' }),
  eexec: (vm) => {
    vm.pop();
    if (vm.tokenizer === null) throw new PsError('unsupported', 'eexec without a file.');
    vm.tokenizer.skipEncryptedSection();
    vm.note('font');
  },
  closefile: (vm) => void vm.pop(),
  readstring: fileRead,
  readhexstring: fileRead,
  readline: fileRead,
  read: fileRead,
  filter: fileRead,
  token: fileRead,
};

function fileRead(): never {
  throw new PsError(
    'unsupported',
    'The file reads embedded data (usually an image). Save it again without images, or import it as PDF or SVG.',
  );
}

function fontDict(): PsDict {
  const font = psDict();
  font.map.set('FontMatrix', { kind: 'array', items: [0.001, 0, 0, 0.001, 0, 0], exec: false });
  font.map.set('FontName', psName('KerfDeskSkippedFont'));
  font.map.set('FontType', 1);
  return font;
}
