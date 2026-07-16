/* eslint-disable max-lines -- bundled handwritten glyph masters are intentionally kept together */
import type { CurveSubpath, PathSegment, Vec2 } from '../scene';
import { parseHersheyJhf } from './hershey-font';
import { HERSHEY_SIMPLEX_JHF } from './hershey-simplex-data';
import { SWING_OVERRIDES, transformForgeVariant, type ForgeVariant } from './forge-font-variants';
import { GRACE_CAPITALS, GRACE_FLOURISH_CAPITALS } from './forge-grace-glyphs';
import { polishStrokePath } from './stroke-path-polish';
import type { StrokeFont, StrokeFontGlyph } from './stroke-font-text';
import { parseSvgStrokePath } from './svg-stroke-font';

export type ForgeStrokeFontKey =
  | 'forge-soft'
  | 'forge-soft-cursive'
  | 'forge-compact'
  | 'forge-sign'
  | 'forge-swing'
  | 'forge-grace'
  | 'forge-grace-flourish'
  | 'forge-signature'
  | 'forge-romantic'
  | 'forge-copperplate'
  | 'forge-casual'
  | 'forge-friendly'
  | 'forge-signwriter'
  | 'forge-parisian'
  | 'forge-personal';

type ForgeScriptVariant = Exclude<ForgeVariant, 'compact' | 'sign' | 'swing' | 'grace'>;

export const FORGE_SCRIPT_STYLE_KEYS = [
  'forge-signature',
  'forge-romantic',
  'forge-copperplate',
  'forge-casual',
  'forge-friendly',
  'forge-signwriter',
  'forge-parisian',
  'forge-personal',
] as const satisfies ReadonlyArray<ForgeStrokeFontKey>;

const FORGE_STROKE_FONT_KEYS = [
  'forge-soft',
  'forge-soft-cursive',
  'forge-compact',
  'forge-sign',
  'forge-swing',
  'forge-grace',
  'forge-grace-flourish',
  ...FORGE_SCRIPT_STYLE_KEYS,
] as const satisfies ReadonlyArray<ForgeStrokeFontKey>;

export function isForgeStrokeFontKey(value: string): value is ForgeStrokeFontKey {
  return (FORGE_STROKE_FONT_KEYS as ReadonlyArray<string>).includes(value);
}

function isForgeScriptStyleKey(
  value: ForgeStrokeFontKey,
): value is (typeof FORGE_SCRIPT_STYLE_KEYS)[number] {
  return (FORGE_SCRIPT_STYLE_KEYS as ReadonlyArray<string>).includes(value);
}

const CAP_HEIGHT = 89;
const HERSHEY_SCALE = CAP_HEIGHT / 21;
const HERSHEY_TOP = -12;
const FIT_TOLERANCE_UNITS = 1.25;
const FIRST_PRINTABLE_ASCII = 32;

type GlyphData = { readonly advance: number; readonly path: string };

