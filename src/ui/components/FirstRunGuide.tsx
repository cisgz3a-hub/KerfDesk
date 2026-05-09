import React, { useState } from 'react';
import { FIRST_RUN_GUIDE_STEPS } from '../../onboarding/FirstRunGuide';

export interface FirstRunGuideProps {
  onClose: () => void;
  onOpenMachinePanel: () => void;
  onLoadTestScene: () => void;
}

export function FirstRunGuide({
  onClose,
  onOpenMachinePanel,
  onLoadTestScene,
}: FirstRunGuideProps): React.ReactElement {
  const [stepIndex, setStepIndex] = useState(0);
  const [testSceneLoaded, setTestSceneLoaded] = useState(false);
  const step = FIRST_RUN_GUIDE_STEPS[stepIndex];
  const isLast = stepIndex === FIRST_RUN_GUIDE_STEPS.length - 1;
  const font = "'DM Sans', 'Segoe UI', system-ui, sans-serif";

  const loadTestScene = () => {
    onLoadTestScene();
    setTestSceneLoaded(true);
  };

  const finish = () => {
    onClose();
  };

  return React.createElement('div', {
    'data-testid': 'first-run-guide',
    style: {
      position: 'fixed',
      inset: 0,
      zIndex: 2900,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(5, 8, 18, 0.72)',
      backdropFilter: 'blur(8px)',
      fontFamily: font,
    },
  },
    React.createElement('section', {
      role: 'dialog',
      'aria-modal': true,
      'aria-label': 'Run your first safe test',
      style: {
        width: 'min(560px, calc(100vw - 32px))',
        border: '1px solid rgba(45, 212, 160, 0.28)',
        borderRadius: 8,
        background: '#101827',
        boxShadow: '0 24px 80px rgba(0, 0, 0, 0.55)',
        overflow: 'hidden',
      },
    },
      React.createElement('header', {
        style: {
          padding: '18px 22px 14px',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        },
      },
        React.createElement('div', {
          style: { color: '#8aa4c7', fontSize: 12, marginBottom: 6 },
        }, `Step ${stepIndex + 1} of ${FIRST_RUN_GUIDE_STEPS.length}`),
        React.createElement('h2', {
          style: { margin: 0, color: '#f4f7ff', fontSize: 22, lineHeight: 1.2 },
        }, 'Run your first safe test'),
      ),
      React.createElement('main', {
        style: { padding: '20px 22px 18px' },
      },
        React.createElement('div', {
          style: {
            height: 6,
            borderRadius: 999,
            overflow: 'hidden',
            background: 'rgba(255,255,255,0.08)',
            marginBottom: 18,
          },
        },
          React.createElement('div', {
            'data-testid': 'first-run-guide-progress',
            style: {
              width: `${((stepIndex + 1) / FIRST_RUN_GUIDE_STEPS.length) * 100}%`,
              height: '100%',
              background: '#2dd4a0',
            },
          }),
        ),
        React.createElement('h3', {
          style: { margin: '0 0 8px', color: '#e8eefc', fontSize: 18 },
        }, step.title),
        React.createElement('p', {
          style: { margin: '0 0 16px', color: '#9aa8c7', fontSize: 13, lineHeight: 1.55 },
        }, step.body),
        React.createElement('div', {
          style: {
            display: 'flex',
            gap: 10,
            flexWrap: 'wrap',
          },
        },
          React.createElement('button', {
            type: 'button',
            onClick: loadTestScene,
            'data-testid': 'first-run-guide-load-test-scene',
            style: guideButtonStyle(testSceneLoaded ? 'secondary' : 'primary'),
          }, testSceneLoaded ? '20 mm test square loaded' : 'Load 20 mm test square'),
          step.primaryAction === 'machine-panel' && React.createElement('button', {
            type: 'button',
            onClick: onOpenMachinePanel,
            'data-testid': 'first-run-guide-open-machine-panel',
            style: guideButtonStyle('secondary'),
          }, 'Open machine panel'),
        ),
      ),
      React.createElement('footer', {
        style: {
          display: 'flex',
          justifyContent: 'space-between',
          gap: 12,
          padding: '14px 22px',
          borderTop: '1px solid rgba(255,255,255,0.08)',
        },
      },
        React.createElement('button', {
          type: 'button',
          onClick: finish,
          style: guideButtonStyle('ghost'),
        }, 'Skip guide'),
        React.createElement('div', { style: { display: 'flex', gap: 8 } },
          React.createElement('button', {
            type: 'button',
            onClick: () => setStepIndex(Math.max(0, stepIndex - 1)),
            disabled: stepIndex === 0,
            style: guideButtonStyle('ghost', stepIndex === 0),
          }, 'Back'),
          React.createElement('button', {
            type: 'button',
            onClick: () => {
              if (isLast) finish();
              else setStepIndex(stepIndex + 1);
            },
            style: guideButtonStyle('primary'),
          }, isLast ? 'Finish' : 'Done'),
        ),
      ),
    ),
  );
}

function guideButtonStyle(kind: 'primary' | 'secondary' | 'ghost', disabled = false): React.CSSProperties {
  const primary = kind === 'primary';
  const secondary = kind === 'secondary';
  return {
    padding: '8px 14px',
    minHeight: 36,
    borderRadius: 6,
    border: primary
      ? '1px solid rgba(45, 212, 160, 0.65)'
      : secondary
        ? '1px solid rgba(138, 164, 199, 0.35)'
        : '1px solid transparent',
    background: primary
      ? 'rgba(45, 212, 160, 0.14)'
      : secondary
        ? 'rgba(138, 164, 199, 0.08)'
        : 'transparent',
    color: disabled ? '#4b5870' : primary ? '#2dd4a0' : '#b7c3dc',
    fontSize: 12,
    fontWeight: primary ? 700 : 600,
    fontFamily: "'DM Sans', 'Segoe UI', system-ui, sans-serif",
    cursor: disabled ? 'not-allowed' : 'pointer',
  };
}
