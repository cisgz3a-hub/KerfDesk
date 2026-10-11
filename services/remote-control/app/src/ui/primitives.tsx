import { useEffect, useId, useRef, type ReactNode } from 'react';
import { parseDecimal } from '../core/numbers';
import { useDraft } from './hooks';
import { Icon } from './icons';

export function Sheet({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <>
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-labelledby={id} ref={panel} tabIndex={-1}>
        <div className="sheet-grip" />
        <div className="sheet-head">
          <h2 id={id}>{title}</h2>
          <button type="button" className="btn btn-icon" aria-label="Close" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
        {footer === undefined ? null : <div className="sheet-foot">{footer}</div>}
      </div>
    </>
  );
}

/** Accepts 0.5 and 0,5. Blank and partial drafts survive refreshes until committed. */
export function NumberField({
  label,
  value,
  unit,
  min,
  max,
  onCommit,
  disabled,
}: {
  label: string;
  value: number | undefined;
  unit?: string;
  min?: number;
  max?: number;
  onCommit: (value: number) => void;
  disabled?: boolean;
}) {
  const shown = value === undefined ? '' : String(Number(value.toFixed(3)));
  const [draft, setDraft, settle] = useDraft(shown);
  const parsed = draft.trim() === '' ? null : parseDecimal(draft, min, max);
  const invalid = draft.trim() !== '' && parsed === null;
  const commit = () => {
    if (parsed !== null && draft !== shown) onCommit(parsed);
    settle();
  };
  return (
    <label className="field">
      <span>{label}</span>
      <div className="unit-input">
        <input
          className={`input${invalid ? ' invalid' : ''}`}
          inputMode="decimal"
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
          }}
        />
        {unit === undefined ? null : <em>{unit}</em>}
      </div>
    </label>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label className="switch">
      <span>
        {label}
        {hint === undefined ? null : (
          <small className="muted small" style={{ display: 'block' }}>
            {hint}
          </small>
        )}
      </span>
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Banner({
  tone,
  children,
}: {
  tone: 'info' | 'warning' | 'danger' | 'success';
  children: ReactNode;
}) {
  return (
    <div className={`banner ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {children}
    </div>
  );
}
