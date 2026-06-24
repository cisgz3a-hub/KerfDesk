// RegistrationJigPanel — the persistent, NON-modal jig assistant pinned to the
// top-right of the canvas (ADR-057). Consolidates create-box, center-artwork, and
// the two-run output toggle into one switchable surface with a live "Next burn"
// status and built-in instructions. It never calls useRegisterModal, so canvas
// mouse handling and keyboard shortcuts keep working while it is open; it stays
// open until the operator closes it (toolbar toggle or the × here).

import { useState } from 'react';
import {
  findRegistrationBoxes,
  registrationRunState,
  type RegistrationRunState,
} from '../../core/scene';
import { Button, NumberInput } from '../kit';
import { useStore } from '../state';
import { useUiStore } from '../state/ui-store';

const DEFAULT_WIDTH_MM = 80;
const DEFAULT_HEIGHT_MM = 40;

export function RegistrationJigPanel(): JSX.Element | null {
  const open = useUiStore((s) => s.registrationPanelOpen);
  const scene = useStore((s) => s.project.scene);
  const selectedObjectId = useStore((s) => s.selectedObjectId);
  const additionalSelectedIds = useStore((s) => s.additionalSelectedIds);
  const centerInBox = useStore((s) => s.centerSelectionInRegistrationBox);
  const setOutput = useStore((s) => s.setRegistrationOutput);
  const close = useUiStore((s) => s.closeRegistrationPanel);

  const boxes = findRegistrationBoxes(scene);
  const hasBox = boxes.length > 0;
  const runState = registrationRunState(scene);
  const boxIds = new Set(boxes.map((b) => b.id));
  const canCenter =
    hasBox &&
    [selectedObjectId, ...additionalSelectedIds].some((id) => id !== null && !boxIds.has(id));

  if (!open) return null;
  return (
    <section aria-label="Registration jig" className="lf-chip" style={panelStyle}>
      <header style={headerStyle}>
        <strong>Registration Jig</strong>
        <Button variant="ghost" aria-label="Close registration jig panel" onClick={close}>
          ×
        </Button>
      </header>

      <NextBurnBanner state={runState} />

      <JigBoxControls />

      <Button
        onClick={centerInBox}
        disabled={!canCenter}
        title={
          canCenter
            ? 'Center the selected artwork in the box'
            : 'Select your artwork first, then center it in the box'
        }
      >
        Center artwork in box
      </Button>

      <BurnRunToggle state={runState} disabled={!hasBox} onPick={setOutput} />

      <RegistrationJigHelp />
    </section>
  );
}

// Box size + create/replace/remove + lock. Self-contained (owns the size inputs)
// so the panel root stays under the function-size cap.
function JigBoxControls(): JSX.Element {
  const scene = useStore((s) => s.project.scene);
  const addRegistrationBox = useStore((s) => s.addRegistrationBox);
  const removeBox = useStore((s) => s.removeRegistrationBox);
  const setBoxLocked = useStore((s) => s.setRegistrationBoxLocked);

  const box = findRegistrationBoxes(scene)[0];
  const hasBox = box !== undefined;
  const boxLocked = box?.locked === true;
  const rectSpec = box !== undefined && box.spec.kind === 'rect' ? box.spec : null;
  const [widthMm, setWidthMm] = useState(String(rectSpec?.widthMm ?? DEFAULT_WIDTH_MM));
  const [heightMm, setHeightMm] = useState(String(rectSpec?.heightMm ?? DEFAULT_HEIGHT_MM));
  const onCreate = (): void => {
    const w = Number(widthMm);
    const h = Number(heightMm);
    if (Number.isFinite(w) && Number.isFinite(h) && w >= 1 && h >= 1) addRegistrationBox(w, h);
  };

  return (
    <>
      <div style={sizeRowStyle}>
        <span>W</span>
        <NumberInput
          value={widthMm}
          min={1}
          step={1}
          aria-label="Registration box width"
          style={sizeInputStyle}
          onChange={(e) => setWidthMm(e.target.value)}
        />
        <span>H</span>
        <NumberInput
          value={heightMm}
          min={1}
          step={1}
          aria-label="Registration box height"
          style={sizeInputStyle}
          onChange={(e) => setHeightMm(e.target.value)}
        />
        <span style={unitStyle}>mm</span>
        <Button variant="primary" onClick={onCreate}>
          {hasBox ? 'Replace box' : 'Create box'}
        </Button>
        {hasBox ? (
          <Button variant="danger" onClick={removeBox}>
            Remove box
          </Button>
        ) : null}
      </div>
      {hasBox ? (
        <label style={lockRowStyle}>
          <input
            type="checkbox"
            checked={boxLocked}
            aria-label="Lock registration box"
            title="Lock the box so it can't move between the two burns"
            onChange={(e) => setBoxLocked(e.target.checked)}
          />
          Lock box (prevent moving between burns)
        </label>
      ) : null}
    </>
  );
}

