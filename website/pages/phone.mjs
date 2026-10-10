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
    'Connect your phone or an MCP client to KerfDesk on your PC. Create a pairing code and separately approve viewing, artwork editing and machine controls.',
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
            <strong>Ready to pair</strong> (older versions say
            <strong>Connected to the remote service</strong>). Keep the app open and the computer
            awake and online.`,
        },
        {
          title: 'Scan the code or open a pairing link',
          body: html`Click <strong>Create pairing link</strong> on the PC (older versions say
            <strong>Create pairing code</strong>). Open phone controls and choose
            <strong>Scan PC QR code</strong>, allow camera access and point at the PC’s QR code. You
            can also scan with the phone’s camera or use <strong>Copy pairing link</strong>. The
            link fills in the computer ID and code; name the phone and request PC approval. For
            older versions or manual setup, open <a href="${site.phoneSetupUrl}">phone setup</a>,
            enter the matching Computer ID and copy the code exactly including capital letters. A
            code works once and expires after five minutes.`,
        },
        {
          title: 'Choose the permission on the PC',
          body: html`Check the phone’s name. Viewing is the default. Select the requested artwork
            editing and/or machine-control choices, then <strong>Approve selected access</strong>.
            Both choices start off. Manage and revoke connections in the same Settings section.`,
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
          change operation power, speed, passes and enabled state. Updated versions add touch
          drawing for rectangles, ellipses and freehand strokes, plus selection, moving and
          resizing. Review the draft and choose Apply or Cancel.
        </p>
        <p>
          Updated versions separate Design, Machine and Settings. Changes made on the PC refresh the
          connected phone view automatically, while unsent phone edits stay intact. Shared previews
          and text need the separate sharing choice on the PC.
        </p>
        ${callout({
          title: 'Choose machine control separately',
          body: html`<p>
            Explicitly approved machine-control connections can Jog, Frame, review the current job,
            Start and Abort through the desktop's ordinary machine flow. The desktop keeps the
            design canvas. These controls require a desktop release and service that support them;
            existing viewing/editing approvals gain no motion access. Pairing does not activate Pro
            or use a licence seat, and existing Pro tool rules still apply.
          </p>`,
        })}
        ${callout({
          tone: 'safety',
          title: 'Remote control is not supervision',
          body: html`<p>
            Use machine control only while you are at the machine and can see it. Watching through a
            phone or camera is not supervision: a laser fire can grow out of control in minutes, and
            the phone’s Abort is a software stop, not an emergency stop.
            <a href="/safety/">Read the safety notes</a>.
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