const SOFT_OVERRIDES: Readonly<Record<string, GlyphData>> = {
  H: {
    advance: 104,
    path: 'M18 14 C17 39 17 74 18 103 M86 14 C85 39 85 75 86 103 M18 59 C37 53 66 63 86 57',
  },
  O: {
    advance: 104,
    path: 'M52 18 C29 17 14 33 14 59 C14 84 28 102 52 102 C76 102 90 83 89 58 C88 33 74 18 52 18',
  },
  R: {
    advance: 101,
    path: 'M18 103 C17 75 17 42 18 15 M19 16 C45 8 75 13 80 34 C85 55 65 64 19 59 M56 60 C69 72 80 87 91 103',
  },
  a: {
    advance: 94,
    path: 'M72 46 C59 34 38 35 26 50 C13 66 20 94 42 98 C59 101 72 84 73 63 M73 41 C72 61 75 84 80 99',
  },
  b: {
    advance: 91,
    path: 'M20 100 C20 77 20 48 19 19 M20 68 C30 46 47 36 61 44 C76 53 76 78 62 93 C49 106 28 98 24 82 C21 69 32 53 47 49 C61 45 73 56 75 68',
  },
  c: {
    advance: 84,
    path: 'M70 48 C59 36 40 35 27 45 C12 56 14 82 29 94 C42 105 62 100 74 87',
  },
  d: {
    advance: 94,
    path: 'M72 46 C59 34 38 35 26 50 C13 66 20 94 42 98 C59 101 72 84 73 63 M75 99 C74 76 74 48 76 18',
  },
  e: {
    advance: 91,
    path: 'M20 68 C37 69 59 63 71 52 C65 38 51 34 38 39 C21 46 16 63 22 80 C29 99 54 103 76 89',
  },
  g: {
    advance: 94,
    path: 'M72 46 C59 34 38 35 26 50 C13 66 20 94 42 98 C59 101 72 84 73 63 M74 42 C75 73 76 106 66 121 C56 137 30 134 23 117',
  },
  f: {
    advance: 66,
    path: 'M19 99 C22 79 25 55 31 33 C36 14 48 7 56 17 C64 28 55 40 47 42 M16 54 C30 51 47 52 60 54',
  },
  h: {
    advance: 93,
    path: 'M20 99 C20 74 20 45 19 18 M20 70 C31 47 48 37 61 45 C74 53 72 78 76 99',
  },
  i: { advance: 45, path: 'M22 99 C23 80 23 61 22 43 M23 23 L23 21' },
  j: {
    advance: 49,
    path: 'M27 43 C27 67 29 103 20 119 C12 133 -6 130 -10 117 M28 23 L28 21',
  },
  k: {
    advance: 83,
    path: 'M20 99 C20 74 20 45 19 18 M20 74 C34 62 49 51 66 42 M43 62 C52 74 62 87 74 99',
  },
  l: { advance: 45, path: 'M24 18 C22 46 21 74 22 99' },
  m: {
    advance: 130,
    path: 'M19 99 C20 80 20 60 19 42 M20 69 C30 47 45 37 56 45 C66 53 63 78 66 99 M66 69 C76 47 91 37 102 45 C113 53 109 78 113 99',
  },
  n: {
    advance: 94,
    path: 'M20 99 C20 80 20 60 19 42 M20 68 C31 45 48 36 61 44 C74 52 72 77 76 99',
  },
  o: {
    advance: 91,
    path: 'M47 38 C28 37 17 50 17 69 C17 89 29 101 47 101 C66 101 78 87 77 68 C76 49 65 38 47 38',
  },
  p: {
    advance: 94,
    path: 'M20 123 C20 95 20 67 19 42 M20 69 C31 46 48 36 62 44 C77 53 76 79 62 93 C49 106 28 98 24 82 C21 69 32 53 47 49 C61 45 73 56 75 68',
  },
  q: {
    advance: 94,
    path: 'M72 46 C59 34 38 35 26 50 C13 66 20 94 42 98 C59 101 72 84 73 63 M75 42 C74 69 75 96 78 123',
  },
  r: { advance: 71, path: 'M20 99 C20 80 20 60 19 42 M20 69 C29 48 44 37 60 43' },
  s: {
    advance: 84,
    path: 'M70 45 C61 35 42 34 29 42 C16 51 22 62 40 68 C61 75 73 82 68 92 C61 104 36 103 20 91',
  },
  t: {
    advance: 66,
    path: 'M33 24 C30 49 28 73 29 88 C30 101 43 105 58 96 M16 53 C30 51 47 52 60 54',
  },
  u: {
    advance: 94,
    path: 'M19 43 C18 62 17 85 26 95 C36 106 55 99 72 68 M74 42 C72 61 73 82 78 99',
  },
  v: { advance: 88, path: 'M17 43 C21 63 28 86 42 99 C56 88 66 66 72 43' },
  w: {
    advance: 125,
    path: 'M16 43 C19 64 24 87 37 99 C50 88 57 65 61 43 C65 64 70 87 83 99 C97 87 105 64 110 43',
  },
  x: {
    advance: 82,
    path: 'M18 43 C32 61 46 80 65 99 M66 42 C51 60 36 80 20 99',
  },
  y: {
    advance: 90,
    path: 'M17 43 C21 63 28 86 42 98 C56 86 66 64 72 42 M72 43 C71 76 72 107 62 121 C52 135 31 131 25 117',
  },
  z: {
    advance: 82,
    path: 'M18 45 C34 41 52 41 68 44 C52 63 36 81 21 98 C38 96 56 97 72 99',
  },
  '2': {
    advance: 91,
    path: 'M20 34 C27 17 51 11 68 20 C83 29 78 46 65 58 C52 71 36 83 22 99 C39 97 60 97 78 99',
  },
  '&': {
    advance: 104,
    path: 'M74 94 C60 105 36 104 25 90 C14 76 22 63 38 54 C57 43 66 33 59 23 C53 13 36 15 31 26 C25 40 39 55 54 70 C68 84 82 96 92 102 M79 58 C74 73 65 87 53 96',
  },
};

