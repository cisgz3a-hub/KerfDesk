// AppDialogHost — draws the in-app confirm, alert and prompt (ADR-707) for the
// first request waiting in app-dialog-store, on the shared Dialog shell.
//
// Being a Dialog is what keeps a running job safe: its backdrop sits under the
// Live Motion bar and makes room for it, and the workspace is hidden from
// assistive technology with aria-hidden, never `inert`, so ABORT JOB still
// works (hide-outside-modal.ts).
//
// Buttons carry the caller's words; the confirm button comes first, as in
// ConfirmSaveDialog, and takes the initial focus unless the caller asks for
// 'surface'. A key held down when the dialog opens never presses anything
// (ADR-207 Amendment 3): Chromium clicks a focused button on every
// auto-repeated Enter, so a held Enter on the button that opened the question
// would also answer it.

import { useEffect, useId, useState, type FocusEvent, type KeyboardEvent } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import {
  useAppDialogStore,
  type AppAlertOptions,
  type AppConfirmAnswer,
  type AppConfirmOptions,
  type AppPromptOptions,
} from '../state/app-dialog-store';
import { cancelPendingAppDialogs } from '../state/app-dialogs';
import { useFreshKeyActivation } from './use-fresh-key-activation';

export function AppDialogHost(): JSX.Element | null {
  const request = useAppDialogStore((state) => state.queue[0]);
  // The crash screen mounts no host: its own Abort has no Live Motion bar above
  // it, so a question drawn there could cover it. What was waiting when the
  // workspace went away is answered as cancelled.
  useEffect(() => cancelPendingAppDialogs, []);
  if (request === undefined) return null;
  // Keyed by request: the next question starts with its own state and focus.
  if (request.kind === 'confirm') {
    return <ConfirmPanel key={request.id} options={request.options} resolve={request.resolve} />;
  }
  if (request.kind === 'prompt') {
    return <PromptPanel key={request.id} options={request.options} resolve={request.resolve} />;
  }
  return <AlertPanel key={request.id} options={request.options} resolve={request.resolve} />;
}

function ConfirmPanel(props: {
  readonly options: AppConfirmOptions;
  readonly resolve: (answer: AppConfirmAnswer) => void;
}): JSX.Element {
  const { options, resolve } = props;
  const [dontAskAgain, setDontAskAgain] = useState(false);
  const cancel = (): void => resolve({ confirmed: false, dontAskAgain: false });
  return (
    <Dialog size="sm" title={options.title} onClose={cancel} {...focusProps(options)}>
      <FreshKeys>
        <Message text={options.message} />
        {options.dontAskAgainKey === undefined ? null : (
          // Reached with Tab, never the control a new dialog opens on.
          <label data-dialog-secondary-focus="" style={checkStyle}>
            <input
              type="checkbox"
              checked={dontAskAgain}
              onChange={(event) => setDontAskAgain(event.target.checked)}
            />
            Don&apos;t ask again
          </label>
        )}
        <DialogActions>
          <Button
            variant={options.tone === 'danger' ? 'danger' : 'primary'}
            onClick={() => resolve({ confirmed: true, dontAskAgain })}
          >
            {options.confirmLabel}
          </Button>
          <Button onClick={cancel}>{options.cancelLabel ?? 'Cancel'}</Button>
        </DialogActions>
      </FreshKeys>
    </Dialog>
  );
}

function AlertPanel(props: {
  readonly options: AppAlertOptions;
  readonly resolve: () => void;
}): JSX.Element {
  const { options, resolve } = props;
  return (
    <Dialog size="sm" title={options.title} onClose={resolve} {...focusProps(options)}>
      <FreshKeys>
        <Message text={options.message} />
        <DialogActions>
          <Button variant="primary" onClick={resolve}>
            {options.closeLabel ?? 'OK'}
          </Button>
        </DialogActions>
      </FreshKeys>
    </Dialog>
  );
}

