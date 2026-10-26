// SystemFontsDialog — lists the fonts installed on this computer and embeds
// the chosen face through the ordinary font import (ADR-628).

import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DialogActions } from '../kit';
import {
  filterSystemFonts,
  systemFontFile,
  type SystemFontFace,
  type SystemFontFamily,
  type SystemFontFile,
  type SystemFontQuery,
} from './system-fonts';
import './system-fonts.css';

/** Rendering every family of a large font folder at once would stall typing. */
export const SYSTEM_FONT_ROW_LIMIT = 150;

export const SYSTEM_FONTS_UNSUPPORTED =
  'This browser cannot list installed fonts. Use Chrome or Edge, or the KerfDesk desktop app, or Import a TTF or OTF file.';
export const SYSTEM_FONTS_DENIED =
  'KerfDesk was not allowed to read your installed fonts. Allow font access for this site in your browser settings and try again, or Import a TTF or OTF file.';
// Some browsers answer a blocked or dismissed permission with an empty list
// rather than an error, so an empty answer is not "no fonts installed".
export const SYSTEM_FONTS_EMPTY =
  'The browser listed no installed fonts. It may be blocking font access for this site: allow it in your browser settings and try again, or Import a TTF or OTF file.';
export const SYSTEM_FONT_RESTRICTED =
  "This font's licence restricts embedding. Keep projects that use it to yourself unless the licence allows sharing.";

// Reading a face can be slow. Closing the dialog meanwhile abandons it: a
// dismissed font must never land in the text editor afterwards.
function useCloseGuard(onClose: () => void): {
  readonly isOpen: () => boolean;
  readonly close: () => void;
} {
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );
  return {
    isOpen: () => open.current,
    // Once only: an import that ends after the dialog closed does not close it again.
    close: () => {
      if (!open.current) return;
      open.current = false;
      onClose();
    },
  };
}

