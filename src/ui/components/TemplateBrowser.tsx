import React, { useState } from 'react';
import { TEMPLATE_CATEGORIES, getTemplatesByCategory, searchTemplates, type Template } from '../../templates/TemplateLibrary';

interface TemplateBrowserProps {
  onSelect: (template: Template) => void;
  onClose: () => void;
}

export function TemplateBrowser({ onSelect, onClose }: TemplateBrowserProps) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const font = "'DM Sans', system-ui, sans-serif";

  const templates = search
    ? searchTemplates(search)
    : getTemplatesByCategory(category);

  return React.createElement('div', {
    style: {
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)',
      backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center',
      justifyContent: 'center', zIndex: 2000, fontFamily: font,
    },
    onClick: (e: React.MouseEvent) => { if (e.target === e.currentTarget) onClose(); },
  },
    React.createElement('div', {
      style: {
        background: '#12121e', border: '1px solid #252540', borderRadius: 14,
        width: 800, maxHeight: '85vh', display: 'flex', flexDirection: 'column' as const,
        boxShadow: '0 20px 60px rgba(0,0,0,0.6)', overflow: 'hidden',
      },
    },
      // Header
      React.createElement('div', {
        style: { padding: '16px 20px', borderBottom: '1px solid #1a1a2e', display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
      },
        React.createElement('div', null,
          React.createElement('span', { style: { color: '#e0e0ec', fontSize: 16, fontWeight: 700 } }, 'Template Library'),
          React.createElement('span', { style: { color: '#555570', fontSize: 11, marginLeft: 10 } }, `${templates.length} designs`),
        ),
        React.createElement('button', {
          onClick: onClose,
          style: { background: 'none', border: 'none', color: '#555570', fontSize: 20, cursor: 'pointer' },
        }, '×'),
      ),

      // Search
      React.createElement('div', { style: { padding: '10px 20px' } },
        React.createElement('input', {
          type: 'text', value: search, placeholder: 'Search templates...',
          onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value),
          style: {
            width: '100%', padding: '8px 14px',
            background: '#0a0a14', border: '1px solid #252540', borderRadius: 8,
            color: '#e0e0ec', fontSize: 13, fontFamily: font, outline: 'none',
          },
        }),
      ),

      // Categories
      React.createElement('div', {
        style: { display: 'flex', gap: 6, padding: '0 20px 12px', flexWrap: 'wrap' as const },
      },
        ...TEMPLATE_CATEGORIES.map(cat =>
          React.createElement('button', {
            key: cat.id,
            onClick: () => { setCategory(cat.id); setSearch(''); },
            style: {
              padding: '5px 12px', whiteSpace: 'nowrap' as const,
              background: category === cat.id && !search ? 'rgba(0,212,255,0.1)' : 'transparent',
              border: category === cat.id && !search ? '1px solid #00d4ff' : '1px solid #252540',
              borderRadius: 6, fontSize: 11, cursor: 'pointer', fontFamily: font,
              color: category === cat.id && !search ? '#00d4ff' : '#8888aa',
              transition: 'all 0.15s ease',
            },
          }, `${cat.icon} ${cat.name}`),
        ),
      ),

      // Template grid
      React.createElement('div', {
        style: {
          flex: 1, overflow: 'auto', padding: '0 20px 20px',
          display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12,
          alignContent: 'start',
        },
      },
        templates.length === 0
          ? React.createElement('div', {
              style: { gridColumn: '1 / -1', textAlign: 'center' as const, padding: 40, color: '#555570', fontSize: 13 },
            }, 'No templates found')
          : templates.map(t =>
              React.createElement('div', {
                key: t.id,
                onClick: () => onSelect(t),
                onMouseEnter: () => setHoveredId(t.id),
                onMouseLeave: () => setHoveredId(null),
                style: {
                  background: hoveredId === t.id ? '#1a1a2e' : '#0f0f1a',
                  border: hoveredId === t.id ? '1px solid #00d4ff' : '1px solid #1a1a2e',
                  borderRadius: 10, cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  transform: hoveredId === t.id ? 'translateY(-2px)' : 'none',
                  overflow: 'hidden',
                },
              },
                // SVG Preview
                React.createElement('div', {
                  style: {
                    height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#08080f', padding: 12, borderRadius: '10px 10px 0 0',
                  },
                  dangerouslySetInnerHTML: {
                    __html: t.svg.replace(/stroke="red"/g, 'stroke="#ff4466"')
                      .replace(/stroke="blue"/g, 'stroke="#4488ff"')
                      .replace(/stroke="green"/g, 'stroke="#44cc66"')
                      .replace(/fill="blue"/g, 'fill="#4488ff"')
                      .replace(/<svg /, '<svg style="max-width:100%;max-height:66px;width:auto;height:auto;" '),
                  },
                }),
                // Info
                React.createElement('div', { style: { padding: '12px 14px 14px' } },
                  React.createElement('div', { style: { color: '#e0e0ec', fontSize: 12, fontWeight: 500, marginBottom: 3 } }, t.name),
                  React.createElement('div', { style: { color: '#555570', fontSize: 10, lineHeight: 1.4 } }, t.description),
                  React.createElement('div', { style: { marginTop: 6, display: 'flex', gap: 4 } },
                    React.createElement('span', {
                      style: { fontSize: 9, color: '#444460', background: '#0a0a14', padding: '2px 6px', borderRadius: 3 },
                    }, `${t.svgWidth}×${t.svgHeight}mm`),
                    ...t.tags.slice(0, 2).map(tag =>
                      React.createElement('span', {
                        key: tag,
                        style: { fontSize: 9, color: '#444460', background: '#0a0a14', padding: '2px 6px', borderRadius: 3 },
                      }, tag),
                    ),
                  ),
                ),
              ),
            ),
      ),
    ),
  );
}
