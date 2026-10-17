// Render production controls; motion terminates in memory, never a transport.
import { createRoot } from 'react-dom/client';
import '../../src/ui/theme/tokens.css';
import { createRectangle } from '../../src/core/shapes/primitives';
import { useStore } from '../../src/ui/state/store';
import { useLaserStore } from '../../src/ui/state/laser-store';
import { JogPad } from '../../src/ui/laser/JogPad';
import { MachineSetupDialogHost } from '../../src/ui/laser/device-setup/MachineSetupDialogHost';

const rectangle = createRectangle({
  id: 'target',
  color: '#000000',
  spec: { widthMm: 20, heightMm: 10, cornerRadiusMm: 0 },
});
useStore.setState((state) => ({
  project: {
    ...state.project,
    device: {
      ...state.project.device,
      origin: 'rear-left',
      controllerKind: 'fluidnc',
      positioningLight: undefined,
    },
    scene: { ...state.project.scene, objects: [rectangle] },
  },
  selectedObjectId: 'target',
  jobPlacement: { ...state.jobPlacement, startFrom: 'absolute' },
}));
useLaserStore.setState({
  connection: { kind: 'connected' },
  activeControllerKind: 'fluidnc',
  statusReport: {
    state: 'Idle',
    subState: null,
    mPos: { x: 0, y: 0, z: 0 },
    wPos: null,
    wco: null,
    feed: 0,
    spindle: 0,
  },
  centrePositioningLight: async (x, y) => {
    fixtureElement('result').textContent = `Simulated centre ${x}, ${y}`;
    useLaserStore.setState({ positioningLightEnabled: true });
  },
  switchPositioningLightOff: async () => {
    fixtureElement('result').textContent = 'Simulated LED off';
    useLaserStore.setState({ positioningLightEnabled: false });
  },
});

function Fixture(): JSX.Element {
  return (
    <main style={{ padding: 12 }}>
      <h1>Positioning light — simulated controls</h1>
      <aside
        aria-label="Machine controls"
        style={{ width: 286, border: '1px solid #888', padding: 12 }}
      >
        <JogPad disabled={false} />
      </aside>
      <button
        onClick={() =>
          useStore.setState((state) => ({
            project: {
              ...state.project,
              device: {
                ...state.project.device,
                positioningLight: {
                  onCommand: 'M64 P0',
                  offCommand: 'M65 P0',
                  offsetXmm: 2,
                  offsetYmm: -3,
                },
              },
            },
          }))
        }
      >
        Load configured fixture
      </button>
      <button onClick={() => useStore.getState().selectObject(null)}>Deselect fixture</button>
      <output id="result" />
      <MachineSetupDialogHost />
    </main>
  );
}

function fixtureElement(id: string): HTMLElement {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`Missing fixture element: ${id}`);
  return element;
}

createRoot(fixtureElement('root')).render(<Fixture />);