// Every lowercase joins at y=78. Dots and crossbars remain separate tool passes.
const CURSIVE_LOWERCASE: Readonly<Record<string, GlyphData>> = {
  a: {
    advance: 76,
    path: 'M0 78 C12 78 14 57 28 48 C42 39 59 45 59 59 C59 73 48 84 35 83 C22 82 20 65 29 55 C39 44 57 48 59 61 C60 70 62 77 76 78',
  },
  b: {
    advance: 76,
    path: 'M0 78 C13 77 18 54 23 31 C27 12 34 5 39 13 C45 24 34 48 25 61 C34 46 53 43 61 55 C70 69 58 83 45 83 C34 83 29 75 32 64 C36 53 55 53 61 65 C65 73 66 77 76 78',
  },
  c: {
    advance: 68,
    path: 'M0 78 C11 78 15 61 26 51 C36 42 53 43 58 52 C50 47 37 49 31 59 C24 70 31 82 43 82 C53 82 58 77 68 78',
  },
  d: {
    advance: 78,
    path: 'M0 78 C10 78 14 59 27 49 C40 39 56 45 57 59 C58 73 47 84 34 83 C21 82 20 65 28 55 C38 43 56 48 58 61 C60 46 62 27 66 10 C70 31 66 57 65 69 C65 76 69 78 78 78',
  },
  e: {
    advance: 69,
    path: 'M0 78 C11 78 15 61 26 52 C37 43 52 46 54 56 C55 65 39 69 25 67 C27 79 38 84 49 82 C57 80 61 77 69 78',
  },
  f: {
    advance: 58,
    path: 'M0 78 C12 77 17 55 22 32 C27 9 39 2 45 12 C52 24 40 39 20 46 M10 56 C23 54 38 55 49 57 M23 45 C20 61 20 73 28 78 C36 83 45 79 58 78',
  },
  g: {
    advance: 76,
    path: 'M0 78 C10 78 14 59 27 49 C40 39 57 45 58 59 C59 73 48 84 35 83 C22 82 20 65 29 55 C39 43 57 48 59 61 C60 77 60 94 52 104 C43 115 25 111 23 100 C29 107 42 105 49 95 C55 87 60 79 76 78',
  },
  h: {
    advance: 78,
    path: 'M0 78 C12 77 18 50 23 28 C27 10 34 4 39 13 C45 25 34 51 25 64 C34 48 49 43 58 50 C67 58 61 72 66 77 C69 79 73 78 78 78',
  },
  i: {
    advance: 45,
    path: 'M0 78 C12 78 17 62 22 50 C19 64 19 75 26 78 C31 80 37 78 45 78 M25 32 L26 30',
  },
  j: {
    advance: 48,
    path: 'M0 78 C11 78 16 62 22 50 C20 69 22 91 15 102 C9 112 -5 109 -7 100 M25 32 L26 30 M15 102 C22 91 29 80 48 78',
  },
  k: {
    advance: 72,
    path: 'M0 78 C12 77 18 51 23 29 C27 10 34 5 39 14 C45 26 34 52 25 64 C36 58 49 50 60 45 C51 55 43 64 35 69 C45 70 53 75 59 78 C63 80 67 78 72 78',
  },
  l: {
    advance: 49,
    path: 'M0 78 C13 77 18 52 23 29 C27 10 34 5 39 14 C45 27 33 55 25 68 C20 76 28 82 37 80 C41 79 45 78 49 78',
  },
  m: {
    advance: 105,
    path: 'M0 78 C11 78 16 61 21 49 C19 62 21 72 25 78 C30 61 38 47 49 48 C60 49 57 67 61 77 C66 60 74 47 85 49 C96 51 91 70 96 76 C98 79 101 78 105 78',
  },
  n: {
    advance: 79,
    path: 'M0 78 C11 78 16 61 21 49 C19 63 21 73 25 78 C31 60 40 47 52 49 C64 51 59 70 65 76 C68 79 73 78 79 78',
  },
  o: {
    advance: 74,
    path: 'M0 78 C11 78 15 59 28 49 C41 39 58 46 59 60 C60 74 49 84 36 83 C23 82 20 66 28 55 C37 43 55 48 59 61 C61 71 64 77 74 78',
  },
  p: {
    advance: 76,
    path: 'M0 78 C11 78 16 61 21 49 C20 68 20 89 17 105 M22 64 C30 47 47 43 57 53 C68 65 59 81 46 83 C34 85 27 76 30 65 C34 53 53 52 59 65 C63 74 66 78 76 78',
  },
  q: {
    advance: 75,
    path: 'M0 78 C10 78 14 59 27 49 C40 39 57 45 58 59 C59 73 48 84 35 83 C22 82 20 65 29 55 C39 43 57 48 59 61 C61 78 62 91 70 104 M59 62 C60 72 64 78 75 78',
  },
  r: {
    advance: 61,
    path: 'M0 78 C11 78 16 61 21 49 C19 63 21 73 25 78 C31 59 42 46 54 50 C48 48 41 52 36 61 C31 70 42 78 61 78',
  },
  s: {
    advance: 65,
    path: 'M0 78 C11 78 16 62 26 51 C36 40 53 44 55 53 C46 48 34 52 34 60 C34 67 52 67 52 75 C52 83 37 85 27 79 C38 82 48 78 65 78',
  },
  t: {
    advance: 62,
    path: 'M0 78 C12 78 17 60 23 42 C28 27 31 17 34 10 C34 35 28 61 27 70 C26 80 37 83 46 80 C51 78 56 78 62 78 M15 48 C28 46 43 47 53 49',
  },
  u: {
    advance: 79,
    path: 'M0 78 C11 78 16 62 21 49 C18 63 17 78 28 81 C40 84 51 66 56 50 C54 65 55 74 61 78 C66 81 72 78 79 78',
  },
  v: {
    advance: 72,
    path: 'M0 78 C11 78 16 62 21 50 C20 65 24 80 35 82 C46 83 56 66 60 50 C58 64 59 75 64 78 C66 79 69 78 72 78',
  },
  w: {
    advance: 103,
    path: 'M0 78 C11 78 16 62 21 50 C20 65 24 80 35 81 C45 82 51 66 55 51 C54 66 58 80 69 81 C81 82 91 65 94 50 C92 65 94 75 98 78 C100 79 102 78 103 78',
  },
  x: {
    advance: 70,
    path: 'M0 78 C12 78 18 62 25 51 C34 63 43 74 52 79 C57 81 63 78 70 78 M53 49 C44 58 36 69 28 78',
  },
  y: {
    advance: 76,
    path: 'M0 78 C11 78 16 62 21 50 C19 65 22 80 34 81 C46 82 56 65 60 50 C58 72 58 93 50 103 C41 114 25 110 23 100 C29 106 41 104 48 95 C55 86 59 79 76 78',
  },
  z: {
    advance: 68,
    path: 'M0 78 C11 78 16 62 26 51 C35 42 49 44 55 50 C45 59 36 68 27 78 C38 75 50 75 58 78 C49 87 41 97 31 105 C42 98 52 84 68 78',
  },
};

