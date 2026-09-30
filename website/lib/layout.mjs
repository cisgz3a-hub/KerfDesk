// The document shell every page renders into: head metadata, header with the
// primary navigation (a scriptless <details> menu on small screens), and footer.

import { commerce } from '../commerce.config.mjs';
import { footerNav, primaryNav, site } from '../site.config.mjs';
import { LAUNCH_NOTE } from './commerce.mjs';
import { html } from './html.mjs';

const EXTERNAL = /^https?:\/\//;

export function isExternal(href) {
  return EXTERNAL.test(href);
}

function documentTitle(page) {
  return page.path === '/' ? `${site.name} — ${site.tagline}` : `${page.title} — ${site.name}`;
}

function socialMeta(page, ctx) {
  const title = documentTitle(page);
  const url = ctx.siteUrl && new URL(page.path, ctx.siteUrl).href;
  const image = ctx.siteUrl && new URL(ctx.asset('social-card.png'), ctx.siteUrl).href;
  return html` <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${site.name}" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${page.description}" />
    ${url && html`<meta property="og:url" content="${url}" />`}
    ${image && html`<meta property="og:image" content="${image}" />`}
    ${image && html`<meta property="og:image:width" content="1200" />`}
    ${image && html`<meta property="og:image:height" content="630" />`}
    <meta name="twitter:card" content="${image ? 'summary_large_image' : 'summary'}" />`;
}

function head(page, ctx) {
  const canonical = ctx.siteUrl && new URL(page.path, ctx.siteUrl).href;
  return html`<head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${documentTitle(page)}</title>
    <meta name="description" content="${page.description}" />
    ${canonical && html`<link rel="canonical" href="${canonical}" />`}
    ${page.noindex && html`<meta name="robots" content="noindex" />`}
    <meta name="color-scheme" content="light dark" />
    <meta name="theme-color" content="#161412" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
    <link rel="stylesheet" href="${ctx.asset('site.css')}" />
    ${socialMeta(page, ctx)}
  </head>`;
}

function navLinks(page) {
  return primaryNav.map(
    (item) =>
      html`<li>
        <a href="${item.href}" ${item.key === page.nav ? html`aria-current="page"` : ''}
          >${item.label}</a
        >
      </li>`,
  );
}

function header(page) {
  return html`<header class="site-header">
    <div class="wrap site-header__inner">
      <a class="brand" href="/">
        <img src="/favicon.svg" alt="" width="28" height="28" />
        <span>Kerf<span class="brand__accent">Desk</span></span>
      </a>
      <nav class="site-nav" aria-label="Main">
        <ul>
          ${navLinks(page)}
        </ul>
      </nav>
      <a class="btn btn--primary btn--sm site-header__cta" href="${site.appUrl}">Open the app</a>
      <details class="menu">
        <summary>Menu</summary>
        <nav aria-label="Main menu">
          <ul>
            ${navLinks(page)}
            <li><a href="/download/">Download</a></li>
            <li><a href="${site.appUrl}">Open the app</a></li>
          </ul>
        </nav>
      </details>
    </div>
  </header>`;
}

function footerLink(link) {
  return html`<li><a href="${link.href}">${link.label}</a></li>`;
}

function footer() {
  return html`<footer class="site-footer">
    <div class="wrap site-footer__grid">
      <div class="site-footer__about">
        <a class="brand brand--footer" href="/">
          <img src="/favicon.svg" alt="" width="24" height="24" />
          <span>Kerf<span class="brand__accent">Desk</span></span>
        </a>
        <p>
          Laser and CNC software for GRBL machines, in a Free and a Pro edition. Made and licensed
          by ${site.owner}, trading as KerfDesk.
        </p>
        <p class="site-footer__safety">
          Stay with your machine while it runs. The in-app Abort is a software stop, not an
          emergency stop. <a href="/safety/">Read the safety notes</a>.
        </p>
      </div>
      ${footerNav.map(
        (group) =>
          html`<nav class="site-footer__col" aria-label="${group.heading}">
            <h2>${group.heading}</h2>
            <ul>
              ${group.links.map(footerLink)}
            </ul>
          </nav>`,
      )}
    </div>
    <div class="wrap site-footer__legal">
      <p>© 2026 ${site.owner}. <a href="${site.licenseUrl}">Licence and notices</a></p>
    </div>
  </footer>`;
}

export function renderDocument(page, body, ctx) {
  const doc = html`<html lang="en">
    ${head(page, ctx)}
    <body>
      <a class="skip-link" href="#main">Skip to content</a>
      ${!commerce.salesOpen && html`<p class="launch-note">${LAUNCH_NOTE}</p>`} ${header(page)}
      <main id="main">${body}</main>
      ${footer()}
    </body>
  </html>`;
  return `<!doctype html>\n${doc}\n`;
}
