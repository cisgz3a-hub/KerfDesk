import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { parseStatusReport } from '../../src/core/controllers/grbl/status-parser';
import { LiveMotionBar } from '../../src/ui/laser/LiveMotionBar';
import { useLaserStore } from '../../src/ui/state/laser-store';
import '../../src/ui/theme/tokens.css';

// Render controller Hold without creating a transport or sending machine commands.
useLaserStore.setState({
  connection: { kind: 'connected' },
  statusReport: parseStatusReport('<Hold:0|MPos:0,0,0>'),
  stopJob: async () => {
    document.documentElement.dataset.abortClicked = 'true';
  },
});
const root = document.getElementById('app-root');
if (root === null) throw new Error('Missing startup workspace root');
root.append(document.createElement('canvas'));
root.querySelector('canvas')?.setAttribute('data-workspace-painted', 'true');
const host = document.createElement('div');
root.append(host);
createRoot(host).render(createElement(LiveMotionBar));
document.documentElement.dataset.desktopWindowVisible = 'true';