export function forgeStrokeFont(key: ForgeStrokeFontKey): StrokeFont {
  const upright = uprightGlyphs();
  if (key === 'forge-soft') {
    addAccentedGlyphs(upright, identityPoint);
    return forgeFont(upright);
  }
  if (key === 'forge-soft-cursive') {
    const cursive = cursiveGlyphs(upright);
    addAccentedGlyphs(cursive, slantPoint);
    return forgeFont(cursive);
  }
  if (key === 'forge-compact') {
    addAccentedGlyphs(upright, identityPoint);
    return forgeFont(transformForgeVariant(upright, 'compact'));
  }
  if (key === 'forge-sign') {
    addAccentedGlyphs(upright, identityPoint);
    return forgeFont(transformForgeVariant(upright, 'sign'));
  }
  if (key === 'forge-grace' || key === 'forge-grace-flourish') {
    const grace = cursiveGlyphs(upright);
    for (const [character, data] of Object.entries(GRACE_CAPITALS)) {
      grace.set(character, svgGlyph(data, slantPoint));
    }
    if (key === 'forge-grace-flourish') {
      for (const [character, data] of Object.entries(GRACE_FLOURISH_CAPITALS)) {
        grace.set(character, svgGlyph(data, slantPoint));
      }
    }
    addAccentedGlyphs(grace, slantPoint);
    return forgeFont(transformForgeVariant(grace, 'grace'));
  }

  if (isForgeScriptStyleKey(key)) {
    return forgeFont(scriptStyleGlyphs(key, upright));
  }

  const swing = cursiveGlyphs(upright);
  for (const [character, data] of Object.entries(SWING_OVERRIDES)) {
    swing.set(character, svgGlyph(data, slantPoint));
  }
  addAccentedGlyphs(swing, slantPoint);
  return forgeFont(transformForgeVariant(swing, 'swing'));
}

