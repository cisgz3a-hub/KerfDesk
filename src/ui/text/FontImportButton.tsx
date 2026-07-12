import { useRef } from 'react';
import { Button } from '../kit';
import { useToastStore } from '../state/toast-store';

export function FontImportButton(props: {
  readonly importFont: (file: File) => Promise<void>;
}): JSX.Element {
  const inputRef = useRef<HTMLInputElement>(null);
  const pushToast = useToastStore((state) => state.pushToast);
  return (
    <>
      <Button
        type="button"
        variant="default"
        onClick={() => inputRef.current?.click()}
        title="Import a TTF or OTF font and embed it in this project."
      >
        Import
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".ttf,.otf,font/ttf,font/otf"
        hidden
        aria-label="Import font file"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file === undefined) return;
          void props.importFont(file).catch((error: unknown) => {
            pushToast(error instanceof Error ? error.message : String(error), 'error');
          });
        }}
      />
    </>
  );
}
