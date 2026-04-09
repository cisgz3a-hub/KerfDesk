import React, { useState, useRef, useEffect } from 'react';

/**
 * Number input that lets you fully clear the field while typing.
 * Validates and clamps only on blur, not on every keystroke.
 * Drop-in replacement for <input type="number"> across the app.
 */
interface NumberInputProps {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  defaultValue?: number;
  style?: React.CSSProperties;
  onChange?: (value: number) => void;
  onCommit?: (value: number) => void;
  onClick?: (e: React.MouseEvent<HTMLInputElement>) => void;
  disabled?: boolean;
  /** Round to integer on change/commit (e.g. passes, tab count). */
  integer?: boolean;
  inputMode?: 'numeric' | 'decimal';
}

export function NumberInput({
  value,
  min,
  max,
  step,
  defaultValue,
  style,
  onChange,
  onCommit,
  onClick,
  disabled,
  integer,
  inputMode = 'decimal',
}: NumberInputProps) {
  const [localValue, setLocalValue] = useState(String(value));
  const [isFocused, setIsFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isFocused) {
      setLocalValue(String(value));
    }
  }, [value, isFocused]);

  const clamp = (v: number): number => {
    let clamped = v;
    if (min !== undefined) clamped = Math.max(min, clamped);
    if (max !== undefined) clamped = Math.min(max, clamped);
    return integer ? Math.round(clamped) : clamped;
  };

  const parseRaw = (raw: string): number => {
    const parsed = parseFloat(raw);
    return integer ? Math.round(parsed) : parsed;
  };

  return React.createElement('input', {
    ref: inputRef,
    type: 'text',
    inputMode,
    value: localValue,
    disabled,
    style: {
      ...style,
      MozAppearance: 'textfield',
    },
    onClick,
    onFocus: () => {
      setIsFocused(true);
      setTimeout(() => inputRef.current?.select(), 0);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setLocalValue(raw);

      const parsed = parseRaw(raw);
      if (!Number.isNaN(parsed) && onChange) {
        onChange(clamp(parsed));
      }
    },
    onBlur: () => {
      setIsFocused(false);
      const parsed = parseRaw(localValue);
      const fallback = defaultValue ?? min ?? 0;
      const final = Number.isNaN(parsed) ? fallback : clamp(parsed);
      setLocalValue(String(final));
      if (onCommit) onCommit(final);
      else if (onChange) onChange(final);
    },
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        (e.target as HTMLInputElement).blur();
      }
    },
  });
}
