/* global document */
const element = (id) => document.getElementById(id);
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const countryNames = new Intl.DisplayNames(undefined, { type: 'region', fallback: 'code' });
let latest = null;
let cooldownTimer;

function cooldown(state) {
  clearTimeout(cooldownTimer);
  const remaining = Math.max(0, (state.retryAt ?? 0) - Date.now());
  element('refresh').disabled = !state.configured || state.busy || remaining > 0;
  element('connect-form').querySelector('button').disabled = state.busy || remaining > 0;
  element('retry').textContent =
    remaining > 0
      ? `Cloudflare asked us to wait. Refresh is available after ${new Date(state.retryAt).toLocaleTimeString()}.`
      : '';
  if (remaining > 0)
    cooldownTimer = setTimeout(() => cooldown(state), Math.min(remaining + 50, 86_400_000));
}

function message(text, error = false) {
  element('message').textContent = text;
  element('message').className = error ? 'error' : '';
}

function cell(value, numeric = false) {
  const node = document.createElement('td');
  node.textContent = numeric ? number.format(value) : value;
  if (numeric) node.className = 'number';
  return node;
}

function drawChart(days) {
  const maximum = Math.max(1, ...days.map((day) => day.full));
  element('chart').replaceChildren(
    ...days.map((day) => {
      const column = document.createElement('div');
      column.className = 'chart-column';
      const label = document.createElement('span');
      label.className = 'chart-count';
      label.textContent = number.format(day.full);
      const meter = document.createElement('meter');
      meter.className = 'chart-meter';
      meter.min = 0;
      meter.max = maximum;
      meter.value = day.full;
      meter.setAttribute(
        'aria-label',
        `${day.date}: ${number.format(day.full)} full-response requests`,
      );
      const date = document.createElement('span');
      date.className = 'chart-date';
      date.textContent = day.date.slice(5);
      column.append(label, meter, date);
      return column;
    }),
  );
}

function drawCountries(report) {
  const countries = report.countries ?? [{ country: 'unknown', ...report.totals }];
  const rows = countries.map(({ country, full, partial }) => {
    const row = document.createElement('tr');
    const name = /^[A-Z]{2}$/u.test(country) ? countryNames.of(country) : 'Unknown';
    row.append(cell(name), cell(full, true), cell(partial, true));
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr');
    const empty = cell('No matching installer requests were observed in this period.');
    empty.colSpan = 3;
    row.append(empty);
    rows.push(row);
  }
  element('countries').replaceChildren(...rows);
}

function render(state) {
  element('setup').hidden = state.configured;
  element('disconnect').hidden = !state.configured;
  cooldown(state);
  element('export').disabled = !state.report;
  const history = state.history;
  element('recorded').textContent = history.observedDays ? number.format(history.full) : '—';
  element('recorded-detail').textContent = history.observedDays
    ? `${history.observedDays} observed UTC days · May contain gaps`
    : 'History begins with your first refresh';
  if (!state.report) return;
  latest = state.report;
  element('period').value = String(latest.coverage.requestedDays);
  element('full').textContent = number.format(latest.totals.full);
  element('partial').textContent = number.format(latest.totals.partial);
  element('export').disabled = false;
  drawChart(latest.days);
  drawCountries(latest);
  const rows = latest.releases.map((release) => {
    const row = document.createElement('tr');
    row.append(
      cell(release.version),
      cell(release.platform),
      cell(release.channel),
      cell(release.full, true),
      cell(release.partial, true),
    );
    return row;
  });
  if (!rows.length) {
    const row = document.createElement('tr');
    const empty = cell('No matching installer requests were observed in this period.');
    empty.colSpan = 5;
    row.append(empty);
    rows.push(row);
  }
  element('releases').replaceChildren(...rows);
  element('coverage').textContent =
    `${latest.from.replace('T', ' ')} to ${latest.to.replace('T', ' ')} · ${latest.coverage.clipped ? 'Clipped to available retention. ' : ''}Current day is provisional. Counts are estimates.`;
  element('updated').textContent =
    `Last successful refresh: ${latest.generatedAt.replace('T', ' ')}`;
}

async function action(path, body) {
  const buttons = [...document.querySelectorAll('button')];
  buttons.forEach((button) => {
    button.disabled = true;
  });
  message('Loading available Cloudflare traffic records…');
  try {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const state = await response.json();
    if (!response.ok) throw new Error(state.error);
    render(state);
    message(
      path === '/api/disconnect'
        ? 'Disconnected. Saved aggregate observations remain on this computer.'
        : 'Figures refreshed. Repeated refreshes replace observations; they do not add duplicate counts.',
    );
  } catch (error) {
    message(`${error.message} Previous figures, if shown, are unchanged.`, true);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
    try {
      render(await (await fetch('/api/status')).json());
    } catch {
      /* Keep the last visible figures. */
    }
    element('token').value = '';
  }
}

element('connect-form').addEventListener('submit', (event) => {
  event.preventDefault();
  void action('/api/connect', {
    token: element('token').value.trim(),
    zoneId: element('zone').value.trim(),
    days: Number(element('period').value),
  });
});
element('refresh').addEventListener('click', () => {
  void action('/api/refresh', { days: Number(element('period').value) });
});
element('period').addEventListener('change', () => {
  message(
    latest
      ? 'Choose Refresh to load this period. The figures still show the last successful report.'
      : 'Connect Cloudflare to load the selected period.',
  );
});
element('disconnect').addEventListener('click', () => {
  void action('/api/disconnect', {});
});
element('export').addEventListener('click', () => {
  if (!latest) return;
  const lines = [
    'date_utc,version,platform,channel,country,full_response_requests_estimated,partial_requests_estimated',
  ];
  for (const row of latest.rows)
    lines.push(
      [
        row.date,
        row.version,
        row.platform,
        row.channel,
        row.country ?? 'unknown',
        row.full,
        row.partial,
      ].join(','),
    );
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  link.download = `kerfdesk-download-requests-${latest.generatedAt.slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
});

try {
  const state = await (await fetch('/api/status')).json();
  render(state);
  if (state.report) message('Showing the last successful report. Choose Refresh to update it.');
} catch {
  message('The local dashboard is unavailable. Restart it and reload this page.', true);
}