function scriptStyleGlyphs(
  key: (typeof FORGE_SCRIPT_STYLE_KEYS)[number],
  upright: ReadonlyMap<string, StrokeFontGlyph>,
): Map<string, StrokeFontGlyph> {
  const glyphs = cursiveGlyphs(upright, identityPoint);
  const usesGraceCapitals =
    key === 'forge-signature' ||
    key === 'forge-romantic' ||
    key === 'forge-copperplate' ||
    key === 'forge-parisian';
  if (usesGraceCapitals) applyGlyphData(glyphs, GRACE_CAPITALS, identityPoint);
  if (key === 'forge-romantic' || key === 'forge-parisian') {
    applyGlyphData(glyphs, GRACE_FLOURISH_CAPITALS, identityPoint);
  }
  if (key === 'forge-signwriter' || key === 'forge-personal') {
    applyGlyphData(glyphs, SWING_OVERRIDES, identityPoint);
  }
  addAccentedGlyphs(glyphs, identityPoint);
  return transformForgeVariant(glyphs, scriptVariant(key));
}

function scriptVariant(key: (typeof FORGE_SCRIPT_STYLE_KEYS)[number]): ForgeScriptVariant {
  return key.slice('forge-'.length) as ForgeScriptVariant;
}

function applyGlyphData(
  glyphs: Map<string, StrokeFontGlyph>,
  source: Readonly<Record<string, GlyphData>>,
  point: (value: Vec2) => Vec2,
): void {
  for (const [character, data] of Object.entries(source)) {
    glyphs.set(character, svgGlyph(data, point));
  }
}

function forgeFont(glyphs: ReadonlyMap<string, StrokeFontGlyph>): StrokeFont {
  return { capHeight: CAP_HEIGHT, yAxis: 'down', glyphs };
}

function uprightGlyphs(): Map<string, StrokeFontGlyph> {
  const source = parseHersheyJhf(HERSHEY_SIMPLEX_JHF);
  const glyphs = new Map<string, StrokeFontGlyph>();
  source.forEach((glyph, index) => {
    const paths = glyph.strokes.map((stroke) =>
      polishStrokePath(pointsPath(stroke.map((point) => hersheyPoint(point, glyph.left))), {
        fitToleranceUnits: FIT_TOLERANCE_UNITS,
      }),
    );
    glyphs.set(String.fromCharCode(FIRST_PRINTABLE_ASCII + index), {
      advance: (glyph.right - glyph.left) * HERSHEY_SCALE,
      paths,
    });
  });
  for (const [character, data] of Object.entries(SOFT_OVERRIDES)) {
    glyphs.set(
      character,
      svgGlyph(data, (point) => ({ x: point.x, y: point.y - 14 })),
    );
  }
  return glyphs;
}

