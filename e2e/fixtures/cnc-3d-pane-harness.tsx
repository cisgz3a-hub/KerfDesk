import { createRoot, type Root } from 'react-dom/client';
import { Cnc3DPane } from '../../src/ui/workspace/Cnc3DPane';

const PANE_PREFERENCE_KEY = 'laserforge.cnc-3d-pane-visibility.v1';

let host: HTMLDivElement | null = null;
let root: Root | null = null;
let previousPreference: string | null = null;
let preferenceCaptured = false;

/** Mounts the retired docked pane only inside an E2E page. Production never imports this module. */
export function mountCnc3DPaneHarness(): void {
  unmountCnc3DPaneHarness();
  const main = document.querySelector('main');
  if (main === null) throw new Error('CurveDesk main layout is unavailable');
  previousPreference = localStorage.getItem(PANE_PREFERENCE_KEY);
  preferenceCaptured = true;
  localStorage.setItem(PANE_PREFERENCE_KEY, 'expanded');
  host = document.createElement('div');
  host.dataset.testid = 'cnc-3d-pane-test-harness';
  host.style.display = 'contents';
  main.append(host);
  root = createRoot(host);
  root.render(<Cnc3DPane />);
}

export function unmountCnc3DPaneHarness(): void {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  if (preferenceCaptured && previousPreference === null)
    localStorage.removeItem(PANE_PREFERENCE_KEY);
  else if (preferenceCaptured) localStorage.setItem(PANE_PREFERENCE_KEY, previousPreference);
  previousPreference = null;
  preferenceCaptured = false;
}
