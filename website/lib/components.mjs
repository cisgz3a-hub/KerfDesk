// Reusable page blocks. Pages compose these; styling lives in assets/site.css.

import { html } from './html.mjs';
import { icon } from './icons.mjs';

// Honest evidence labels. Every feature or machine claim that could be read as
// "proven on my machine" carries one of these (see website/README.md).
export const STATUS = {
  // No machine is qualified (ADR-322): the strongest evidence is informal use.
  'hardware-verified': { label: 'Used on a real machine', tone: 'verified' },
  'shipped-code-and-tests': { label: 'Built, not yet machine-tested', tone: 'built' },
  'simulator-only': { label: 'Simulator-tested only', tone: 'sim' },
  'in-progress': { label: 'In progress', tone: 'progress' },
  planned: { label: 'Planned', tone: 'planned' },
};

export function statusPill(status) {
  const entry = STATUS[status];
  if (!entry) throw new Error(`Unknown status: ${status}`);
  return html`<span class="pill pill--${entry.tone}">${entry.label}</span>`;
}

export function button(href, label, { variant = 'primary', size, iconName } = {}) {
  const classes = ['btn', `btn--${variant}`, size && `btn--${size}`].filter(Boolean).join(' ');
  return html`<a class="${classes}" href="${href}">${iconName && icon(iconName)}${label}</a>`;
}

export function actions(...buttons) {
  return html`<div class="actions">${buttons}</div>`;
}

// Title block at the top of every inner page.
export function pageHero({ eyebrow, title, lead, extra }) {
  return html`<section class="page-hero">
    <div class="wrap">
      ${eyebrow && html`<p class="eyebrow">${eyebrow}</p>`}
      <h1>${title}</h1>
      ${lead && html`<p class="lead">${lead}</p>`} ${extra}
    </div>
  </section>`;
}

export function section({ id, tone, eyebrow, title, lead, content, narrow }) {
  const classes = ['section', tone && `section--${tone}`].filter(Boolean).join(' ');
  return html`<section class="${classes}" ${id && html`id="${id}"`}>
    <div class="${narrow ? 'wrap wrap--narrow' : 'wrap'}">
      ${(eyebrow || title || lead) &&
      html`<div class="section__head">
        ${eyebrow && html`<p class="eyebrow">${eyebrow}</p>`} ${title && html`<h2>${title}</h2>`}
        ${lead && html`<p class="lead">${lead}</p>`}
      </div>`}
      ${content}
    </div>
  </section>`;
}

// items: { icon, title, body, status?, href? }
export function featureGrid(items, { columns = 3 } = {}) {
  return html`<ul class="cards cards--${columns}">
    ${items.map(
      (item) =>
        html`<li class="card">
          ${item.icon && html`<span class="card__icon">${icon(item.icon)}</span>`}
          <h3>${item.href ? html`<a href="${item.href}">${item.title}</a>` : item.title}</h3>
          <p>${item.body}</p>
          ${item.status && statusPill(item.status)}
        </li>`,
    )}
  </ul>`;
}

// A two-column row pairing prose with a visual. `media` is any fragment.
export function split({ title, body, points, media, reverse }) {
  return html`<div class="split ${reverse ? 'split--reverse' : ''}">
    <div class="split__text">
      <h3>${title}</h3>
      ${body && html`<p>${body}</p>`}
      ${points &&
      html`<ul class="ticks">
        ${points.map((point) => html`<li>${icon('check')}<span>${point}</span></li>`)}
      </ul>`}
    </div>
    <div class="split__media">${media}</div>
  </div>`;
}

export function callout({ tone = 'info', title, body, iconName }) {
  const glyph = iconName ?? (tone === 'safety' ? 'triangle-alert' : 'info');
  return html`<aside class="callout callout--${tone}">
    <span class="callout__icon">${icon(glyph)}</span>
    <div>
      ${title && html`<p class="callout__title">${title}</p>`}
      <div class="callout__body">${body}</div>
    </div>
  </aside>`;
}

// items: { title, body }
export function steps(items) {
  return html`<ol class="steps">
    ${items.map(
      (item) =>
        html`<li class="step">
          <h3>${item.title}</h3>
          <p>${item.body}</p>
        </li>`,
    )}
  </ol>`;
}

// items: { question, answer } — answer may be a string or an html fragment.
export function faqList(items) {
  return html`<div class="faq">
    ${items.map(
      (item) =>
        html`<details class="faq__item" ${item.id && html`id="${item.id}"`}>
          <summary>${item.question}</summary>
          <div class="faq__answer">
            ${typeof item.answer === 'string' ? html`<p>${item.answer}</p>` : item.answer}
          </div>
        </details>`,
    )}
  </div>`;
}

export function ctaBand({ title, body, buttons }) {
  return html`<section class="cta-band">
    <div class="wrap cta-band__inner">
      <div>
        <h2>${title}</h2>
        ${body && html`<p>${body}</p>`}
      </div>
      ${actions(...buttons)}
    </div>
  </section>`;
}

// A real product screenshot in a light window frame.
export function screenshot({ src, alt, width, height, caption, eager }) {
  return html`<figure class="shot">
    <div class="shot__frame">
      <span class="shot__dots" aria-hidden="true"><i></i><i></i><i></i></span>
      <img
        src="${src}"
        alt="${alt}"
        width="${width}"
        height="${height}"
        ${eager ? html`fetchpriority="high"` : html`loading="lazy"`}
        decoding="async"
      />
    </div>
    ${caption && html`<figcaption>${caption}</figcaption>`}
  </figure>`;
}

// head: [cell], rows: [[cell]]; each row's first cell is its header. Wrapped so
// wide tables scroll inside their own box instead of widening the page on phones.
export function table({ caption, head, rows }) {
  return html`<div class="table-wrap" role="region" aria-label="${caption}" tabindex="0">
    <table>
      <caption>
        ${caption}
      </caption>
      <thead>
        <tr>
          ${head.map((cell) => html`<th scope="col">${cell}</th>`)}
        </tr>
      </thead>
      <tbody>
        ${rows.map(
          (row) =>
            html`<tr>
              ${row.map((cell, index) =>
                index === 0 ? html`<th scope="row">${cell}</th>` : html`<td>${cell}</td>`,
              )}
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}
