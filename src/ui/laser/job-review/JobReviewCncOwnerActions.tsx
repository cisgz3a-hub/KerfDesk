// CNC Job Review is intentionally read-only. These exits close the review
// and reveal the two surfaces that own its displayed values.

import { Button } from '../../kit';
import { useUiStore } from '../../state/ui-store';
import { openMachineSetup } from '../device-setup';
import { useJobReviewStore } from './job-review-store';

export function JobReviewCncOwnerActions(): JSX.Element {
  const handleEditArtwork = (): void => {
    useJobReviewStore.getState().cancelAndClose();
    const ui = useUiStore.getState();
    ui.setCutsLayersView('layers');
    ui.focusRailPanel('layers');
  };
  const handleEditStartup = (): void => {
    useJobReviewStore.getState().cancelAndClose();
    openMachineSetup({ kind: 'step', step: 'cnc-setup' });
  };
  return (
    <section aria-label="Edit CNC settings" style={sectionStyle}>
      <span style={copyStyle}>Need to change something?</span>
      <Button onClick={handleEditArtwork}>Edit Artwork settings</Button>
      <Button onClick={handleEditStartup}>Edit Startup Setup</Button>
    </section>
  );
}

const sectionStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 12,
};
const copyStyle: React.CSSProperties = {
  color: 'var(--lf-text-muted)',
  fontSize: 12,
  marginRight: 2,
};
