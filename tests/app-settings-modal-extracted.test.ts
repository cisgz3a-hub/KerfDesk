import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const componentPath = path.join(process.cwd(), 'src', 'ui', 'components', 'AppSettingsModal.tsx');
const componentSource = fs.existsSync(componentPath) ? fs.readFileSync(componentPath, 'utf8') : '';

assert(
  appSource.includes('AppSettingsModal'),
  'App.tsx should render the extracted settings modal composition component',
);
assert(
  !appSource.includes('React.createElement(SettingsModal'),
  'App.tsx should not compose SettingsModal tabs directly',
);
assert(
  componentSource.includes('React.createElement(SettingsModal'),
  'AppSettingsModal should compose SettingsModal',
);
assert(
  componentSource.includes('MachineSettingsTab') && componentSource.includes('ProfilesSettingsTab'),
  'AppSettingsModal should preserve settings tab composition',
);
assert(
  componentSource.includes('Third-party licenses: see LICENSES-THIRD-PARTY.md'),
  'AppSettingsModal should preserve About tab license guidance',
);
assert(
  componentSource.includes('Operator mode')
    && componentSource.includes("modeButton('beginner', 'Beginner')")
    && componentSource.includes("modeButton('advanced', 'Advanced')"),
  'AppSettingsModal should expose the T2-64 operator mode toggle',
);
