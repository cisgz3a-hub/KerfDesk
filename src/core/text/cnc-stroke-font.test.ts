import { describe, expect, it } from 'vitest';
import { CNC_STROKE_FONT_DATA } from './cnc-stroke-font-data';
import { svgStrokeFont } from './svg-stroke-font';

const EXPECTED_SOURCES = [
  {
    key: 'relief-single-line',
    displayName: 'Relief SingleLine',
    license: 'OFL-1.1',
    sourceFile: 'ReliefSingleLineSVG-Regular.svg',
    sourceSha256: '75f05a5b64ed6039c9816628ee051d98e16c19148a8268c63f5eccf8382479e2',
    sourceCommit: '01dfc5779ec1e9e4b288d96c6c96c23bfccbaf9d',
  },
  {
    key: 'ems-nixish',
    displayName: 'EMS Nixish',
    license: 'OFL-1.1',
    sourceFile: 'EMSNixish.svg',
    sourceSha256: '418b9986220ebce947396af4f918d20266cd42d22d4d141fdd52c8ea20980ec6',
    sourceCommit: '8c71f2d9e1a5292047bb88e5595a766241b82cc6',
  },
  {
    key: 'ems-decorous-script',
    displayName: 'EMS Decorous Script',
    license: 'OFL-1.1',
    sourceFile: 'EMSDecorousScript.svg',
    sourceSha256: '131fc9b7cead71f7a907aa793b7a862be2acef041209e7a2dedc233a2d53ebfc',
    sourceCommit: '8c71f2d9e1a5292047bb88e5595a766241b82cc6',
  },
  {
    key: 'ems-casual-hand',
    displayName: 'EMS Casual Hand',
    license: 'OFL-1.1',
    sourceFile: 'EMSCasualHand.svg',
    sourceSha256: 'e8c64afb9739ff78b3cd0ae1bfb95d21fb1077eda569e0eef5d262b64da38041',
    sourceCommit: '8c71f2d9e1a5292047bb88e5595a766241b82cc6',
  },
] as const;

describe('pinned OFL CNC stroke-font data', () => {
  it('records the exact reviewed sources and canonical remote-byte hashes', () => {
    expect(
      CNC_STROKE_FONT_DATA.map(
        ({ key, displayName, license, sourceFile, sourceSha256, sourceCommit }) => ({
          key,
          displayName,
          license,
          sourceFile,
          sourceSha256,
          sourceCommit,
        }),
      ),
    ).toEqual(EXPECTED_SOURCES);
  });

  it.each(CNC_STROKE_FONT_DATA)(
    '$displayName compiles every glyph as finite open geometry',
    (data) => {
      const font = svgStrokeFont(data);

      expect(font.capHeight).toBeGreaterThan(0);
      for (const character of [' ', '?', 'A', 'a', '0', '\u00e9']) {
        expect(font.glyphs.has(character), `${data.displayName} glyph ${character}`).toBe(true);
      }
      for (const glyph of font.glyphs.values()) {
        expect(Number.isFinite(glyph.advance)).toBe(true);
        for (const path of glyph.paths) {
          expect(path.closed).toBe(false);
          expect(Number.isFinite(path.start.x) && Number.isFinite(path.start.y)).toBe(true);
          for (const segment of path.segments) {
            expect(Number.isFinite(segment.to.x) && Number.isFinite(segment.to.y)).toBe(true);
            if (segment.kind !== 'cubic') continue;
            expect(
              Number.isFinite(segment.control1.x) &&
                Number.isFinite(segment.control1.y) &&
                Number.isFinite(segment.control2.x) &&
                Number.isFinite(segment.control2.y),
            ).toBe(true);
          }
        }
      }
    },
  );
});