function NextBurnBanner(props: { readonly state: RegistrationRunState }): JSX.Element {
  const banner = bannerFor(props.state);
  return (
    <div className={banner.className} role="status">
      {banner.text}
    </div>
  );
}

function bannerFor(state: RegistrationRunState): {
  readonly className: string;
  readonly text: string;
} {
  switch (state) {
    case 'none':
      return { className: 'lf-banner', text: 'Create a box below to begin.' };
    case 'box':
      return {
        className: 'lf-banner lf-banner--info',
        text: '▶ Next Start burns: BOX outline (run 1)',
      };
    case 'artwork':
      return {
        className: 'lf-banner lf-banner--info',
        text: '▶ Next Start burns: your ARTWORK (run 2)',
      };
    case 'mixed':
      return {
        className: 'lf-banner lf-banner--warning',
        text: 'Pick a run below — Box only or Artwork only.',
      };
  }
}

function BurnRunToggle(props: {
  readonly state: RegistrationRunState;
  readonly disabled: boolean;
  readonly onPick: (scope: 'box' | 'artwork') => void;
}): JSX.Element {
  return (
    <div role="group" aria-label="Burn run" style={toggleRowStyle}>
      <span>Burn run:</span>
      <Button
        pressed={props.state === 'box'}
        disabled={props.disabled}
        onClick={() => props.onPick('box')}
      >
        Box only
      </Button>
      <Button
        pressed={props.state === 'artwork'}
        disabled={props.disabled}
        onClick={() => props.onPick('artwork')}
      >
        Artwork only
      </Button>
    </div>
  );
}

function RegistrationJigHelp(): JSX.Element {
  const [open, setOpen] = useState(true);
  return (
    <div style={helpStyle}>
      <Button variant="ghost" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {open ? '▾' : '▸'} How to use
      </Button>
      {open && (
        <ol style={helpListStyle}>
          <li>
            Set the size and <strong>Create box</strong>. Pick <strong>Box only</strong>, then Start
            to burn the box on scrap.
          </li>
          <li>Put your object inside the burned outline.</li>
          <li>
            Add your artwork, select it, then <strong>Center artwork in box</strong>.
          </li>
          <li>
            Pick <strong>Artwork only</strong>, then Start to burn the art.
          </li>
          <li style={helpNoteStyle}>
            Drag the box onto your material to move it; Remove box deletes it. On a no-homing
            machine, Set Origin + Frame (Laser panel) first; a homing machine can burn straight from
            the box's position.
          </li>
        </ol>
      )}
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  position: 'absolute',
  top: 12,
  right: 12,
  width: 250,
  maxHeight: 'calc(100% - 24px)',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  padding: 12,
  boxShadow: 'var(--lf-shadow)',
  pointerEvents: 'auto',
  fontSize: 13,
};
const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};
const sizeRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  flexWrap: 'wrap',
};
const sizeInputStyle: React.CSSProperties = { width: 56 };
const unitStyle: React.CSSProperties = { color: 'var(--lf-text-faint)' };
const lockRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
};
const toggleRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };
const helpStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const helpListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  display: 'grid',
  gap: 4,
  fontSize: 12,
};
const helpNoteStyle: React.CSSProperties = {
  color: 'var(--lf-text-faint)',
  listStyle: 'none',
  marginLeft: -18,
};
