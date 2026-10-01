import { html } from './html.mjs';

export function remotePrivacy() {
  return html`<h3 id="remote-access">Optional phone and MCP access</h3>
    <p>
      Remote access starts turned off and needs no KerfDesk account. If you turn it on in desktop
      Settings, the app connects to kerfdesk-phone-control.cisgz3a.workers.dev, a separate service
      hosted by Cloudflare. Each phone or MCP client needs a short-lived pairing code and your
      approval on the computer. You choose viewing access or viewing and editing access. The
      computer must stay awake, online and running KerfDesk.
    </p>
    <p>
      Approved requests and responses pass through this service. Responses contain bounded artwork
      and operation summaries, machine limits, edition and update status, and material recipes.
      Editing clients can change supported artwork and ordinary laser operation settings. They
      cannot run a machine, send console commands, start a job or read arbitrary files. Licence and
      payment credentials, serial-port identities, saved file paths and source artwork payloads are
      excluded. An MCP client may also send these summaries to its AI provider under that provider's
      privacy terms. Remote access does not upload or synchronize complete project files.
    </p>
    <p>
      The computer saves its remote identity, opt-in and credentials in a separate file encrypted
      using operating-system secure storage. The service stores a random computer ID, a generic
      computer label, a one-way hash of its owner credential, and approved client identifiers,
      labels, permissions and expiry information. It stores phone-session credentials as one-way
      hashes. Command arguments and workspace responses are processed in memory and are not written
      to the service's databases.
    </p>
    <p>
      The separate phone page uses a Secure, HttpOnly, SameSite=Strict cookie to keep your approved
      connection for eight hours. It does not renew that period merely because you visit it. Pairing
      offers and pending claims expire after five minutes. An MCP access token lasts thirty minutes;
      an approval with refresh access can last up to thirty days. Authorization transactions and
      unexchanged authorization codes expire after ten minutes. OAuth client registrations have a
      ninety-day idle retention period, renewed by successful token use.
    </p>
    <p>
      Expired pairing and approval records are removed when the computer or client next uses the
      relevant service. There is no promised deletion timer for an idle computer. Revoking a
      connection removes its desktop approval immediately and blocks its old tokens; remaining OAuth
      database records expire under the limits above or are removed when a refused refresh triggers
      cleanup. The computer registration and owner-credential hash remain for later reconnection.
      Turning access off closes the connection immediately and saves a pending revocation; if the
      computer is offline, the service receives that revocation when it next connects.
    </p>
    <p>
      Like other web services, Cloudflare receives normal connection details such as your IP address
      and time. Sampled service logs and platform diagnostic metadata may be retained by the hosting
      provider; the service does not deliberately log workspace payloads or credentials. You can use
      the ordinary desktop app without enabling remote access.
    </p>`;
}
