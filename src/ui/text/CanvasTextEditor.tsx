import { useEffect, useRef, useState } from 'react';
import type { Project } from '../../core/scene';
import { findFontEntry } from '../../core/text';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';
import type { CanvasBitmapSize } from '../workspace/use-canvas-bitmap-size';
import { computeView, type ViewState } from '../workspace/view-transform';
import { canvasTextInputStyle } from './canvas-text-layout';
import { useCanvasTextStore, type CanvasTextSession } from './canvas-text-store';
import { ensureFontCss } from './font-loader';
import { CanvasTextPanel } from './CanvasTextPanel';
import { useCanvasTextActions } from './use-canvas-text-actions';
import { useCanvasTextDraft } from './use-canvas-text-draft';
import { useTextDialogFields } from './use-text-dialog-fields';
import { useCanvasTextLifecycle } from './use-canvas-text-lifecycle';
import { useCanvasTextVariables } from './use-canvas-text-variables';
import './canvas-text-editor.css';

type Props = {
  readonly canvasRef: React.RefObject<HTMLCanvasElement | null>;
  readonly canvasSize: CanvasBitmapSize;
  readonly project: Project;
  readonly viewState: ViewState;
};

export function CanvasTextEditor(props: Props): JSX.Element | null {
  const session = useCanvasTextStore((state) => state.session);
  const toolMode = useUiStore((state) => state.toolMode);
  const previewMode = useStore((state) => state.previewMode);
  if (session === null)
    return toolMode.kind === 'text' && !previewMode ? (
      <div className="lf-canvas-text-tool-hint" role="status">
        Click on the canvas to type · Click text to edit · Esc to exit
      </div>
    ) : null;
  return <TextSessionEditor key={session.id} {...props} session={session} />;
}

function TextSessionEditor(props: Props & { readonly session: CanvasTextSession }): JSX.Element {
  const { session } = props;
  const selectedId = useStore((state) => state.selectedObjectId);
  const fields = useTextDialogFields(session.state, props.project, selectedId);
  const draft = useCanvasTextDraft(session, fields.values);
  const input = useRef<HTMLTextAreaElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const variables = useCanvasTextVariables(props.project);
  const actions = useCanvasTextActions(session, fields.values, variables);
  const [, refreshFont] = useState(0);
  useEditorFont(fields.values.fontKey, fields.values.embeddedFonts, () =>
    refreshFont((v) => v + 1),
  );
  useCanvasTextLifecycle({ session, input, editor, canvasRef: props.canvasRef, ...actions });
  const view = computeView(
    props.canvasSize.width,
    props.canvasSize.height,
    props.project.device.bedWidth,
    props.project.device.bedHeight,
    props.viewState,
  );
  const layout = canvasTextInputStyle(session, fields.values, draft.object, view);
  const insert = (text: string): void =>
    insertText(input.current, fields.values.content, text, fields.setContent);
  return (
    <div
      ref={editor}
      className="lf-canvas-text-editor"
      onChangeCapture={actions.clearError}
      onKeyDown={(event) => handleEditorKey(event, actions)}
    >
      <textarea
        ref={input}
        className="lf-canvas-text-input"
        aria-label="Text content on canvas"
        aria-describedby="canvas-text-help"
        placeholder="Type here"
        wrap="off"
        spellCheck={false}
        value={fields.values.content}
        onChange={(event) => {
          fields.setContent(event.target.value);
        }}
        readOnly={actions.saving}
        style={layout.style}
      />
      <CanvasTextPanel
        variables={variables}
        fields={fields}
        insert={insert}
        actions={actions}
        pending={draft.pending}
        error={actions.error ?? draft.error}
        companion={layout.companion}
        inputStyle={layout.style}
        canvasSize={props.canvasSize}
      />
    </div>
  );
}

function handleEditorKey(
  event: React.KeyboardEvent,
  actions: ReturnType<typeof useCanvasTextActions>,
): void {
  event.stopPropagation();
  if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    actions.cancel();
  }
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
    event.preventDefault();
    void actions.save();
  }
}

function useEditorFont(key: string, fonts: Project['embeddedFonts'], refresh: () => void): void {
  const callback = useRef(refresh);
  callback.current = refresh;
  useEffect(() => {
    let active = true;
    if (findFontEntry(key)?.geometry !== 'single-line') {
      void ensureFontCss(key, fonts).then(
        () => {
          if (active) callback.current();
        },
        () => undefined,
      );
    }
    return () => {
      active = false;
    };
  }, [key, fonts]);
}

function insertText(
  input: HTMLTextAreaElement | null,
  value: string,
  text: string,
  change: (v: string) => void,
): void {
  const start = input?.selectionStart ?? value.length;
  const end = input?.selectionEnd ?? value.length;
  change(value.slice(0, start) + text + value.slice(end));
  window.requestAnimationFrame(() => {
    if (input?.isConnected) {
      input.focus();
      input.setSelectionRange(start + text.length, start + text.length);
    }
  });
}
