// Toolbar — top bar with File-menu actions. Delegates to shared
// file-actions.ts so the keyboard shortcut listener in App.tsx can call
// the same handlers.

import {
  handleImportSvg,
  handleOpenProject,
  handleSaveGcode,
  handleSaveProject,
} from '../app/file-actions';
import { usePlatform } from '../app/platform-context';
import { useStore } from '../state';
import { useToastStore } from '../state/toast-store';

// F-A13 dirty-check. Returns true if it's safe to proceed (project is clean,
// or the user confirmed discard). Phase A uses the native confirm() —
// promoting to a Save / Don't Save / Cancel modal is Phase C polish.
function confirmDiscard(action: string): boolean {
  const dirty = useStore.getState().dirty;
  if (!dirty) return true;
  const name = useStore.getState().savedName ?? 'this project';
  return window.confirm(
    `Discard unsaved changes to ${name} and ${action}? (Cancel to keep editing — Save first via Save or Ctrl+S.)`,
  );
}

export function Toolbar(): JSX.Element {
  const platform = usePlatform();
  const project = useStore((s) => s.project);
  const importSvgObject = useStore((s) => s.importSvgObject);
  const setProject = useStore((s) => s.setProject);
  const newProject = useStore((s) => s.newProject);
  const savedName = useStore((s) => s.savedName);
  const lastSaveTarget = useStore((s) => s.lastSaveTarget);
  const markSaved = useStore((s) => s.markSaved);
  const markLoaded = useStore((s) => s.markLoaded);
  const pushToast = useToastStore((s) => s.pushToast);

  return (
    <header aria-label="Toolbar" style={barStyle}>
      <span style={titleStyle}>LaserForge 2.0</span>
      <span style={separatorStyle} />
      <button
        type="button"
        onClick={() => {
          if (confirmDiscard('start a new project')) newProject();
        }}
      >
        New
      </button>
      <button
        type="button"
        onClick={() => {
          if (!confirmDiscard('open another project')) return;
          void handleOpenProject({ platform, setProject, markLoaded, pushToast });
        }}
      >
        Open…
      </button>
      <button
        type="button"
        onClick={() =>
          void handleSaveProject({
            platform,
            project,
            savedName,
            lastSaveTarget,
            markSaved,
            pushToast,
          })
        }
      >
        Save
      </button>
      <button
        type="button"
        onClick={() =>
          void handleSaveProject(
            { platform, project, savedName, lastSaveTarget, markSaved, pushToast },
            true,
          )
        }
      >
        Save As…
      </button>
      <span style={separatorStyle} />
      <button
        type="button"
        onClick={() => void handleImportSvg(platform, importSvgObject, pushToast)}
      >
        Import SVG…
      </button>
      <button
        type="button"
        onClick={() => void handleSaveGcode({ platform, project, savedName, pushToast })}
      >
        Save G-code…
      </button>
    </header>
  );
}

const barStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '6px 12px',
  background: '#2c2c2c',
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 13,
  borderBottom: '1px solid #111',
};
const titleStyle: React.CSSProperties = { fontWeight: 600 };
const separatorStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 1,
  height: 16,
  background: '#444',
  margin: '0 4px',
};
