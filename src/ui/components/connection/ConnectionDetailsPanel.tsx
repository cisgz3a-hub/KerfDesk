import React from 'react';

export type ConnectionDetailsPanelKey = 'workflow' | 'issues' | 'advanced';

interface JobDetailsLaunchersProps {
  issueCount: number;
  onOpen: (panel: ConnectionDetailsPanelKey) => void;
  showAdvanced?: boolean;
}

interface ConnectionDetailsPanelProps {
  activePanel: ConnectionDetailsPanelKey | null;
  issueCount: number;
  onSelect: (panel: ConnectionDetailsPanelKey) => void;
  onClose: () => void;
  workflowSection: React.ReactNode;
  issuesSection: React.ReactNode;
  advancedSection: React.ReactNode;
  showAdvanced?: boolean;
}

const font = "'DM Sans', system-ui, sans-serif";

const tabs: Array<{ key: ConnectionDetailsPanelKey; label: string }> = [
  { key: 'workflow', label: 'Workflow' },
  { key: 'issues', label: 'Issues' },
  { key: 'advanced', label: 'Advanced' },
];

function labelFor(key: ConnectionDetailsPanelKey, issueCount: number): string {
  if (key !== 'issues') return tabs.find(tab => tab.key === key)?.label ?? key;
  return issueCount > 0 ? `Issues (${issueCount})` : 'Issues';
}

function availableTabs(showAdvanced: boolean): Array<{ key: ConnectionDetailsPanelKey; label: string }> {
  return showAdvanced ? tabs : tabs.filter(tab => tab.key !== 'advanced');
}

function contentFor(
  key: ConnectionDetailsPanelKey,
  workflowSection: React.ReactNode,
  issuesSection: React.ReactNode,
  advancedSection: React.ReactNode,
  showAdvanced: boolean,
): React.ReactNode {
  if (key === 'workflow') return workflowSection;
  if (key === 'issues') return issuesSection;
  if (!showAdvanced) return workflowSection;
  return advancedSection;
}

export function JobDetailsLaunchers({ issueCount, onOpen, showAdvanced = true }: JobDetailsLaunchersProps) {
  const visibleTabs = availableTabs(showAdvanced);
  return React.createElement('div', {
    'data-testid': 'connection-details-launchers',
    style: {
      padding: '10px 16px',
      borderBottom: '1px solid #1a1a2e',
      flexShrink: 0,
    },
  },
    React.createElement('div', {
      style: {
        fontSize: 10,
        color: '#777798',
        marginBottom: 7,
        textTransform: 'uppercase' as const,
        letterSpacing: 0,
        fontWeight: 700,
      },
    }, 'Job details'),
    React.createElement('div', { style: { display: 'flex', gap: 6 } },
      visibleTabs.map(tab => React.createElement('button', {
        key: tab.key,
        type: 'button',
        'data-testid': `connection-details-open-${tab.key}`,
        onPointerDown: () => onOpen(tab.key),
        onClick: () => onOpen(tab.key),
        style: {
          flex: 1,
          padding: '8px 6px',
          borderRadius: 6,
          cursor: 'pointer',
          fontFamily: font,
          fontSize: 10,
          fontWeight: 700,
          background: '#0a0a14',
          border: '1px solid #252540',
          color: '#c0c0d0',
          lineHeight: 1.2,
        },
      }, labelFor(tab.key, issueCount))),
    ),
  );
}

export function ConnectionDetailsPanel({
  activePanel,
  issueCount,
  onSelect,
  onClose,
  workflowSection,
  issuesSection,
  advancedSection,
  showAdvanced = true,
}: ConnectionDetailsPanelProps) {
  if (activePanel == null) return null;
  const visibleTabs = availableTabs(showAdvanced);
  const effectivePanel = activePanel === 'advanced' && !showAdvanced ? 'workflow' : activePanel;

  return React.createElement('section', {
    'data-testid': 'connection-details-panel',
    'data-active-panel': effectivePanel,
    style: {
      minHeight: 0,
      flex: 1,
      display: 'flex',
      flexDirection: 'column' as const,
      background: '#0d0d18',
      fontFamily: font,
    },
  },
    React.createElement('div', {
      style: {
        padding: '10px 16px',
        borderBottom: '1px solid #1a1a2e',
        flexShrink: 0,
      },
    },
      React.createElement('div', {
        style: {
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 8,
        },
      },
        React.createElement('button', {
          type: 'button',
          'data-testid': 'connection-details-back',
          onPointerDown: onClose,
          onClick: onClose,
          style: {
            padding: '6px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            fontFamily: font,
            fontSize: 10,
            fontWeight: 700,
            background: '#0a0a14',
            border: '1px solid #252540',
            color: '#c0c0d0',
          },
        }, 'Back'),
        React.createElement('div', {
          style: {
            color: '#e0e0ec',
            fontSize: 13,
            fontWeight: 700,
          },
        }, 'Job details'),
      ),
      React.createElement('div', { style: { display: 'flex', gap: 6 } },
        visibleTabs.map(tab => {
          const active = effectivePanel === tab.key;
          return React.createElement('button', {
            key: tab.key,
            type: 'button',
            'data-testid': `connection-details-tab-${tab.key}`,
            onPointerDown: () => onSelect(tab.key),
            onClick: () => onSelect(tab.key),
            style: {
              flex: 1,
              padding: '7px 6px',
              borderRadius: 6,
              cursor: 'pointer',
              fontFamily: font,
              fontSize: 10,
              fontWeight: 700,
              background: active ? 'rgba(0,212,255,0.1)' : '#0a0a14',
              border: active ? '1px solid #00d4ff' : '1px solid #252540',
              color: active ? '#00d4ff' : '#8888aa',
              lineHeight: 1.2,
            },
          }, labelFor(tab.key, issueCount));
        }),
      ),
    ),
    React.createElement('div', {
      'data-testid': 'connection-details-section',
      style: {
        flex: 1,
        minHeight: 0,
        overflowY: 'auto' as const,
        overflowX: 'hidden' as const,
      },
    }, contentFor(effectivePanel, workflowSection, issuesSection, advancedSection, showAdvanced)),
  );
}
