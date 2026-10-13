import { execFileSync } from 'node:child_process';
import process from 'node:process';
const baseline = execFileSync(
  'git',
  ['show', 'c700863a14dfbed71a49e32182ec3b75b989ebb1:src/core/job/segment-entry-index.ts'],
  {
    cwd: process.cwd(),
    encoding: 'utf8',
  },
);
export default {
  root: process.cwd(),
  plugins: [
    {
      name: 'coincident-baseline-source',
      enforce: 'pre',
      load(id) {
        if (id.replaceAll('\\', '/').endsWith('/src/core/job/segment-entry-index.ts'))
          return baseline;
      },
    },
  ],
  test: { environment: 'node', include: ['src/core/job/segment-entry-index-coincident.test.ts'] },
};
