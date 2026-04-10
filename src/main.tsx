import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/components/App';
import { TrialGuard } from './ui/components/TrialGuard';

const root = createRoot(document.getElementById('root')!);
root.render(
  React.createElement(TrialGuard, null,
    React.createElement(App),
  ),
);
