import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function assert(condition: unknown, message: string): void {
  if (!condition) throw new Error(message);
}

const root = process.cwd();
const connectionPanel = readFileSync(resolve(root, 'src/ui/components/ConnectionPanelMain.tsx'), 'utf-8');
const layerPanel = readFileSync(resolve(root, 'src/ui/components/LayerPanel.tsx'), 'utf-8');
const propertiesPanel = readFileSync(resolve(root, 'src/ui/components/PropertiesPanel.tsx'), 'utf-8');

assert(
  !connectionPanel.includes('TEXT SPACING'),
  'ConnectionPanelMain should not render text spacing controls',
);
assert(
  !connectionPanel.includes('textGeometryToPath'),
  'ConnectionPanelMain should not reconvert text geometry from the machine panel',
);
assert(
  !connectionPanel.includes('onUpdateLayerSetting'),
  'ConnectionPanelMain should not mutate layer power/speed/passes',
);
assert(
  !connectionPanel.includes('onUpdateLayerFillInterval'),
  'ConnectionPanelMain should not mutate layer fill interval',
);
assert(
  !connectionPanel.includes('onUpdateLayerFillBidirectional'),
  'ConnectionPanelMain should not mutate layer fill scan direction',
);

assert(
  layerPanel.includes('Power %') && layerPanel.includes('Speed mm/min') && layerPanel.includes('Passes'),
  'LayerPanel should remain the home for layer power/speed/pass controls',
);
assert(
  layerPanel.includes('fill.biDirectional') && layerPanel.includes('settings.fill.interval'),
  'LayerPanel should remain the home for fill interval and scan direction controls',
);
assert(
  propertiesPanel.includes('letterSpacing') && propertiesPanel.includes('wordSpacing') && propertiesPanel.includes('Line Spacing'),
  'PropertiesPanel should remain the home for text spacing controls',
);
