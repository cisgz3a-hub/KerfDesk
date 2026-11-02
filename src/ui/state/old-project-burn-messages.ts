import type { OldProjectBurnNotice } from '../../io/project/project-load-metadata';

// The words for what an upgraded project burns differently, shared by the load
// notices and Job Review (ADR-682 Amendment 3).
const MAX_NAMED = 3;
const MAX_LABEL_CHARACTERS = 40;

type InkSize = { readonly widthMm: number; readonly heightMm: number };

export function oldProjectBurnMessages(notice: OldProjectBurnNotice): {
  readonly frames: ReadonlyArray<string>;
  readonly burn: ReadonlyArray<string>;
} {
  return {
    frames: [repairedFramesMessage(notice), uncertainFramesMessage(notice)].flatMap(present),
    burn: [movedRecordsMessage(notice), imageDoseMessage(notice)].flatMap(present),
  };
}

function present(message: string | null): ReadonlyArray<string> {
  return message === null ? [] : [message];
}

function repairedFramesMessage({ repairedFrames }: OldProjectBurnNotice): string | null {
  if (repairedFrames.length === 0) return null;
  const named = listed(repairedFrames, (frame) =>
    frame.record === undefined
      ? `${quoted(frame.label)} keeps ${size(frame.after)} when edited, not ${size(frame.before)}`
      : `${quoted(frame.label)}: ${quoted(frame.record)} goes from ${size(frame.before)} back to ${size(frame.after)}`,
  );
  return (
    `KerfDesk 1.0.28 refitted framed text in this project smaller than it was designed. ` +
    `It now fits as designed: ${named}. If you kept the smaller size on purpose, lower Size. ` +
    'Frame before you run it.'
  );
}

function uncertainFramesMessage({ uncertainFrames }: OldProjectBurnNotice): string | null {
  if (uncertainFrames.length === 0) return null;
  const named = listed(uncertainFrames, (frame) =>
    frame.record === undefined || frame.now === undefined || frame.before === undefined
      ? quoted(frame.label)
      : `${quoted(frame.label)}: ${quoted(frame.record)} burns ${size(frame.now)} now and burned ${size(frame.before)} before 1.0.28`,
  );
  return (
    `This file cannot show whether framed text was designed before or on 1.0.28, ` +
    `so it stays as it is: ${named}. Check its sizes in the text dialog's rows before you run it.`
  );
}

function movedRecordsMessage({ movedRecords }: OldProjectBurnNotice): string | null {
  if (movedRecords.length === 0) return null;
  return (
    `Variable text now follows its template's baseline, so records of ` +
    `${listed(movedRecords, (text) => quoted(text.label))} can burn in a different place than ` +
    'in an earlier version. Frame before you run a batch.'
  );
}

function imageDoseMessage({ imageDose }: OldProjectBurnNotice): string | null {
  const dotWidth = imageDose.filter((image) => image.change === 'dot-width');
  const turned = imageDose.filter((image) => image.change === 'turned-pass-through');
  const parts = [
    ...(dotWidth.length === 0
      ? []
      : [
          `Dot Width no longer trims between pixels, so ${listed(dotWidth, labelOf)} burns darker, closer to its Preview`,
        ]),
    ...(turned.length === 0
      ? []
      : [
          `turned Pass-Through now reads every row, so ${listed(turned, labelOf)} burns darker and keeps its tone`,
        ]),
  ];
  if (parts.length === 0) return null;
  return `Images tuned on an earlier version burn more energy now: ${parts.join('; ')}. Run a test before you burn real stock.`;
}

function labelOf(image: { readonly label: string }): string {
  return quoted(image.label);
}

function listed<T>(items: ReadonlyArray<T>, describe: (item: T) => string): string {
  const named = items.slice(0, MAX_NAMED).map(describe);
  const more = items.length - named.length;
  return more > 0 ? `${named.join('; ')} and ${more} more` : named.join('; ');
}

function quoted(label: string): string {
  const characters = Array.from(label);
  return characters.length <= MAX_LABEL_CHARACTERS
    ? `“${label}”`
    : `“${characters.slice(0, MAX_LABEL_CHARACTERS).join('')}…”`;
}

function size(ink: InkSize): string {
  return `${ink.widthMm.toFixed(2)} × ${ink.heightMm.toFixed(2)} mm`;
}
