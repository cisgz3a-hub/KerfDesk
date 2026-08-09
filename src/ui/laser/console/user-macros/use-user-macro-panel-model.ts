import { useState, type Dispatch, type SetStateAction } from 'react';
import { findUserMacro, type UserMacro } from './user-macro-collection';
import {
  expandUserMacroTemplate,
  parseUserMacroTemplate,
  type UserMacroExpansionResult,
} from './user-macro-template';
import { useUserMacroLibrary } from './use-user-macro-library';

export type MacroEditor =
  | { readonly kind: 'new'; readonly name: string; readonly template: string }
  | {
      readonly kind: 'edit';
      readonly originalName: string;
      readonly name: string;
      readonly template: string;
    };

type MacroPanelState = {
  readonly selectedName: string;
  readonly editor: MacroEditor | null;
  readonly values: Readonly<Record<string, string>>;
  readonly error: string | null;
};

const INITIAL_PANEL_STATE: MacroPanelState = {
  selectedName: '',
  editor: null,
  values: {},
  error: null,
};

export function useUserMacroPanelModel(
  onRun: (command: string, macro: UserMacro) => Promise<void>,
) {
  const library = useUserMacroLibrary();
  const [state, setState] = useState<MacroPanelState>(INITIAL_PANEL_STATE);
  const selected = findUserMacro(library.macros, state.selectedName) ?? library.macros[0] ?? null;
  const parsed = selected === null ? null : parseUserMacroTemplate(selected.template);
  const variables = parsed?.kind === 'ok' ? parsed.variables : [];
  const expansion =
    selected === null ? null : expandUserMacroTemplate(selected.template, state.values);
  return {
    editor: state.editor,
    error: state.error,
    expansion,
    macros: library.macros,
    selected,
    values: state.values,
    variables,
    setEditor: (editor: MacroEditor) =>
      setState((current) => ({ ...current, editor, error: null })),
    ...macroPanelActions(state, setState, selected, expansion, library, onRun),
  };
}

function macroPanelActions(
  state: MacroPanelState,
  setState: Dispatch<SetStateAction<MacroPanelState>>,
  selected: UserMacro | null,
  expansion: UserMacroExpansionResult | null,
  library: ReturnType<typeof useUserMacroLibrary>,
  onRun: (command: string, macro: UserMacro) => Promise<void>,
) {
  return {
    select: (name: string) => setState({ ...INITIAL_PANEL_STATE, selectedName: name }),
    beginNew: () =>
      setState((current) => ({
        ...current,
        editor: { kind: 'new', name: '', template: '' },
        error: null,
      })),
    beginEdit: () => {
      if (selected === null) return;
      setState((current) => ({
        ...current,
        editor: {
          kind: 'edit',
          originalName: selected.name,
          name: selected.name,
          template: selected.template,
        },
        error: null,
      }));
    },
    cancelEditor: () => setState((current) => ({ ...current, editor: null, error: null })),
    saveEditor: () => {
      if (state.editor === null) return;
      const result = library.save({
        name: state.editor.name,
        template: state.editor.template,
        ...(state.editor.kind === 'edit' ? { originalName: state.editor.originalName } : {}),
      });
      if (result.kind === 'error') {
        return setState((current) => ({ ...current, error: result.message }));
      }
      setState({ ...INITIAL_PANEL_STATE, selectedName: result.macro?.name ?? '' });
    },
    removeSelected: () => {
      if (selected === null) return;
      const result = library.remove(selected.name);
      if (result.kind === 'error') {
        return setState((current) => ({ ...current, error: result.message }));
      }
      setState(INITIAL_PANEL_STATE);
    },
    setValue: (variable: string, value: string) =>
      setState((current) => ({
        ...current,
        values: { ...current.values, [variable]: value },
        error: null,
      })),
    runSelected: () => {
      if (selected === null || expansion === null) return;
      if (expansion.kind !== 'ok') {
        return setState((current) => ({ ...current, error: expansion.message }));
      }
      setState((current) => ({ ...current, error: null }));
      void onRun(expansion.command, selected);
    },
  };
}
