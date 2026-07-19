export const CONSOLE_COMMAND_HISTORY_LIMIT = 100;

export type ConsoleCommandHistory = {
  readonly entries: ReadonlyArray<string>;
  /** null means the input is showing the live draft rather than history. */
  readonly cursor: number | null;
  /** Input value captured when the operator first pressed ArrowUp. */
  readonly draft: string;
};

export type ConsoleCommandHistoryNavigation = {
  readonly history: ConsoleCommandHistory;
  readonly value: string;
  readonly handled: boolean;
};

export function createConsoleCommandHistory(
  entries: ReadonlyArray<string> = [],
): ConsoleCommandHistory {
  return {
    entries: entries.slice(-CONSOLE_COMMAND_HISTORY_LIMIT),
    cursor: null,
    draft: '',
  };
}

/** Records only commands the caller has already confirmed were sent. */
export function recordSuccessfulConsoleCommand(
  history: ConsoleCommandHistory,
  command: string,
  limit = CONSOLE_COMMAND_HISTORY_LIMIT,
): ConsoleCommandHistory {
  const normalized = command.trim();
  if (normalized === '') return { ...history, cursor: null, draft: '' };
  const entries =
    history.entries.at(-1) === normalized
      ? history.entries
      : [...history.entries, normalized].slice(-Math.max(1, limit));
  return { entries, cursor: null, draft: '' };
}

export function navigateConsoleCommandHistory(
  history: ConsoleCommandHistory,
  currentValue: string,
  direction: 'older' | 'newer',
): ConsoleCommandHistoryNavigation {
  if (history.entries.length === 0) {
    return { history, value: currentValue, handled: false };
  }

  if (direction === 'older') {
    const cursor =
      history.cursor === null ? history.entries.length - 1 : Math.max(0, history.cursor - 1);
    return {
      history: {
        ...history,
        cursor,
        draft: history.cursor === null ? currentValue : history.draft,
      },
      value: history.entries[cursor] ?? currentValue,
      handled: true,
    };
  }

  if (history.cursor === null) {
    return { history, value: currentValue, handled: false };
  }
  if (history.cursor >= history.entries.length - 1) {
    return {
      history: { ...history, cursor: null },
      value: history.draft,
      handled: true,
    };
  }
  const cursor = history.cursor + 1;
  return {
    history: { ...history, cursor },
    value: history.entries[cursor] ?? currentValue,
    handled: true,
  };
}
