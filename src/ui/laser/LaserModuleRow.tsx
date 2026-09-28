// Which laser module is fitted, on a machine whose modules swap on the same
// carriage (ADR-503). Picking one swaps the profile's laser head: recipes,
// the beam the checks and the burn preview use, and the power the burn
// preview counts follow it. The G-code does not change.

import { machineKindOf } from '../../core/scene';
import {
  fittedLaserModuleIndex,
  laserModuleLabel,
  laserModulesFor,
} from '../../core/devices/laser-modules';
import { useStore } from '../state';

export function LaserModuleRow(): JSX.Element | null {
  const device = useStore((state) => state.project.device);
  const kind = useStore((state) => machineKindOf(state.project.machine));
  const updateDeviceProfile = useStore((state) => state.updateDeviceProfile);
  const modules = laserModulesFor(device);
  if (kind !== 'laser' || modules.length < 2) return null;
  const fitted = fittedLaserModuleIndex(device);
  return (
    <div style={rowStyle}>
      <label style={labelStyle}>
        Laser module
        <select
          className="lf-input"
          aria-label="Laser module"
          title="The module on the carriage now. Swap it on the machine, then pick it here."
          value={fitted < 0 ? '' : String(fitted)}
          style={selectStyle}
          onChange={(event) => {
            const module = modules[Number(event.currentTarget.value)];
            if (module !== undefined) updateDeviceProfile({ laserSubProfile: { ...module } });
          }}
        >
          {fitted < 0 ? (
            <option value="" disabled>
              Pick the fitted module
            </option>
          ) : null}
          {modules.map((module, index) => (
            <option key={module.model} value={String(index)}>
              {laserModuleLabel(module)}
            </option>
          ))}
        </select>
      </label>
      <p style={noteStyle}>
        Recipes, the beam size and the burn preview follow the module picked here; the G-code does
        not change.
      </p>
    </div>
  );
}

const rowStyle: React.CSSProperties = { display: 'grid', gap: 2, padding: '4px 0' };

const labelStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 6 };

const selectStyle: React.CSSProperties = { flex: 1, minWidth: 0 };

const noteStyle: React.CSSProperties = {
  margin: 0,
  color: 'var(--lf-text-muted)',
  fontSize: 'var(--lf-text-xs)',
};
