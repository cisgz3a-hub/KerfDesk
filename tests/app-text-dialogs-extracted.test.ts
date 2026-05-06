import fs from 'node:fs';
import path from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const appSource = fs.readFileSync(path.join(process.cwd(), 'src', 'ui', 'components', 'App.tsx'), 'utf8');
const componentPath = path.join(process.cwd(), 'src', 'ui', 'components', 'AppTextDialogs.tsx');
const componentSource = fs.existsSync(componentPath) ? fs.readFileSync(componentPath, 'utf8') : '';

assert(
  appSource.includes('AppTextDialogs'),
  'App.tsx should render the extracted text/font dialogs component',
);
assert(
  !appSource.includes('React.createElement(AddTextDialog'),
  'App.tsx should not compose AddTextDialog directly',
);
assert(
  !appSource.includes('React.createElement(FontCreditsDialog'),
  'App.tsx should not compose FontCreditsDialog directly',
);
assert(
  componentSource.includes('React.createElement(AddTextDialog'),
  'AppTextDialogs should compose AddTextDialog',
);
assert(
  componentSource.includes('React.createElement(FontCreditsDialog'),
  'AppTextDialogs should compose FontCreditsDialog',
);