export function SystemFontsDialog(props: {
  readonly query: Promise<SystemFontQuery>;
  readonly importFont: (file: File) => Promise<void>;
  readonly onClose: () => void;
}): JSX.Element {
  const { importFont, onClose } = props;
  const result = useQueryResult(props.query);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restricted, setRestricted] = useState<SystemFontFile | null>(null);
  const { isOpen, close } = useCloseGuard(onClose);
  const embed = async (file: File): Promise<void> => {
    if (!isOpen()) return;
    await importFont(file);
    close();
  };
  const choose = async (face: SystemFontFace): Promise<void> => {
    setBusy(face.postscriptName);
    setError(null);
    try {
      const chosen = await systemFontFile(face);
      if (!isOpen()) return;
      if (chosen.restricted) setRestricted(chosen);
      else await embed(chosen.file);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(null);
    }
  };
  return (
    <Dialog title="System fonts" size="md" onClose={close}>
      {restricted === null ? (
        <SystemFontsBody
          result={result}
          search={search}
          onSearch={setSearch}
          busy={busy}
          onChoose={(face) => void choose(face)}
        />
      ) : (
        <p className="lf-system-fonts-notice" role="note">
          {SYSTEM_FONT_RESTRICTED}
        </p>
      )}
      {error === null ? null : (
        <p className="lf-system-fonts-error" role="alert">
          {error}
        </p>
      )}
      <DialogActions>
        {restricted === null ? null : (
          <>
            <Button type="button" onClick={() => setRestricted(null)}>
              Back
            </Button>
            <Button
              type="button"
              variant="primary"
              onClick={() =>
                void embed(restricted.file).catch((caught: unknown) =>
                  setError(caught instanceof Error ? caught.message : String(caught)),
                )
              }
            >
              Embed font
            </Button>
          </>
        )}
        <Button type="button" onClick={close}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function useQueryResult(query: Promise<SystemFontQuery>): SystemFontQuery | null {
  const [result, setResult] = useState<SystemFontQuery | null>(null);
  useEffect(() => {
    let live = true;
    void query.then((value) => {
      if (live) setResult(value);
    });
    return () => {
      live = false;
    };
  }, [query]);
  return result;
}

function SystemFontsBody(props: {
  readonly result: SystemFontQuery | null;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly busy: string | null;
  readonly onChoose: (face: SystemFontFace) => void;
}): JSX.Element {
  const { result } = props;
  if (result === null) return <p className="lf-muted">Reading the fonts on this computer…</p>;
  if (result.kind === 'unsupported') return <p role="note">{SYSTEM_FONTS_UNSUPPORTED}</p>;
  if (result.kind === 'denied') return <p role="note">{SYSTEM_FONTS_DENIED}</p>;
  if (result.kind === 'failed') {
    return <p role="alert">Could not list installed fonts: {result.message}</p>;
  }
  if (result.families.length === 0) return <p role="note">{SYSTEM_FONTS_EMPTY}</p>;
  return <SystemFontList {...props} families={result.families} />;
}

function SystemFontList(props: {
  readonly families: ReadonlyArray<SystemFontFamily>;
  readonly search: string;
  readonly onSearch: (value: string) => void;
  readonly busy: string | null;
  readonly onChoose: (face: SystemFontFace) => void;
}): JSX.Element {
  const matches = useMemo(
    () => filterSystemFonts(props.families, props.search),
    [props.families, props.search],
  );
  const shown = matches.slice(0, SYSTEM_FONT_ROW_LIMIT);
  return (
    <div className="lf-system-fonts">
      <style>{shown.flatMap((family) => family.faces.map(facePreviewRule)).join('\n')}</style>
      <input
        type="search"
        className="lf-input"
        aria-label="Search installed fonts"
        title="Type part of a font family or style name, like arial bold."
        placeholder="Search installed fonts"
        value={props.search}
        onChange={(event) => props.onSearch(event.target.value)}
      />
      <p className="lf-muted lf-system-fonts-count" aria-live="polite">
        {countText(matches.length, shown.length)}
      </p>
      <ul className="lf-system-fonts-list" aria-label="Installed fonts">
        {shown.map((family) => (
          <li key={family.family} className="lf-system-fonts-family">
            <span
              className="lf-system-fonts-specimen"
              style={{ fontFamily: quoted(family.family) }}
            >
              {family.family}
            </span>
            <span className="lf-system-fonts-styles">
              {family.faces.map((face) => (
                <Button
                  key={face.postscriptName}
                  type="button"
                  disabled={props.busy !== null}
                  title={`Embed ${face.fullName} in this project.`}
                  aria-label={`Use ${face.fullName}`}
                  onClick={() => props.onChoose(face)}
                >
                  <span style={facePreviewStyle(face)}>
                    {props.busy === face.postscriptName ? 'Embedding…' : face.style}
                  </span>
                </Button>
              ))}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function countText(total: number, shown: number): string {
  if (total === 0) return 'No installed font matches.';
  const families = `${total} font ${total === 1 ? 'family' : 'families'}`;
  return shown < total ? `${families}. Showing ${shown}; type to narrow the list.` : families;
}

function quoted(family: string): string {
  return `"${family.replace(/["\\]/g, '')}", system-ui`;
}

function previewFamily(face: SystemFontFace): string {
  return `KerfDesk system font preview ${face.postscriptName}`;
}

function facePreviewRule(face: SystemFontFace): string {
  // local() selects the exact enumerated face, including named weights and
  // widths, without guessing CSS descriptors from a possibly localised style
  // name or reading font bytes before the operator chooses to embed it.
  // https://www.w3.org/TR/css-fonts-3/#src-desc
  return `@font-face { font-family: ${cssString(previewFamily(face))}; src: local(${cssString(face.postscriptName)}), local(${cssString(face.fullName)}); font-weight: 400; font-style: normal; }`;
}

function facePreviewStyle(face: SystemFontFace): React.CSSProperties {
  return {
    fontFamily: `${cssString(previewFamily(face))}, ${quoted(face.family)}`,
    fontWeight: 400,
    fontStyle: 'normal',
    fontSynthesis: 'none',
  };
}

function cssString(value: string): string {
  return `"${value
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\f]/g, ' ')}"`;
}
