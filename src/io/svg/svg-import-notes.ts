// What an SVG import leaves out or changes, counted during the walk and told to
// the operator as import notes. Notes that start with "SVG presentation:" are
// shown as warning toasts (ui/app/import-toasts.ts).

import { svgImportSizeNote, type SvgImportBudget } from './svg-import-budget';

/** Why an embedded image was not imported; 'no-data' has no bitmap to import at all. */
export type SvgImageSkipReason = 'no-data' | 'format' | 'effects' | 'size' | 'fit' | 'shear';

export type SvgImportCounts = {
  text: number;
  image: number;
  fillAndStroke: number;
  masked: number;
  filtered: number;
  gradient: number;
  pattern: number;
  circularUse: number;
  markers: number;
  readonly skippedImages: Record<Exclude<SvgImageSkipReason, 'no-data'>, number>;
};

export function createSvgImportCounts(): SvgImportCounts {
  return {
    text: 0,
    image: 0,
    fillAndStroke: 0,
    masked: 0,
    filtered: 0,
    gradient: 0,
    pattern: 0,
    circularUse: 0,
    markers: 0,
    skippedImages: { format: 0, effects: 0, size: 0, fit: 0, shear: 0 },
  };
}

const SKIPPED_IMAGE_REASONS: Readonly<Record<Exclude<SvgImageSkipReason, 'no-data'>, string>> = {
  format:
    'their data is not a PNG, JPEG, BMP or WebP bitmap (such as GIF or SVG); embed them as PNG or JPEG',
  effects: 'they have opacity, a filter or a mask, which an engraved image cannot reproduce',
  size: 'they lack an absolute x, y and a width and height above zero',
  fit: 'their preserveAspectRatio crops them (slice) or their bitmap size cannot be read',
  shear: 'their transform skews or flattens them, which an image object cannot represent',
};

export function svgImportNotes(
  entryCount: number,
  budget: SvgImportBudget,
  counts: SvgImportCounts,
): string[] {
  const notes: string[] = [];
  if (entryCount === 0) notes.push('SVG has no drawable geometry');
  // Rule 7 / ADR-268: this used to THROW mid-walk once the polyline/point/color
  // ceilings were crossed. It now reports the same measurement and imports.
  const sizeNote = svgImportSizeNote(budget);
  if (sizeNote !== null) notes.push(sizeNote);
  if (counts.text > 0) {
    notes.push(
      `Ignored ${counts.text} text element(s) — convert text to paths in your editor before exporting`,
    );
  }
  if (counts.image > 0) {
    notes.push(
      `Ignored ${counts.image} image element(s) with no embedded bitmap data — embed the images in the SVG`,
    );
  }
  return [...notes, ...presentationNotes(counts)];
}

function presentationNotes(counts: SvgImportCounts): string[] {
  const notes = [
    [counts.fillAndStroke, 'Imported $ SVG element(s) as strokes only; their fills were omitted.'],
    [
      counts.masked,
      'Imported $ SVG element(s) without their masks; areas the masks hide are included.',
    ],
    [counts.filtered, 'Imported $ SVG element(s) without their filter effects.'],
    [
      counts.gradient,
      "Imported $ SVG element(s) painted with a gradient in one solid colour, the gradient's first visible stop.",
    ],
    [
      counts.pattern,
      'Skipped the pattern paint of $ SVG element(s); pattern fills, including image fills, are not imported.',
    ],
    [counts.circularUse, 'Skipped $ circular <use> reference(s), which SVG does not render.'],
    [counts.markers, 'Imported $ SVG element(s) without their markers, such as arrowheads.'],
    ...Object.entries(SKIPPED_IMAGE_REASONS).map(
      ([reason, why]) =>
        [
          counts.skippedImages[reason as keyof typeof SKIPPED_IMAGE_REASONS],
          `Skipped $ embedded image(s) because ${why}; the rest of the file imported.`,
        ] as const,
    ),
  ] as const;
  return notes
    .filter(([count]) => count > 0)
    .map(([count, text]) => `SVG presentation: ${text.replace('$', String(count))}`);
}
