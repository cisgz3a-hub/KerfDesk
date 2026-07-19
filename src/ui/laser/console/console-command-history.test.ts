import { describe, expect, it } from 'vitest';
import {
  createConsoleCommandHistory,
  navigateConsoleCommandHistory,
  recordSuccessfulConsoleCommand,
} from './console-command-history';

describe('console command history', () => {
  it('walks newest-to-oldest and restores the pre-navigation draft', () => {
    const initial = createConsoleCommandHistory(['$I', '$$']);
    const newest = navigateConsoleCommandHistory(initial, 'G0 X', 'older');
    const oldest = navigateConsoleCommandHistory(newest.history, newest.value, 'older');
    const newer = navigateConsoleCommandHistory(oldest.history, oldest.value, 'newer');
    const draft = navigateConsoleCommandHistory(newer.history, newer.value, 'newer');

    expect(newest.value).toBe('$$');
    expect(oldest.value).toBe('$I');
    expect(newer.value).toBe('$$');
    expect(draft.value).toBe('G0 X');
    expect(draft.history.cursor).toBeNull();
  });

  it('keeps navigation at the oldest entry and ignores ArrowDown outside history', () => {
    const initial = createConsoleCommandHistory(['$G']);
    const oldest = navigateConsoleCommandHistory(initial, '', 'older');
    const stillOldest = navigateConsoleCommandHistory(oldest.history, oldest.value, 'older');
    const idleDown = navigateConsoleCommandHistory(initial, 'draft', 'newer');

    expect(stillOldest.value).toBe('$G');
    expect(idleDown).toEqual({ history: initial, value: 'draft', handled: false });
  });

  it('records normalized successful commands, suppresses adjacent duplicates, and caps size', () => {
    let history = createConsoleCommandHistory(['$I']);
    history = recordSuccessfulConsoleCommand(history, '  $$  ', 2);
    history = recordSuccessfulConsoleCommand(history, '$$', 2);
    history = recordSuccessfulConsoleCommand(history, '$G', 2);

    expect(history.entries).toEqual(['$$', '$G']);
    expect(history.cursor).toBeNull();
  });
});
