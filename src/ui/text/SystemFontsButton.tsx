import { useState } from 'react';
import { Button } from '../kit';
import { querySystemFonts, type SystemFontQuery } from './system-fonts';
import { SystemFontsDialog } from './SystemFontsDialog';

/** Opens the installed-font list (ADR-628). The query starts inside the click,
 * where the browser's one-time permission prompt needs the user's gesture. */
export function SystemFontsButton(props: {
  readonly importFont: (file: File) => Promise<void>;
  readonly disabled?: boolean;
}): JSX.Element {
  const [query, setQuery] = useState<Promise<SystemFontQuery> | null>(null);
  return (
    <>
      <Button
        type="button"
        variant="default"
        disabled={props.disabled ?? false}
        onClick={() => setQuery(querySystemFonts())}
        title="Choose a font installed on this computer and embed it in this project."
      >
        System fonts...
      </Button>
      {query === null ? null : (
        <SystemFontsDialog
          query={query}
          importFont={props.importFont}
          onClose={() => setQuery(null)}
        />
      )}
    </>
  );
}
