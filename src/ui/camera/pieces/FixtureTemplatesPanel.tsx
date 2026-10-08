import { useState } from 'react';
import { useStore } from '../../state';
import { usePieceScanStore } from './piece-scan-store';
import { SaveFixtureDialog } from './SaveFixtureDialog';
import { FixtureReviewDialog } from './FixtureReviewDialog';
import type { FixtureTemplate } from '../../../core/camera/fixtures/fixture-template';

export function FixtureTemplatesPanel(): JSX.Element {
  const scan = usePieceScanStore((state) => state.scan);
  const templates = useStore((state) => state.project.fixtureTemplates);
  const [saving, setSaving] = useState(false);
  const [review, setReview] = useState<FixtureTemplate | null>(null);
  return (
    <section
      aria-label="Reusable fixture intent"
      style={{ display: 'grid', gap: 6, marginTop: 12 }}
    >
      <strong>Reusable fixtures</strong>
      <p style={{ fontSize: 12, margin: 0 }}>
        Save included piece geometry and sample placement for a later batch. Saved positions need a
        fresh physical alignment check.
      </p>
      <button
        type="button"
        className="lf-btn"
        disabled={scan === null || scan.pieces.length === scan.excluded.size}
        title="Save the included scan geometry, coordinate basis and camera/height context in this project."
        onClick={() => setSaving(true)}
      >
        Save current fixture
      </button>
      {(templates ?? []).map((template) => (
        <button
          type="button"
          className="lf-btn"
          key={template.id}
          title="Review saved slots, placement intent and observations before reusing this fixture."
          onClick={() => setReview(template)}
        >
          {template.name} · {template.slots.length} slots
        </button>
      ))}
      {saving && <SaveFixtureDialog onClose={() => setSaving(false)} />}
      {review !== null && (
        <FixtureReviewDialog key={review.id} template={review} onClose={() => setReview(null)} />
      )}
    </section>
  );
}
