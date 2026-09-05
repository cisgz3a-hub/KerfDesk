import { useEffect, useRef, useState } from 'react';

type CopyState = 'idle' | 'copying' | 'copied' | 'manual';

export function useTranscriptCopy(): {
  readonly copyState: CopyState;
  readonly manualText: string;
  readonly copy: (text: string) => Promise<void>;
  readonly reset: () => void;
} {
  const epoch = useRef(0);
  const [copyState, setCopyState] = useState<CopyState>('idle');
  const [manualText, setManualText] = useState('');
  useEffect(
    () => () => {
      epoch.current += 1;
    },
    [],
  );
  const reset = (): void => {
    epoch.current += 1;
    setCopyState('idle');
    setManualText('');
  };
  const copy = async (text: string): Promise<void> => {
    const owner = ++epoch.current;
    setCopyState('copying');
    try {
      if (navigator.clipboard?.writeText === undefined) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (owner === epoch.current) setCopyState('copied');
    } catch {
      if (owner !== epoch.current) return;
      setManualText(text);
      setCopyState('manual');
    }
  };
  return { copyState, manualText, copy, reset };
}
