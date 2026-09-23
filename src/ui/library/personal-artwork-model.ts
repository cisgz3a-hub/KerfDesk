import { createProject, type Project, type SceneObject } from '../../core/scene';
import { findFontEntry } from '../../core/text';
import { deserializeProject, prepareProjectForPersistence } from '../../io/project';
import { MAX_EMBEDDED_FONTS } from '../../io/project/project-embedded-font-validator';
import { validateSceneBudgets } from '../../io/project/project-scene-integrity-validator';
import { portableProjectAssets } from '../app/portable-project-assets';
import type { PagedRasterAssetReader } from '../import/paged-raster-hydration';
import { clipboardFromSelection, prepareClipboardPaste } from '../state/scene-clipboard-actions';
import { pushUndo } from '../state/scene-mutations';
import type { AppState } from '../state/store';
import { personalArtworkCnc } from './personal-artwork-cnc';

export type PersonalArtwork = {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly projectJson: string;
  readonly selectedObjectIds: readonly string[];
};

export async function capturePersonalArtwork(
  state: Pick<
    AppState,
    'project' | 'projectDocumentEpoch' | 'selectedObjectId' | 'additionalSelectedIds'
  >,
  name: string,
  category: string,
  reader?: PagedRasterAssetReader,
  signal?: AbortSignal,
): Promise<PersonalArtwork> {
  const clipboard = clipboardFromSelection(state);
  if (clipboard === null) throw new Error('Select artwork to save to My artwork.');
  const fontKeys = new Set(
    clipboard.objects.flatMap((object) => (object.kind === 'text' ? [object.fontKey] : [])),
  );
  const embeddedFonts = (state.project.embeddedFonts ?? []).filter((font) =>
    fontKeys.has(font.key),
  );
  for (const key of fontKeys) {
    if (findFontEntry(key) === null && !embeddedFonts.some((font) => font.key === key)) {
      throw new Error(`Embed the missing font "${key}" before saving this artwork.`);
    }
  }
  const blank = createProject(state.project.device);
  const project: Project = {
    ...blank,
    ...(state.project.machine === undefined ? {} : { machine: state.project.machine }),
    scene: {
      objects: clipboard.objects,
      layers: clipboard.layers,
      groups: clipboard.groups ?? [],
      artworkOrder: (state.project.scene.artworkOrder ?? []).filter((id) =>
        clipboard.objects.some((object) => object.id === id),
      ),
    },
    embeddedFonts,
    ...(clipboard.objects.some(
      (object) => object.kind === 'text' && object.variableTemplate !== undefined,
    ) && state.project.variables !== undefined
      ? { variables: state.project.variables }
      : {}),
  };
  const prepared = prepareProjectForPersistence(
    await portableProjectAssets(project, reader, signal),
  );
  if (prepared.kind !== 'ok') throw new Error(prepared.reason);
  return {
    id: crypto.randomUUID(),
    name: nonemptyName(name),
    category: category.trim(),
    projectJson: prepared.json,
    selectedObjectIds: clipboard.selectedObjectIds,
  };
}

export function personalArtworkProject(entry: PersonalArtwork): Project {
  const parsed = deserializeProject(entry.projectJson);
  if (parsed.kind !== 'ok')
    throw new Error(
      `Invalid saved artwork: ${parsed.kind === 'invalid' ? parsed.reason : parsed.kind}.`,
    );
  const ids = new Set(parsed.project.scene.objects.map((object) => object.id));
  if (
    ids.size === 0 ||
    entry.selectedObjectIds.length === 0 ||
    entry.selectedObjectIds.some((id) => !ids.has(id))
  ) {
    throw new Error('Saved artwork has an invalid selection.');
  }
  if (
    parsed.project.scene.objects.some(
      (object) => object.kind === 'raster-image' && object.imageAsset !== undefined,
    )
  ) {
    throw new Error(
      'Saved artwork must contain embedded image pixels, not local asset references.',
    );
  }
  return parsed.project;
}

