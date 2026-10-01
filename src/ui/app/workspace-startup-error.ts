/** No workspace mounted: expose a deliberate retry instead of a stuck splash. */
export function showWorkspaceStartupError(document: Document, reload: () => void): void {
  const root = document.getElementById('app-root');
  if (root === null) return;
  const alert = document.createElement('section');
  alert.setAttribute('role', 'alert');
  alert.style.cssText = 'max-width:36rem;margin:10vh auto;padding:24px;font-family:system-ui';
  const heading = document.createElement('h1');
  heading.textContent = 'KerfDesk could not finish opening';
  const message = document.createElement('p');
  message.textContent =
    'Check your connection, then reload to try again. The workspace has not opened.';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Reload KerfDesk';
  retry.title = 'Reload the page and try opening KerfDesk again';
  retry.style.cssText = 'font:inherit;min-height:44px;padding:10px 18px;cursor:pointer';
  retry.addEventListener('click', reload);
  alert.append(heading, message, retry);
  root.replaceChildren(alert);
  document.getElementById('app-splash')?.remove();
  retry.focus();
}
