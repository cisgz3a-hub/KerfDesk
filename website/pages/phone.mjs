// Remote capabilities and approval boundaries: docs/mcp/remote-control.md.
// The actual pairing form stays a full page on the remote service, preserving
// its host-only session cookie and frame-ancestors policy.
import { button, callout, pageHero, section, steps } from '../lib/components.mjs';
import { html } from '../lib/html.mjs';

export const page = {
  path: '/phone/',
  nav: 'phone',
  title: 'Phone & MCP',
  description:
    'Connect your phone or an MCP client to KerfDesk on your PC. Create a pairing code, approve viewing or editing, and keep machine execution on the computer.',
  render: ({ site }) =>
    html`${pageHero({
      eyebrow: 'Phone & MCP',
      title: 'Your workspace, within reach',
      lead: 'Connect a phone browser or an MCP client to your open KerfDesk desktop app. Every connection needs your approval on the PC.',
      extra: button(site.phoneSetupUrl, 'Open phone setup', { iconName: 'smartphone' }),
    })}
    ${section({
      narrow: true,
      title: 'Start on your PC',
      content: steps([
        {
          title: 'Enable approved remote connections',
          body: html`In KerfDesk, open <strong>Edit → Settings… → Phone &amp; MCP</strong>. Enable
            <strong>Allow approved remote connections</strong> and wait for
            <strong>Connected to the remote service</strong>. Keep the app open and the computer
            awake and online.`,
        },
        {
          title: 'Create a code and enter it on your phone',
          body: html`Click <strong>Create pairing code</strong> on the PC, then open
            <a href="${site.phoneSetupUrl}">phone setup</a> and choose
            <strong>Connect to your PC</strong>. Enter the matching Computer ID, copy the code
            exactly including capital letters, name the phone and request PC approval. A code works
            once and expires after five minutes.`,
        },
        {
          title: 'Choose the permission on the PC',
          body: html`Check the phone’s name and choose <strong>Allow viewing</strong> or
            <strong>Allow viewing and editing</strong>. Manage and revoke connections in the same
            Settings section.`,
        },
      ]),
    })}
    ${section({
      tone: 'alt',
      narrow: true,
      title: 'View the workspace, or make a small edit',
      content: html`<p>
          Viewing connections can read artwork and operation summaries, machine limits, material
          recipes, and edition and update status. Editing connections can select, move, rotate or
          resize supported artwork. In Laser workspaces, they can add basic text or rectangles and
          change operation power, speed, passes and enabled state.
        </p>
        ${callout({
          title: 'Machine execution stays on the PC',
          body: html`<p>
            Phone and MCP connections have no Frame, Start, movement, console, laser or spindle
            controls. The desktop keeps the design canvas. Pairing does not activate Pro or use a
            licence seat, and existing Pro tool rules still apply.
          </p>`,
        })}
        <p>
          <a href="${site.phoneSetupUrl}#mcp">See MCP setup</a> for a client that supports
          authenticated remote MCP servers. ChatGPT custom connections depend on your plan,
          workspace and available client features; this does not establish a public plugin listing.
        </p>
        <p>
          If Phone &amp; MCP is missing,
          <a href="${site.downloadPageUrl}">get the current Windows app</a>. Approved requests and
          workspace summaries pass through KerfDesk’s Cloudflare service. Read the
          <a href="/privacy/#remote-access">privacy notice</a> for details.
        </p>`,
    })}`,
};
