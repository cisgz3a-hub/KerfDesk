import { useEffect, useState } from 'react';
import { Field, NumberInput } from '../kit';
import { clampRecentProjectLimit, MAX_RECENT_PROJECT_LIMIT } from './recent-project-model';
import { useRecentProjectsStore } from './recent-projects-store';

/** How many unpinned projects Recent Projects keeps (ADR-378). Commits on
 * Enter or when the field loses focus; anything unusable reverts. */
export function RecentProjectLimitField(): JSX.Element {
  const limit = useRecentProjectsStore((state) => state.limit);
  const [draft, setDraft] = useState(String(limit));
  useEffect(() => setDraft(String(limit)), [limit]);
  const commit = (): void => {
    const value = Number(draft);
    if (draft.trim() === '' || !Number.isFinite(value)) {
      setDraft(String(limit));
      return;
    }
    setDraft(String(clampRecentProjectLimit(value)));
    void useRecentProjectsStore.getState().setLimit(value);
  };
  return (
    <div style={limitStyle}>
      <Field label="Keep" unit="recent projects">
        <NumberInput
          aria-label="Recent projects to keep"
          min={1}
          max={MAX_RECENT_PROJECT_LIMIT}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
          }}
        />
      </Field>
      <span style={noteStyle}>
        1 to {MAX_RECENT_PROJECT_LIMIT}. Pinned projects are kept as well. This list stays on this
        computer and is never saved in a project.
      </span>
    </div>
  );
}

const limitStyle: React.CSSProperties = { display: 'grid', gap: 4, marginBottom: 12 };
const noteStyle: React.CSSProperties = { color: 'var(--lf-text-muted)', fontSize: 12 };
