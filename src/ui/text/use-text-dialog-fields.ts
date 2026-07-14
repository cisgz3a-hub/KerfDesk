import { useState } from 'react';
import {
  DEFAULT_FONT_KEY,
  encodeEmbeddedFont,
  FONT_REGISTRY,
  DEFAULT_TEXT_ALIGNMENT,
  DEFAULT_TEXT_LETTER_SPACING,
  DEFAULT_TEXT_LINE_HEIGHT,
  DEFAULT_TEXT_SIZE_MM,
} from '../../core/text';
import type {
  EmbeddedFont,
  PathTextSettings,
  Project,
  SceneObject,
  TextAlignment,
  VariableTemplate,
} from '../../core/scene';
import { variableTemplateToSource } from '../../core/variables';
import type { TextDialogState } from '../state/ui-store';
import {
  initialTextLayerColor,
  textLayerOptions,
  type TextLayerNotice,
  type TextLayerOption,
} from './text-layer-options';
import {
  initialTextBend,
  initialTextLetterSpacing,
  initialTextLineHeight,
  initialTextSizeMm,
  type TextDialogNumericValues,
} from './TextDialogNumericFields';

export type DialogValues = TextDialogNumericValues & {
  readonly content: string;
  readonly fontKey: string;
  readonly alignment: TextAlignment;
  readonly color: string;
  readonly embeddedFonts: ReadonlyArray<EmbeddedFont>;
  readonly importedFont?: EmbeddedFont;
  readonly pathText?: PathTextSettings;
  readonly pathGuide?: SceneObject;
  readonly variableTemplate?: VariableTemplate;
};

export type DialogFields = {
  readonly values: DialogValues;
  readonly setContent: (value: string) => void;
  readonly setFontKey: (value: string) => void;
  readonly setSizeMm: (value: number) => void;
  readonly setAlignment: (value: TextAlignment) => void;
  readonly setColor: (value: string) => void;
  readonly setLineHeight: (value: number) => void;
  readonly setLetterSpacing: (value: number) => void;
  readonly setBendDeg: (value: number) => void;
  readonly importFont: (file: File) => Promise<void>;
  readonly fontAvailable: boolean;
  readonly pathAvailable: boolean;
  readonly pathEnabled: boolean;
  readonly guides: ReadonlyArray<SceneObject>;
  readonly setPathEnabled: (enabled: boolean) => void;
  readonly setPathGuideId: (id: string) => void;
  readonly setPathOffsetMm: (offset: number) => void;
  readonly setPathReverse: (reverse: boolean) => void;
  readonly variableEnabled: boolean;
  readonly setVariableEnabled: (enabled: boolean) => void;
  readonly layerOptions: ReadonlyArray<TextLayerOption>;
  readonly layerNotice?: TextLayerNotice;
  readonly layerCompatible: boolean;
};

export function useTextDialogFields(
  state: TextDialogState,
  project: Project,
  selectedObjectId: string | null,
  activeLayerColor: string | null,
): DialogFields {
  const basic = useBasicFields(state);
  const font = useImportedFont(state.mode === 'edit' ? state.fontKey : DEFAULT_FONT_KEY);
  const path = usePathFields(state, textGuides(project, state), selectedObjectId);
  const [variableEnabled, setVariableEnabled] = useState(
    state.mode === 'edit' && state.variableTemplate !== undefined,
  );
  const embeddedFonts = availableEmbeddedFonts(project, font.importedFont);
  const variableTemplate = variableTemplateValue(state, variableEnabled);
  const [color, setColor] = useState(() => initialTextLayerColor(state, project, activeLayerColor));
  const layerOptions = textLayerOptions(project, font.fontKey, color);
  const layerNotice = layerOptions.find((option) => option.color === color)?.notice;
  return {
    values: dialogValues(basic, font, path, color, embeddedFonts, variableTemplate),
    ...basic.setters,
    setFontKey: font.setFontKey,
    setColor,
    importFont: font.importFont,
    fontAvailable:
      FONT_REGISTRY.some((entry) => entry.key === font.fontKey) ||
      embeddedFonts.some((entry) => entry.key === font.fontKey),
    pathAvailable: !path.enabled || path.guide !== undefined,
    pathEnabled: path.enabled,
    guides: path.guides,
    ...path.setters,
    variableEnabled,
    setVariableEnabled,
    layerOptions,
    ...(layerNotice === undefined ? {} : { layerNotice }),
    layerCompatible: layerNotice?.kind !== 'error',
  };
}

function availableEmbeddedFonts(
  project: Project,
  importedFont: EmbeddedFont | undefined,
): ReadonlyArray<EmbeddedFont> {
  return importedFont === undefined
    ? (project.embeddedFonts ?? [])
    : [...(project.embeddedFonts ?? []), importedFont];
}

