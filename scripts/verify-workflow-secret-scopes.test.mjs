import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { JSON_SCHEMA, load } from 'js-yaml';

import {
  SECRET_ENVIRONMENTS,
  verifyWorkflowSecretDirectory,
  verifyWorkflowSecretText,
} from './verify-workflow-secret-scopes.mjs';

async function readWorkflow(path) {
  return load(await readFile(path, 'utf8'), { schema: JSON_SCHEMA });
}

function workflow(job, extra = '') {
  return ['on: push', extra, 'jobs:', '  job:', '    runs-on: ubuntu-latest', job]
    .filter((line) => line !== '')
    .join('\n');
}

test('every checked-in workflow reads each secret only in its environment', () => {
  assert.deepEqual(verifyWorkflowSecretDirectory(process.cwd()), []);
});

test('only the production deploy job reads the Pages credentials (audit 11-P2-1)', async () => {
  const deploy = await readWorkflow('.github/workflows/deploy.yml');
  assert.equal(deploy.jobs.deploy.environment, 'production');
  assert.equal(SECRET_ENVIRONMENTS.get('PAGES_CLOUDFLARE_API_TOKEN'), 'production');
  assert.equal(SECRET_ENVIRONMENTS.get('PAGES_CLOUDFLARE_ACCOUNT_ID'), 'production');
  // Production is main only: a dispatch must start from main, and a CI-run
  // deploy must come from a push, which runs on the default branch.
  assert.match(deploy.jobs.deploy.if, /workflow_dispatch' && github\.ref == 'refs\/heads\/main'/u);
  assert.match(deploy.jobs.deploy.if, /workflow_run\.event == 'push'/u);
  assert.deepEqual(deploy.on.workflow_run.branches, ['main']);
});

test('the Preview publication reads its credentials in its own environment (audit 11-P3-2)', async () => {
  const preview = await readWorkflow('.github/workflows/release-desktop-preview.yml');
  assert.equal(preview.jobs['publish-preview'].environment, 'desktop-preview');
  assert.deepEqual(preview.on, { push: { tags: ['v*-preview.*'] } });
  const qualification = await readWorkflow('.github/workflows/qualify-desktop-upgrade.yml');
  for (const job of Object.values(qualification.jobs)) {
    assert.equal(job.environment, 'desktop-commercial');
    assert.match(job.if, /github\.ref == 'refs\/heads\/main'/u);
    assert.doesNotMatch(job.if, /refs\/heads\/(?!main')/u);
  }
});

test('a secret read without its environment fails', () => {
  const step =
    '    steps:\n      - run: deploy\n        env:\n          TOKEN: ${{ secrets.PAGES_CLOUDFLARE_API_TOKEN }}';
  const [missing] = verifyWorkflowSecretText('none.yml', workflow(step));
  assert.match(
    missing ?? '',
    /none\.yml jobs\.job\.steps\[0\]\.env\.TOKEN: .*no environment \(needs production\)/u,
  );
  const [wrong] = verifyWorkflowSecretText(
    'wrong.yml',
    workflow(`    environment: desktop-commercial\n${step}`),
  );
  assert.match(wrong ?? '', /in environment desktop-commercial; it belongs to production/u);
  assert.deepEqual(
    verifyWorkflowSecretText(
      'named.yml',
      workflow(
        `    environment:\n      name: production\n      url: https://kerfdesk.com\n${step}`,
      ),
    ),
    [],
  );
});

test('unreviewed, whole-context and indexed secret reads fail', () => {
  const failures = verifyWorkflowSecretText(
    'context.yml',
    workflow(
      [
        '    environment: production',
        '    steps:',
        '      - run: echo "${{ secrets.SOMETHING_NEW }}"',
        '      - run: echo "${{ toJSON(secrets) }}"',
        '      - run: echo "${{ secrets[\'PAGES_CLOUDFLARE_API_TOKEN\'] }}"',
        "      - if: secrets.COMMERCIAL_R2_API_TOKEN != ''",
        '        run: echo bare if conditions are expressions too',
      ].join('\n'),
    ),
  );
  assert.equal(failures.length, 4);
  assert.match(failures[0] ?? '', /secrets\.SOMETHING_NEW is not a reviewed secret/u);
  assert.match(failures[1] ?? '', /steps\[1\]\.run: reads the secrets context/u);
  assert.match(failures[2] ?? '', /steps\[2\]\.run: reads the secrets context/u);
  assert.match(failures[3] ?? '', /steps\[3\]\.if: .*it belongs to desktop-commercial/u);
});

test('secrets outside a job, passed to a reusable workflow or under a computed environment fail', () => {
  const outside = verifyWorkflowSecretText(
    'outside.yml',
    workflow(
      '    steps:\n      - run: echo',
      'env:\n  TOKEN: ${{ secrets.COMMERCIAL_R2_API_TOKEN }}',
    ),
  );
  assert.deepEqual(outside, ['outside.yml env.TOKEN: reads secrets outside a job']);
  const [inherited] = verifyWorkflowSecretText(
    'reusable.yml',
    'on: push\njobs:\n  call:\n    uses: ./.github/workflows/other.yml\n    secrets: inherit',
  );
  assert.match(inherited ?? '', /passes secrets to a reusable workflow/u);
  const [computed] = verifyWorkflowSecretText(
    'computed.yml',
    workflow(
      '    environment: ${{ github.ref_name }}\n    steps:\n      - run: echo "${{ secrets.COMMERCIAL_R2_API_TOKEN }}"',
    ),
  );
  assert.match(computed ?? '', /its environment must be a literal name/u);
});

test('the run token and look-alike names are not secrets', () => {
  assert.deepEqual(
    verifyWorkflowSecretText(
      'token.yml',
      workflow(
        [
          '    steps:',
          '      - env:',
          '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
          '          OTHER: ${{ github.token }}',
          '          INPUT: ${{ inputs.secrets_note }}',
          '          VALUE: ${{ env.my-secrets }}',
          '        run: echo "repository secrets.txt is prose, not an expression"',
        ].join('\n'),
      ),
    ),
    [],
  );
});

test('a doubled brace inside an expression string does not hide a later secret', () => {
  const failures = verifyWorkflowSecretText(
    'format.yml',
    workflow(
      [
        '    steps:',
        '      - run: echo "${{ format(\'{{{0}}}\', secrets.SOMETHING_NEW) }}"',
        "      - run: echo \"${{ format('it''s }} here', secrets.PAGES_CLOUDFLARE_API_TOKEN) }}\"",
        '      - run: echo "${{ contains(github.ref, \'secrets.NOT_A_READ\') }}"',
      ].join('\n'),
    ),
  );
  assert.equal(failures.length, 2);
  assert.match(failures[0] ?? '', /steps\[0\]\.run: secrets\.SOMETHING_NEW is not a reviewed/u);
  assert.match(failures[1] ?? '', /steps\[1\]\.run: .*no environment \(needs production\)/u);
});

test('secret names are matched without regard to case, as GitHub matches them', () => {
  const step = (environment) =>
    workflow(
      `${environment}    steps:\n      - env:\n          A: \${{ Secrets.pages_cloudflare_api_token }}\n          B: \${{ secrets.github_token }}\n        run: echo`,
    );
  assert.deepEqual(
    verifyWorkflowSecretText('cased.yml', step('    environment: production\n')),
    [],
  );
  const [missing] = verifyWorkflowSecretText('cased.yml', step(''));
  assert.match(missing ?? '', /secrets\.PAGES_CLOUDFLARE_API_TOKEN in a job with no environment/u);
});
