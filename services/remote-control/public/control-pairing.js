/** Read a QR/link fragment once, before the application renders or makes a request. */
(() => {
  const fragment = location.hash;
  if (!fragment || fragment === '#mcp') return;
  try {
    history.replaceState(null, '', location.pathname + location.search);
  } catch {
    document.documentElement.dataset.pairingBlocked = 'true';
    return;
  }
  const params = new URLSearchParams(fragment.slice(1));
  const entries = [...params.entries()];
  let device = params.get('device'),
    code = params.get('code');
  const uuid =
    /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i;
  if (
    entries.length !== 2 ||
    params.getAll('device').length !== 1 ||
    params.getAll('code').length !== 1 ||
    !uuid.test(device || '') ||
    !/^[A-Za-z0-9-]{12,24}$/.test(code || '')
  )
    return;
  document.addEventListener(
    'DOMContentLoaded',
    () => {
      const form = document.getElementById('pair-form');
      if (form) {
        form.elements.deviceId.value = device;
        form.elements.code.value = code;
        document.getElementById('pair-status').textContent =
          'Your code is filled in. Choose access, request approval, then approve this phone on the PC.';
      }
      device = code = null;
    },
    { once: true },
  );
})();
