import { useState } from 'react';
import { SuperConsoleDialog } from './SuperConsoleDialog';

// Entry point for the expanded console (ADR-229). Lives beside the docked
// ConsolePanel in the Console rail section instead of inside it so the
// panel keeps its single docked-console responsibility.
export function SuperConsoleLauncher(): JSX.Element {
  const [isOpen, setIsOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        style={launcherStyle}
        onClick={() => setIsOpen(true)}
        title="Open the expanded console: full history with source and time detail, filters, and search."
      >
        Super console
      </button>
      {isOpen ? <SuperConsoleDialog onClose={() => setIsOpen(false)} /> : null}
    </>
  );
}

const launcherStyle: React.CSSProperties = { alignSelf: 'flex-start' };
