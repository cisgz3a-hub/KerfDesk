import { useState } from 'react';
import { Button } from '../kit';
import { settingsNoteStyle } from '../settings/settings-styles';

export function CopyConnectionValue({
  value,
  label,
}: {
  readonly value: string;
  readonly label: string;
}): JSX.Element {
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);
  const [copying, setCopying] = useState(false);
  const copy = async (): Promise<void> => {
    setCopying(true);
    setResult(null);
    try {
      await navigator.clipboard.writeText(value);
      setResult('copied');
    } catch {
      setResult('failed');
    } finally {
      setCopying(false);
    }
  };
  return (
    <div style={{ display: 'grid', gap: 4, justifyItems: 'start' }}>
      <Button disabled={copying} onClick={() => void copy()}>
        {label}
      </Button>
      {result === null ? null : (
        <p role="status" style={settingsNoteStyle}>
          {result === 'copied' ? 'Copied.' : 'Copy is unavailable. Select and copy this text:'}
        </p>
      )}
      {result === 'failed' ? (
        <code style={{ overflowWrap: 'anywhere', userSelect: 'all' }}>{value}</code>
      ) : null}
    </div>
  );
}
