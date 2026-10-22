// Tiled save into a reserved folder (controller audit v4 E3-P3-2). The folder
// may already hold tile files from an earlier save: writing replaces a file of
// the same name without asking, and a tile now written as one file per bit
// (ADR-392 Amendment 2) leaves the earlier save's one-file tile beside its new
// files. Both are named once the set is written, as warnings, so only this
// save's files are cut. Checked before writing: afterwards every name exists.

import { tileNameWithoutBit } from '../../core/cnc/tile-bit-files';
import type { SaveDirectoryTarget } from '../../platform/types';
import type { TileFile } from './tile-emission';

const LISTED_NAMES = 5;

export type TileFolderContents = {
  /** This save's file names the folder already held. */
  readonly replaced: ReadonlyArray<string>;
  /** One-file tiles from an earlier save, where this save writes that tile per bit. */
  readonly earlier: ReadonlyArray<string>;
};

const NOTHING_FOUND: TileFolderContents = { replaced: [], earlier: [] };

/** The display name a tile file is written under. */
export function tileDisplayName(file: TileFile): string {
  return `${file.name}.nc`;
}

export async function tileFolderContents(
  directory: SaveDirectoryTarget | undefined,
  files: ReadonlyArray<TileFile>,
): Promise<TileFolderContents> {
  const exists = directory?.exists;
  if (exists === undefined) return NOTHING_FOUND;
  const names = files.map(tileDisplayName);
  const written = new Set(names);
  const oneFileTiles = new Set<string>();
  for (const file of files) {
    const tileName = tileNameWithoutBit(file.name);
    if (tileName !== null && !written.has(`${tileName}.nc`)) oneFileTiles.add(`${tileName}.nc`);
  }
  const present = async (name: string): Promise<boolean> => {
    try {
      return await exists(name);
    } catch {
      return false;
    }
  };
  const [replaced, earlier] = await Promise.all([
    filterPresent(names, present),
    filterPresent([...oneFileTiles], present),
  ]);
  return { replaced, earlier };
}

export function tileFolderWarnings(contents: TileFolderContents): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (contents.replaced.length > 0) {
    warnings.push(
      `This save replaced ${contents.replaced.length} file(s) already in the folder: ` +
        `${listNames(contents.replaced)}.`,
    );
  }
  if (contents.earlier.length > 0) {
    warnings.push(
      'These tile files in the folder are from an earlier save, not this one: ' +
        `${listNames(contents.earlier)}. Delete or move them, so only this save's files are cut.`,
    );
  }
  return warnings;
}

async function filterPresent(
  names: ReadonlyArray<string>,
  present: (name: string) => Promise<boolean>,
): Promise<ReadonlyArray<string>> {
  const found = await Promise.all(names.map(present));
  return names.filter((_, index) => found[index] === true);
}

function listNames(names: ReadonlyArray<string>): string {
  const listed = names.slice(0, LISTED_NAMES).join(', ');
  const more = names.length - LISTED_NAMES;
  return more > 0 ? `${listed} and ${more} more` : listed;
}
