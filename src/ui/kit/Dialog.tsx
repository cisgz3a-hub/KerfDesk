// Dialog — the shared modal shell (ADR-047). Eight dialogs each duplicated
// the same backdrop+panel markup; this composes the proven use-dialog-a11y
// hook (Escape, focus trap, initial focus, focus restore) with the
// tokens.css shell classes, preserving the exact accessibility structure
// the per-dialog implementations used: role/aria-modal/tabIndex={-1} on the
// backdrop element that carries the a11y ref.

import { useId, useRef } from 'react';
import { useDialogA11y } from '../common/use-dialog-a11y';
import { useRegisterModal } from '../common/use-register-modal';

type DialogSize = 'sm' | 'md' | 'lg' | 'xl';

export function Dialog(props: {
  readonly onClose: () => void;
  // Accessible name: a visible title (renders an h2) or an aria-label.
  readonly title?: string;
  readonly ariaLabel?: string;
  readonly size?: DialogSize;
  /** Optional feature-specific panel class; shared dialog chrome remains intact. */
  readonly panelClassName?: string;
  // 'form' renders the panel as a <form> so Enter submits (the
  // CutSettings/Convert pattern); onSubmit must preventDefault itself.
  readonly as?: 'div' | 'form';
  readonly onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void;
  readonly children: React.ReactNode;
}): JSX.Element {
  const backdropRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useDialogA11y(backdropRef, props.onClose);
  useRegisterModal();
  const panelClass = ['lf-dialog', `lf-dialog--${props.size ?? 'md'}`, props.panelClassName]
    .filter((value) => value !== undefined && value !== '')
    .join(' ');
  const heading =
    props.title === undefined ? null : (
      <h2 className="lf-dialog-title" id={titleId}>
        {props.title}
      </h2>
    );
  return (
    <div
      ref={backdropRef}
      role="dialog"
      aria-modal="true"
      {...(props.title !== undefined
        ? { 'aria-labelledby': titleId }
        : { 'aria-label': props.ariaLabel ?? 'Dialog' })}
      tabIndex={-1}
      className="lf-dialog-backdrop"
    >
      {props.as === 'form' ? (
        <form className={panelClass} onSubmit={props.onSubmit}>
          {heading}
          {props.children}
        </form>
      ) : (
        <div className={panelClass}>
          {heading}
          {props.children}
        </div>
      )}
    </div>
  );
}

export function DialogActions(props: { readonly children: React.ReactNode }): JSX.Element {
  return <div className="lf-dialog-actions">{props.children}</div>;
}