function cursiveGlyphs(
  upright: ReadonlyMap<string, StrokeFontGlyph>,
  point: (value: Vec2) => Vec2 = slantPoint,
): Map<string, StrokeFontGlyph> {
  const glyphs = new Map<string, StrokeFontGlyph>();
  for (const [character, glyph] of upright) {
    glyphs.set(character, {
      advance: glyph.advance,
      paths: glyph.paths.map((path) => transformPath(path, point)),
    });
  }
  for (const [character, data] of Object.entries(CURSIVE_LOWERCASE)) {
    glyphs.set(character, svgGlyph(data, point));
  }
  return glyphs;
}

function addAccentedGlyphs(
  glyphs: Map<string, StrokeFontGlyph>,
  accentPoint: (value: Vec2) => Vec2,
): void {
  const accents: ReadonlyArray<
    readonly [string, string, 'acute' | 'grave' | 'circumflex' | 'diaeresis' | 'tilde' | 'cedilla']
  > = [
    ['é', 'e', 'acute'],
    ['è', 'e', 'grave'],
    ['ê', 'e', 'circumflex'],
    ['ë', 'e', 'diaeresis'],
    ['á', 'a', 'acute'],
    ['à', 'a', 'grave'],
    ['â', 'a', 'circumflex'],
    ['ä', 'a', 'diaeresis'],
    ['í', 'i', 'acute'],
    ['ó', 'o', 'acute'],
    ['ú', 'u', 'acute'],
    ['ü', 'u', 'diaeresis'],
    ['ñ', 'n', 'tilde'],
    ['ç', 'c', 'cedilla'],
  ];
  for (const [target, baseCharacter, accent] of accents) {
    const base = glyphs.get(baseCharacter);
    if (base === undefined) continue;
    glyphs.set(target, {
      ...base,
      paths: [
        ...base.paths,
        ...accentPaths(accent, base.advance).map((path) => transformPath(path, accentPoint)),
      ],
    });
  }
}

function accentPaths(
  accent: 'acute' | 'grave' | 'circumflex' | 'diaeresis' | 'tilde' | 'cedilla',
  advance: number,
): ReadonlyArray<CurveSubpath> {
  const center = advance / 2;
  const path =
    accent === 'acute'
      ? `M${center - 6} 22 L${center + 5} 7`
      : accent === 'grave'
        ? `M${center - 5} 7 L${center + 6} 22`
        : accent === 'circumflex'
          ? `M${center - 10} 20 L${center} 7 L${center + 10} 20`
          : accent === 'diaeresis'
            ? `M${center - 9} 13 L${center - 8} 12 M${center + 8} 13 L${center + 9} 12`
            : accent === 'tilde'
              ? `M${center - 14} 17 C${center - 7} 8 ${center} 24 ${center + 14} 13`
              : `M${center + 3} 84 C${center + 8} 94 ${center - 5} 101 ${center - 9} 94`;
  return parseSvgStrokePath(path);
}

function svgGlyph(data: GlyphData, point: (value: Vec2) => Vec2): StrokeFontGlyph {
  return {
    advance: data.advance,
    paths: parseSvgStrokePath(data.path).map((path) => transformPath(path, point)),
  };
}

function hersheyPoint(point: Vec2, left: number): Vec2 {
  return { x: (point.x - left) * HERSHEY_SCALE, y: (point.y - HERSHEY_TOP) * HERSHEY_SCALE };
}

function slantPoint(point: Vec2): Vec2 {
  return { x: point.x + (CAP_HEIGHT - point.y) * 0.2, y: point.y };
}

function identityPoint(point: Vec2): Vec2 {
  return point;
}

function pointsPath(points: ReadonlyArray<Vec2>): CurveSubpath {
  return {
    start: points[0] ?? { x: 0, y: 0 },
    closed: false,
    segments: points.slice(1).map((to) => ({ kind: 'line' as const, to })),
  };
}

function transformPath(path: CurveSubpath, point: (value: Vec2) => Vec2): CurveSubpath {
  return {
    ...path,
    start: point(path.start),
    segments: path.segments.map((segment): PathSegment => {
      if (segment.kind === 'line') return { ...segment, to: point(segment.to) };
      if (segment.kind === 'cubic')
        return {
          ...segment,
          control1: point(segment.control1),
          control2: point(segment.control2),
          to: point(segment.to),
        };
      return { ...segment, to: point(segment.to) };
    }),
  };
}
