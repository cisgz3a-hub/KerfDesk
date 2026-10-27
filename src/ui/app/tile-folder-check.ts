// Tiled save into a reserved folder (controller audit v4 E3-P3-2). The folder
// may already hold tile files from an earlier save: writing replaces a file of
// the same name without asking. Changed bit counts or a smaller tile grid can
// leave older files beside the new set. Both are named as warnings, so only this
// save's files are cut. Checked before writing: afterwards every name exists.
// A save that stops at a failed write leaves its remaining names holding the
// earlier save's contents, which are named as stale (rolling audit v5 J2-P2-2,
// ADR-656 Amendment 3).

import { tileNameWithoutBit } from '../../core/cnc/tile-bit-files';
import type { SaveDirectoryTarget } from '../../platform/types';
import type { TileFile } from './tile-emission';

const LISTED_NAMES = 5;

export type TileFolderContents = {
  /** This save's file names the folder already held. */
  readonly replaced: ReadonlyArray<string>;
  /** Same-job tile files this save will not replace. */
  readonly earlier: ReadonlyArray<string>;
  /** This save's names the folder held that it stopped before replacing: they
   *  still hold the earlier save, under this save's names. */
  readonly stale?: ReadonlyArray<string>;
  readonly inspectionIncomplete?: boolean;
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
  if (directory === undefined) return NOTHING_FOUND;
  const names = files.map(tileDisplayName);
  const written = new Set(names);
  if (directory.listFiles !== undefined) {
    try {
      const present = new Set(await directory.listFiles());
      const jobs = new Set(names.map(tileJobName).filter((name) => name !== null));
      let inspectionIncomplete = false;
      // Preserve the adapter's collision rules (for example case-insensitive
      // Windows names), rather than assuming enumeration names compare exactly.
      const replaced = await filterPresent(names, async (name) => {
        if (present.has(name)) return true;
        try {
          return exists !== undefined && (await exists(name));
        } catch {
          inspectionIncomplete = true;
          return false;
        }
      });
      return {
        replaced,
        earlier: [...present]
          .filter((name) => !written.has(name) && jobs.has(tileJobName(name) ?? ''))
          .sort(),
        ...(inspectionIncomplete ? { inspectionIncomplete: true } : {}),
      };
    } catch {
      const known = await tileFolderContents(
        { file: directory.file, ...(exists === undefined ? {} : { exists }) },
        files,
      );
      return { ...known, inspectionIncomplete: true };
    }
  }
  if (exists === undefined) return NOTHING_FOUND;
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

/** A set cut short replaced only the files it reached. */
export function tileFolderAfterSave(
  folder: TileFolderContents,
  files: ReadonlyArray<TileFile>,
  saved: number,
): TileFolderContents {
  if (saved >= files.length) return folder;
  const written = new Set(files.slice(0, saved).map(tileDisplayName));
  return {
    ...folder,
    replaced: folder.replaced.filter((name) => written.has(name)),
    stale: folder.replaced.filter((name) => !written.has(name)),
  };
}

/** Said as an error: these files look like this save's and are not. */
export function staleTileWarning(contents: TileFolderContents): string | null {
  const stale = contents.stale ?? [];
  if (stale.length === 0) return null;
  return (
    'These files still hold an earlier save, not this one, because this save stopped before ' +
    `replacing them: ${listNames(stale)}. Delete them, or save the tiles again, before cutting.`
  );
}

export function tileFolderWarnings(contents: TileFolderContents): ReadonlyArray<string> {
  const warnings: string[] = [];
  if (contents.inspectionIncomplete === true) {
    warnings.push(
      'KerfDesk could not check the folder for earlier tile files. Check that you cut only the files from this save.',
    );
  }
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

function tileJobName(displayName: string): string | null {
  return (
    /^(.*)_tile-r[1-9]\d*-c[1-9]\d*(?:_bit-[1-9]\d*-of-[1-9]\d*)?\.nc$/.exec(displayName)?.[1] ??
    null
  );
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
