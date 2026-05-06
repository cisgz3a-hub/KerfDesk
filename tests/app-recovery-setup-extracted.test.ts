import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const componentPath = path.join(process.cwd(), 'src', 'ui', 'components', 'AppRecoverySetup.tsx');
const componentSource = fs.existsSync(componentPath) ? fs.readFileSync(componentPath, 'utf8') : '';

assert(
  appSource.includes('AppRecoverySetup'),
  'App.tsx should render the extracted recovery/setup composition component',
);
assert(
  !appSource.includes('Unsaved work found from'),
  'App.tsx should not own autosave recovery banner copy',
);
assert(
  !appSource.includes('React.createElement(WelcomeWizard'),
  'App.tsx should not compose WelcomeWizard directly',
);
assert(
  componentSource.includes('Unsaved work found from'),
  'AppRecoverySetup should preserve autosave recovery banner copy',
);
assert(
  componentSource.includes('React.createElement(WelcomeWizard'),
  'AppRecoverySetup should compose WelcomeWizard',
);
