import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/components/App';
import { TrialGuard } from './ui/components/TrialGuard';
import { SafetyDisclaimer } from './ui/components/SafetyDisclaimer';

const root = createRoot(document.getElementById('root')!);
root.render(
  React.createElement(SafetyDisclaimer, null,
    React.createElement(TrialGuard, null,
      React.createElement(App),
    ),
  ),
);
