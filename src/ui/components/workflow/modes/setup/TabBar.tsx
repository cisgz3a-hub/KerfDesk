/**
 * T1-207 (Phase 3): tab bar for the setup mode. Pure presentational
 * component — no internal state, no side effects. The parent owns
 * the active tab and persists it via `setupTabPersistence`.
 */
import React from 'react';
import { ALL_SETUP_TABS, type SetupTab } from './setupTabPersistence';

const FONT = "'DM Sans', system-ui, sans-serif";

const TAB_LABEL: Record<SetupTab, string> = {
  move: 'Move',
  job: 'Job',
  console: 'Console',
};

export interface TabBarProps {
  readonly active: SetupTab;
  readonly tabs?: readonly SetupTab[];
  readonly onSelect: (tab: SetupTab) => void;
}

export function TabBar({ active, tabs = ALL_SETUP_TABS, onSelect }: TabBarProps): React.ReactElement {
  return React.createElement(
    'div',
    {
      'data-testid': 'workflow-setup-tab-bar',
      role: 'tablist',
      style: {
        flexShrink: 0,
        display: 'flex',
        gap: 2,
        padding: '6px 12px 0',
        background: '#0a0a14',
        borderBottom: '1px solid #1a1a2e',
      },
    },
    ...tabs.map((tab) => {
      const isActive = tab === active;
      return React.createElement(
        'button',
        {
          'data-testid': `workflow-setup-tab-${tab}`,
          'data-active': isActive,
          key: tab,
          type: 'button',
          role: 'tab',
          'aria-selected': isActive,
          onClick: () => onSelect(tab),
          style: {
            padding: '8px 14px',
            background: isActive ? '#1a1a2e' : 'transparent',
            color: isActive ? '#e5e7eb' : '#9ca3af',
            border: 'none',
            borderTop: isActive ? '2px solid #a78bfa' : '2px solid transparent',
            borderTopLeftRadius: 4,
            borderTopRightRadius: 4,
            fontFamily: FONT,
            fontSize: 12,
            fontWeight: isActive ? 600 : 500,
            cursor: 'pointer',
            letterSpacing: 0.2,
          },
        },
        TAB_LABEL[tab],
      );
    }),
  );
}
