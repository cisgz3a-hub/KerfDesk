// system-fonts — the Local Font Access API behind **System fonts...**
// (ADR-628). Fonts are listed only when the operator asks, held in memory
// while the dialog is open, and a chosen face becomes an ordinary font file
// for the existing embed path. Nothing here stores or sends the list.
// https://wicg.github.io/local-font-access/

import {
  collectionFaceIndex,
  extractCollectionFace,
  fontEmbeddingRestricted,
  isFontCollection,
} from '../../core/text/font-collection';

/** One installed face as the browser describes it. */
export type SystemFontFace = {
  readonly family: string;
  readonly fullName: string;
  readonly postscriptName: string;
  readonly style: string;
  readonly blob: () => Promise<Blob>;
};

export type SystemFontFamily = {
  readonly family: string;
  readonly faces: ReadonlyArray<SystemFontFace>;
};

export type SystemFontQuery =
  | { readonly kind: 'ok'; readonly families: ReadonlyArray<SystemFontFamily> }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'denied' }
  | { readonly kind: 'failed'; readonly message: string };

type FontQueryHost = {
  readonly queryLocalFonts?: () => Promise<ReadonlyArray<SystemFontFace>>;
};

export function systemFontsSupported(host: unknown = globalThis): boolean {
  return typeof (host as FontQueryHost).queryLocalFonts === 'function';
}

/** Starts the query at once, so a click handler keeps its user activation. */
export function querySystemFonts(host: unknown = globalThis): Promise<SystemFontQuery> {
  const query = (host as FontQueryHost).queryLocalFonts;
  if (typeof query !== 'function') return Promise.resolve({ kind: 'unsupported' });
  let pending: Promise<ReadonlyArray<SystemFontFace>>;
  try {
    pending = query.call(host);
  } catch (error) {
    return Promise.resolve(queryFailure(error));
  }
  return pending.then(
    (faces) => ({ kind: 'ok', families: groupSystemFonts(faces) }),
    (error: unknown) => queryFailure(error),
  );
}

function queryFailure(error: unknown): SystemFontQuery {
  const name = error instanceof Error || error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return { kind: 'denied' };
  return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
}

/** Families in alphabetical order; each family's faces with Regular first. */
export function groupSystemFonts(faces: ReadonlyArray<SystemFontFace>): SystemFontFamily[] {
  const byFamily = new Map<string, SystemFontFace[]>();
  for (const face of faces) {
    const list = byFamily.get(face.family);
    if (list === undefined) byFamily.set(face.family, [face]);
    else if (!list.some((known) => known.postscriptName === face.postscriptName)) list.push(face);
  }
  return [...byFamily.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
    .map(([family, list]) => ({ family, faces: [...list].sort(compareStyles) }));
}

function compareStyles(a: SystemFontFace, b: SystemFontFace): number {
  const rank = (face: SystemFontFace): number =>
    /^(regular|normal|book)$/i.test(face.style) ? 0 : 1;
  return rank(a) - rank(b) || a.style.localeCompare(b.style);
}

/** Families whose name, or one of whose faces, contains every typed word. */
export function filterSystemFonts(
  families: ReadonlyArray<SystemFontFamily>,
  text: string,
): ReadonlyArray<SystemFontFamily> {
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return families;
  const matches = (value: string): boolean => {
    const lower = value.toLowerCase();
    return words.every((word) => lower.includes(word));
  };
  return families.flatMap((family) => {
    if (matches(family.family)) return [family];
    const faces = family.faces.filter((face) => matches(face.fullName));
    return faces.length === 0 ? [] : [{ family: family.family, faces }];
  });
}

export type SystemFontFile = {
  readonly file: File;
  /** The face's OS/2 fsType asks for Restricted License embedding. */
  readonly restricted: boolean;
};

/** The chosen face as a standalone .ttf / .otf file, ready to embed. */
export async function systemFontFile(face: SystemFontFace): Promise<SystemFontFile> {
  const bytes = new Uint8Array(await (await face.blob()).arrayBuffer());
  const single: Uint8Array<ArrayBuffer> = isFontCollection(bytes)
    ? collectionFace(bytes, face)
    : bytes;
  const extension = isCffOutline(single) ? 'otf' : 'ttf';
  const name = `${face.fullName.replace(/[\\/:*?"<>|]/g, '-')}.${extension}`;
  return {
    file: new File([single], name, { type: `font/${extension}` }),
    restricted: fontEmbeddingRestricted(single),
  };
}

function collectionFace(bytes: Uint8Array, face: SystemFontFace): Uint8Array<ArrayBuffer> {
  const index = collectionFaceIndex(bytes, face.postscriptName);
  if (index === null) throw new Error(`Could not find ${face.fullName} in its font collection.`);
  return new Uint8Array(extractCollectionFace(bytes, index));
}

function isCffOutline(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && new TextDecoder('latin1').decode(bytes.subarray(0, 4)) === 'OTTO';
}
