import { useState, type FormEvent } from 'react';
import { findLicenceKey, looksLikePartialLicenceKey } from '../../../public/licence-key-text.mjs';
import type { LicenceAdapter } from '../../platform/types';

type Props = {
  readonly value: string;
  readonly setValue: (value: string) => void;
  readonly busy: boolean;
  readonly submit: (event: FormEvent) => void;
  /** Supplies Paste key; without `clipboardKey` the form offers typing only. */
  readonly client?: LicenceAdapter | undefined;
};

const NOTHING_TO_PASTE =
  'No KerfDesk licence key is on the clipboard. Copy the key from the purchase page or your email first, then choose Paste key.';

/**
 * Licence key entry. The key is shown as typed, so a customer can see what they
 * pasted; it finds the key inside pasted text the same way the app activates it,
 * and Paste key takes it from the clipboard in one click.
 */
export function LicenceActivationForm({
  value,
  setValue,
  busy,
  submit,
  client,
}: Props): JSX.Element {
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  const paste = async (): Promise<void> => {
    try {
      const key = (await client?.clipboardKey?.()) ?? null;
      if (key === null) setPasteNote(NOTHING_TO_PASTE);
      else {
        setValue(key);
        setPasteNote(null);
      }
    } catch {
      setPasteNote(NOTHING_TO_PASTE);
    }
  };
  const note = pasteNote ?? keyNote(value);
  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 10, marginTop: 12 }}>
      <label htmlFor="kerfdesk-licence-key">Licence key</label>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          id="kerfdesk-licence-key"
          title="Paste the licence key from your purchase, or the key you were given"
          className="lf-input"
          value={value}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setPasteNote(null);
          }}
          type="text"
          autoComplete="off"
          spellCheck={false}
          maxLength={512}
          disabled={busy}
          placeholder="KD1.…"
          aria-describedby="kerfdesk-licence-key-note"
          style={{ flex: 1, minWidth: 0, fontFamily: 'var(--lf-font-mono)' }}
        />
        {client?.clipboardKey === undefined ? null : (
          <button
            type="button"
            className="lf-btn"
            disabled={busy}
            onClick={() => void paste()}
            title="Take the KerfDesk licence key you copied, from the clipboard"
          >
            Paste key
          </button>
        )}
      </div>
      <p id="kerfdesk-licence-key-note" role="status" style={noteStyle}>
        {note}
      </p>
      <button
        type="submit"
        className="lf-btn lf-btn--primary"
        title="Unlock Pro on this device with the licence key"
        disabled={busy || value.trim().length < 8}
      >
        Activate licence
      </button>
    </form>
  );
}

function keyNote(value: string): string {
  if (looksLikePartialLicenceKey(value))
    return 'Part of the key seems to be missing. A whole key starts with KD1. and is 84 characters long.';
  const found = findLicenceKey(value);
  if (found !== null && found !== value.trim())
    return 'Found your licence key in the pasted text. Choose Activate licence.';
  return 'Your key starts with KD1. It is on the purchase page after payment.';
}

const noteStyle = {
  margin: 0,
  fontSize: 13,
  color: 'var(--lf-text-muted)',
  lineHeight: 1.5,
} as const;
