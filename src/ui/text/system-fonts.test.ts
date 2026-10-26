// @vitest-environment node
// Node's Blob and File read their bytes; jsdom's do not.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  filterSystemFonts,
  groupSystemFonts,
  querySystemFonts,
  systemFontFile,
  systemFontsSupported,
  type SystemFontFace,
} from './system-fonts';

const roboto = new Uint8Array(readFileSync(resolve(__dirname, 'fonts/Roboto-Regular.ttf')));

function face(family: string, style: string, bytes: Uint8Array = roboto): SystemFontFace {
  const fullName = style === 'Regular' ? family : `${family} ${style}`;
  return {
    family,
    style,
    fullName,
    postscriptName: fullName.replace(/\s+/g, '-'),
    blob: () => Promise.resolve(new Blob([bytes.slice()])),
  };
}

describe('system font list (ADR-628)', () => {
  it('detects the Local Font Access API', () => {
    expect(systemFontsSupported({ queryLocalFonts: () => Promise.resolve([]) })).toBe(true);
    expect(systemFontsSupported({})).toBe(false);
  });

  it('reports a browser without the API instead of failing', async () => {
    await expect(querySystemFonts({})).resolves.toEqual({ kind: 'unsupported' });
  });

  it('reports a refused permission as denied', async () => {
    const host = {
      queryLocalFonts: () => Promise.reject(new DOMException('no', 'NotAllowedError')),
    };
    await expect(querySystemFonts(host)).resolves.toEqual({ kind: 'denied' });
    const insecure = {
      queryLocalFonts: () => {
        throw new DOMException('gesture', 'SecurityError');
      },
    };
    await expect(querySystemFonts(insecure)).resolves.toEqual({ kind: 'denied' });
  });

  it('groups faces by family, Regular first, without duplicates', async () => {
    const faces = [
      face('Zed Sans', 'Bold'),
      face('arial', 'Italic'),
      face('Zed Sans', 'Regular'),
      face('Zed Sans', 'Bold'),
      face('Arial', 'Regular'),
    ];
    const result = await querySystemFonts({ queryLocalFonts: () => Promise.resolve(faces) });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;
    expect(result.families.map((family) => family.family)).toEqual(['arial', 'Arial', 'Zed Sans']);
    expect(result.families[2]?.faces.map((entry) => entry.style)).toEqual(['Regular', 'Bold']);
  });

  it('filters by family or by a face name, word by word', () => {
    const families = groupSystemFonts([
      face('Open Sans', 'Regular'),
      face('Open Sans', 'Bold'),
      face('Courier New', 'Bold Italic'),
    ]);
    expect(filterSystemFonts(families, '').length).toBe(2);
    expect(filterSystemFonts(families, 'open')[0]?.faces.length).toBe(2);
    const narrowed = filterSystemFonts(families, 'courier italic');
    expect(narrowed.map((family) => family.family)).toEqual(['Courier New']);
    expect(filterSystemFonts(families, 'sans bold')[0]?.faces.map((entry) => entry.style)).toEqual([
      'Bold',
    ]);
    expect(filterSystemFonts(families, 'wingdings')).toEqual([]);
  });
});

describe('system font file (ADR-628)', () => {
  it('turns a single face into a .ttf named after the face', async () => {
    const chosen = await systemFontFile(face('Roboto', 'Regular'));
    expect(chosen.file.name).toBe('Roboto.ttf');
    expect(chosen.restricted).toBe(false);
    const bytes = Buffer.from(await chosen.file.arrayBuffer());
    expect(bytes.equals(Buffer.from(roboto))).toBe(true);
  });

  it('names a CFF-outline face .otf and keeps file-system characters out of the name', async () => {
    const cff = roboto.slice();
    cff.set([0x4f, 0x54, 0x54, 0x4f], 0);
    const chosen = await systemFontFile({ ...face('A/B', 'Regular', cff), fullName: 'A/B: C' });
    expect(chosen.file.name).toBe('A-B- C.otf');
  });

  it('copies the chosen face out of a collection', async () => {
    const collection = singleFaceCollection(roboto);
    const chosen = await systemFontFile(face('Roboto', 'Regular', collection));
    const bytes = new Uint8Array(await chosen.file.arrayBuffer());
    expect(new DataView(bytes.buffer).getUint32(0)).toBe(0x00010000);
    expect(chosen.file.name).toBe('Roboto.ttf');
  });
});

function singleFaceCollection(font: Uint8Array): Uint8Array {
  const output = new Uint8Array(16 + font.byteLength);
  const data = new DataView(output.buffer);
  data.setUint32(0, 0x74746366);
  data.setUint16(4, 1);
  data.setUint32(8, 1);
  data.setUint32(12, 16);
  output.set(font, 16);
  const tables = data.getUint16(16 + 4);
  for (let table = 0; table < tables; table++) {
    const at = 16 + 12 + table * 16 + 8;
    data.setUint32(at, data.getUint32(at) + 16);
  }
  return output;
}