function PromptPanel(props: {
  readonly options: AppPromptOptions;
  readonly resolve: (value: string | null) => void;
}): JSX.Element {
  const { options, resolve } = props;
  const [value, setValue] = useState(options.initialValue ?? '');
  const [problem, setProblem] = useState<string | null>(null);
  const problemId = useId();
  const submit = (event: React.FormEvent): void => {
    event.preventDefault();
    const found = options.validate?.(value) ?? null;
    // A refused value keeps the dialog and the typed text, with the reason.
    if (found !== null) {
      setProblem(found);
      return;
    }
    resolve(value);
  };
  return (
    <Dialog
      size="sm"
      title={options.title}
      as="form"
      onSubmit={submit}
      onClose={() => resolve(null)}
      {...focusProps(options)}
    >
      <FreshKeys>
        {options.message === '' ? null : <Message text={options.message} />}
        <label style={fieldStyle}>
          <span>{options.label}</span>
          <input
            type="text"
            className="lf-input"
            name="appDialogText"
            value={value}
            maxLength={options.maxLength}
            autoComplete="off"
            aria-invalid={problem !== null}
            {...(problem === null ? {} : { 'aria-describedby': problemId })}
            onChange={(event) => {
              setValue(event.target.value);
              setProblem(null);
            }}
            // An offered name is selected, so typing replaces it.
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        {problem === null ? null : (
          <p id={problemId} role="alert" style={problemStyle}>
            {problem}
          </p>
        )}
        <DialogActions>
          <Button type="submit" variant="primary">
            {options.confirmLabel}
          </Button>
          <Button onClick={() => resolve(null)}>{options.cancelLabel ?? 'Cancel'}</Button>
        </DialogActions>
      </FreshKeys>
    </Dialog>
  );
}

function focusProps(options: { readonly initialFocus?: 'first-control' | 'surface' }): {
  readonly initialFocus?: 'first-control' | 'surface';
} {
  return options.initialFocus === undefined ? {} : { initialFocus: options.initialFocus };
}

/** Paragraphs split on blank lines; a single line break is kept. */
function Message(props: { readonly text: string }): JSX.Element {
  return (
    <>
      {props.text.split(/\n{2,}/).map((paragraph, index) => (
        // The text is fixed for the dialog's life, so position is identity.
        <p key={index} style={messageStyle}>
          {paragraph}
        </p>
      ))}
    </>
  );
}

/**
 * The held-key guard for everything in a dialog. An Enter or Space that was
 * already down when the dialog opened arrives here only as auto-repeats, or
 * as a release with no press: both are cancelled before the browser turns
 * them into a click or a form submit. A fresh press works as usual.
 */
function FreshKeys(props: { readonly children: React.ReactNode }): JSX.Element {
  const guard = useFreshKeyActivation('app-dialog');
  return (
    // Not a control: it only watches the keys its buttons and field receive.
    <div
      style={contentsStyle}
      onKeyDown={(event) => {
        if (!typesSpace(event)) guard.onKeyDown(event);
      }}
      onKeyUp={(event) => {
        if (!typesSpace(event)) guard.onKeyUp(event);
      }}
      onBlur={(event: FocusEvent<HTMLElement>) => guard.onBlur(event)}
    >
      {props.children}
    </div>
  );
}

// Space in a text field is a character, held or not; Enter there submits.
function typesSpace(event: KeyboardEvent<HTMLElement>): boolean {
  const target = event.target;
  return (
    event.key === ' ' &&
    target instanceof HTMLInputElement &&
    target.type !== 'checkbox' &&
    target.type !== 'radio'
  );
}

// The wrapper adds no box, so the panel's own column layout still applies.
const contentsStyle: React.CSSProperties = { display: 'contents' };
const messageStyle: React.CSSProperties = { margin: 0, fontSize: 13, whiteSpace: 'pre-wrap' };
const checkStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--lf-text-muted)',
};
const fieldStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
};
const problemStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--lf-danger-fg)',
};
