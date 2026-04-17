import React from 'react';
import { type PreflightIssue } from '../../../core/preflight/Preflight';

interface IssuesProps {
  issues: PreflightIssue[];
  readinessScore: number | null;
}

const mono = "'JetBrains Mono', monospace";

export function Issues({ issues, readinessScore }: IssuesProps) {
  if (issues.length === 0 && readinessScore == null) return null;

  return React.createElement('div', {
    style: { padding: '10px 16px', borderBottom: '1px solid #1a1a2e', flexShrink: 0 },
  },
    React.createElement('div', { style: { fontSize: 10, color: '#555570', marginBottom: 6, textTransform: 'uppercase' as const, letterSpacing: 1 } }, 'Issues'),
    ...issues.map((issue: PreflightIssue, i: number) =>
      React.createElement('div', {
        key: issue.id ?? i,
        style: {
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '6px 0',
          borderBottom: i < issues.length - 1 ? '1px solid #12121e' : 'none',
        },
      },
        React.createElement('span', {
          style: {
            fontSize: 12, flexShrink: 0, marginTop: 1,
            color: issue.severity === 'blocker'
              ? '#ff4466'
              : issue.severity === 'info'
                ? '#8888aa'
                : '#ffd444',
          },
        }, issue.severity === 'blocker' ? '✗' : issue.severity === 'info' ? 'ℹ' : '⚠'),
        React.createElement('div', null,
          React.createElement('div', {
            style: {
              fontSize: 11,
              color: issue.severity === 'blocker' ? '#ff4466' : issue.severity === 'info' ? '#c0c0d8' : '#ffd444',
            },
          }, issue.title),
          issue.detail && React.createElement('div', {
            style: { fontSize: 9, color: '#555570', marginTop: 2, whiteSpace: 'pre-line' as const, fontFamily: mono },
          }, issue.detail),
          issue.fix && React.createElement('div', { style: { fontSize: 9, color: '#555570', marginTop: 2 } }, issue.fix),
        ),
      ),
    ),
    readinessScore != null && React.createElement('div', {
      style: { display: 'flex', justifyContent: 'flex-end', marginTop: 6 },
    },
      React.createElement('span', {
        style: {
          fontSize: 10, fontWeight: 600, fontFamily: mono,
          padding: '2px 8px', borderRadius: 4,
          background: readinessScore >= 80 ? 'rgba(45,212,160,0.1)' : readinessScore >= 50 ? 'rgba(255,212,68,0.1)' : 'rgba(255,68,102,0.1)',
          color: readinessScore >= 80 ? '#2dd4a0' : readinessScore >= 50 ? '#ffd444' : '#ff4466',
        },
      }, `Readiness: ${readinessScore}%`),
    ),
  );
}