function dialogValues(
  basic: ReturnType<typeof useBasicFields>,
  font: ReturnType<typeof useImportedFont>,
  path: ReturnType<typeof usePathFields>,
  color: string,
  embeddedFonts: ReadonlyArray<EmbeddedFont>,
  variableTemplate: VariableTemplate | undefined,
): DialogValues {
  return {
    ...basic.values,
    fontKey: font.fontKey,
    color,
    embeddedFonts,
    ...(font.importedFont === undefined ? {} : { importedFont: font.importedFont }),
    ...(path.settings === undefined ? {} : { pathText: path.settings }),
    ...(path.guide === undefined ? {} : { pathGuide: path.guide }),
    ...(variableTemplate === undefined ? {} : { variableTemplate }),
  };
}

function variableTemplateValue(
  state: TextDialogState,
  enabled: boolean,
): VariableTemplate | undefined {
  if (!enabled) return undefined;
  return state.mode === 'edit' && state.variableTemplate !== undefined
    ? state.variableTemplate
    : { tokens: [] };
}

function useBasicFields(state: TextDialogState) {
  const editing = state.mode === 'edit';
  const [content, setContent] = useState(
    editing && state.variableTemplate !== undefined
      ? variableTemplateToSource(state.variableTemplate)
      : editing
        ? state.content
        : '',
  );
  const [sizeMm, setSizeMm] = useState(
    initialTextSizeMm(editing ? state.sizeMm : DEFAULT_TEXT_SIZE_MM),
  );
  const [alignment, setAlignment] = useState<TextAlignment>(
    editing ? state.alignment : DEFAULT_TEXT_ALIGNMENT,
  );
  const [lineHeight, setLineHeight] = useState(
    initialTextLineHeight(editing ? state.lineHeight : DEFAULT_TEXT_LINE_HEIGHT),
  );
  const [letterSpacing, setLetterSpacing] = useState(
    initialTextLetterSpacing(editing ? state.letterSpacing : DEFAULT_TEXT_LETTER_SPACING),
  );
  const [bendDeg, setBendDeg] = useState(initialTextBend(editing ? (state.bendDeg ?? 0) : 0));
  return {
    values: { content, sizeMm, alignment, lineHeight, letterSpacing, bendDeg },
    setters: { setContent, setSizeMm, setAlignment, setLineHeight, setLetterSpacing, setBendDeg },
  };
}

function useImportedFont(initialFontKey: string) {
  const [fontKey, setFontKey] = useState(initialFontKey);
  const [importedFont, setImportedFont] = useState<EmbeddedFont | undefined>();
  const importFont = async (file: File): Promise<void> => {
    if (!/\.(ttf|otf)$/i.test(file.name)) throw new Error('Choose a .ttf or .otf font file.');
    const font = encodeEmbeddedFont({
      key: `embedded:${crypto.randomUUID()}`,
      fileName: file.name,
      buffer: await file.arrayBuffer(),
    });
    setImportedFont(font);
    setFontKey(font.key);
  };
  return { fontKey, setFontKey, importedFont, importFont };
}

function usePathFields(
  state: TextDialogState,
  guides: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
) {
  const existing = state.mode === 'edit' ? state.pathText : undefined;
  const initialGuideId = resolveInitialGuideId(existing, guides, selectedObjectId);
  const [enabled, setPathEnabled] = useState(existing !== undefined);
  const [guideObjectId, setPathGuideId] = useState(initialGuideId);
  const [offsetMm, setPathOffsetMm] = useState(existing?.offsetMm ?? 0);
  const [reverse, setPathReverse] = useState(existing?.reverse ?? false);
  const settings = enabled
    ? { guideObjectId, offsetMm: Math.max(0, offsetMm), reverse }
    : undefined;
  return {
    enabled,
    guides,
    settings,
    guide: guides.find((guide) => guide.id === guideObjectId),
    setters: { setPathEnabled, setPathGuideId, setPathOffsetMm, setPathReverse },
  };
}

function resolveInitialGuideId(
  existing: PathTextSettings | undefined,
  guides: ReadonlyArray<SceneObject>,
  selectedObjectId: string | null,
): string {
  if (existing !== undefined) return existing.guideObjectId;
  const selected = guides.find((guide) => guide.id === selectedObjectId);
  return selected?.id ?? guides[0]?.id ?? '';
}

function textGuides(project: Project, state: TextDialogState): ReadonlyArray<SceneObject> {
  return project.scene.objects.filter(
    (object) =>
      (state.mode !== 'edit' || object.id !== state.id) &&
      'paths' in object &&
      object.paths.some((path) => path.polylines.some((line) => line.points.length >= 2)),
  );
}