/** Always create independent operations; same names or IDs never adopt destination settings. */
export function insertPersonalArtwork(state: AppState, entry: PersonalArtwork): Partial<AppState> {
  const cnc = personalArtworkCnc(state.project, personalArtworkProject(entry));
  const source = cnc.source;
  const fonts = mergeFonts(state.project, source);
  const objects = source.scene.objects.map(
    (object): SceneObject =>
      object.kind === 'text'
        ? { ...object, fontKey: fonts.keyMap.get(object.fontKey) ?? object.fontKey }
        : object,
  );
  const prepared = prepareClipboardPaste(
    state.project.scene,
    source.scene.layers,
    objects,
    entry.selectedObjectIds,
    source.scene.groups ?? [],
    false,
    0,
  );
  const variables = source.variables;
  if (
    variables !== undefined &&
    state.project.variables !== undefined &&
    JSON.stringify(variables) !== JSON.stringify(state.project.variables)
  ) {
    throw new Error(
      'This artwork uses different variable text data. Insert it into a new project or use matching project data.',
    );
  }
  const scene = {
    ...prepared.scene,
    objects: [...prepared.scene.objects, ...prepared.objects],
    groups: [...(prepared.scene.groups ?? []), ...prepared.groups],
    artworkOrder: insertedArtworkOrder(state.project, source, prepared.objects),
  };
  if (validateSceneBudgets(scene) !== null) {
    throw new Error(
      'This artwork would exceed the project limits for artwork, operations or groups. Remove unused items, or insert it into a new project.',
    );
  }
  const [primary, ...rest] = prepared.selectedObjectIds;
  return {
    project: {
      ...state.project,
      embeddedFonts: fonts.fonts,
      ...(cnc.machine === undefined ? {} : { machine: cnc.machine }),
      ...(variables === undefined ? {} : { variables }),
      scene,
    },
    selectedObjectId: primary ?? null,
    additionalSelectedIds: new Set(rest),
    undoStack: pushUndo(state.project, state.undoStack),
    redoStack: [],
    dirty: true,
  };
}

function insertedArtworkOrder(
  target: Project,
  source: Project,
  objects: readonly SceneObject[],
): readonly string[] {
  const idMap = new Map(
    source.scene.objects.map((object, index) => [object.id, objects[index]?.id]),
  );
  const ordered = new Set([
    ...(source.scene.artworkOrder ?? []),
    ...source.scene.objects.map((object) => object.id),
  ]);
  return [
    ...new Set([
      ...(target.scene.artworkOrder ?? []),
      ...target.scene.objects.map((object) => object.id),
    ]),
    ...[...ordered].flatMap((id) => {
      const mapped = idMap.get(id);
      return mapped === undefined ? [] : [mapped];
    }),
  ];
}

function mergeFonts(target: Project, source: Project) {
  const fonts = [...(target.embeddedFonts ?? [])];
  const keyMap = new Map<string, string>();
  for (const font of source.embeddedFonts ?? []) {
    const existing = fonts.find((candidate) => candidate.dataBase64 === font.dataBase64);
    if (existing !== undefined) {
      keyMap.set(font.key, existing.key);
      continue;
    }
    // Imported font keys also key the process-wide font cache. Give copied font
    // bytes a new identity even if only an earlier document owned that key.
    const key = `embedded:personal-${crypto.randomUUID()}`;
    keyMap.set(font.key, key);
    fonts.push({ ...font, key });
  }
  if (fonts.length > MAX_EMBEDDED_FONTS)
    throw new Error(`This project can hold at most ${MAX_EMBEDDED_FONTS} embedded fonts.`);
  return { fonts, keyMap };
}

export function filterPersonalArtwork(
  entries: readonly PersonalArtwork[],
  search: string,
  category: string,
): readonly PersonalArtwork[] {
  const query = search.trim().toLocaleLowerCase();
  return entries.filter(
    (entry) =>
      (category === '' || entry.category === category) &&
      `${entry.name} ${entry.category}`.toLocaleLowerCase().includes(query),
  );
}

export function nonemptyName(value: string): string {
  const name = value.trim();
  if (name === '') throw new Error('Enter a name for this artwork.');
  return name;
}
