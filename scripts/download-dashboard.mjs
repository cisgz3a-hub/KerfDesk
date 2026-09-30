import { homedir } from 'node:os';
import { join } from 'node:path';
import { createDownloadDashboard } from './download-stats/server.mjs';

const historyPath = join(
  process.env.LOCALAPPDATA || join(homedir(), '.local', 'share'),
  'KerfDesk',
  'download-stats',
  'history.json',
);
const server = await createDownloadDashboard({
  historyPath,
  token: process.env.CLOUDFLARE_ANALYTICS_API_TOKEN,
  zoneId: process.env.CLOUDFLARE_ANALYTICS_ZONE_ID,
});
server.on('error', () => {
  console.error('The download dashboard could not start. Close another copy and try again.');
  process.exitCode = 1;
});
server.listen(4318, '127.0.0.1', () => {
  console.log('KerfDesk download dashboard: http://127.0.0.1:4318');
  console.log(
    'Private to this computer. The Cloudflare token stays in memory until this process closes.',
  );
  console.log(`Aggregate history: ${historyPath}`);
});
