import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

// ADR-710: while main is red, no pull request may merge. A required commit
// status, `main-is-green`, on every open pull request's head says whether
// main's latest completed CI and Browser smoke runs passed. A status set once at
// a pull request's own push would go stale, so every completion of either
// workflow on main, and every pull request event, re-syncs every open pull
// request. Each run reads the whole state again, so a newer run that replaces
// a pending one loses nothing.

export const CONTEXT = 'main-is-green';
export const FIX_LABEL = 'fixes-main';
// The workflows whose latest completed main run decides the status, by file.
// Their `name:` values ("CI", "Browser smoke") are what main-is-green.yml's
// workflow_run trigger lists; main-is-green-workflow.test.mjs pins both.
export const WATCHED_WORKFLOWS = [
  { file: 'ci.yml', name: 'CI' },
  { file: 'e2e.yml', name: 'Browser smoke' },
];
// Runs on main that say something about main itself. A pull_request or
// merge_group run tests another combination.
const MAIN_EVENTS = new Set(['push', 'workflow_dispatch']);
// Conclusions that carry no verdict: a superseded pending run is cancelled,
// and a skipped or stale run never ran its checks. Look further back.
const NO_VERDICT = new Set(['cancelled', 'skipped', 'stale']);
// GitHub allows about 80 content-creating requests a minute. Space the
// status writes so a red main with many open pull requests stays under it.
const WRITE_SPACING_MS = 800;
const DESCRIPTION_LIMIT = 140;

/** The newest completed main run that has a verdict, or null. Runs come newest first. */
export function pickVerdictRun(runs) {
  return (
    runs.find(
      (run) =>
        run.head_branch === 'main' &&
        run.status === 'completed' &&
        MAIN_EVENTS.has(run.event) &&
        !NO_VERDICT.has(run.conclusion),
    ) ?? null
  );
}

/**
 * main's verdict from each watched workflow's verdict run (null when none was
 * found). Green only when every one succeeded; a missing run is not green.
 */
export function mainVerdict(picked, { serverUrl, repository }) {
  const missing = picked.filter(({ run }) => run === null).map(({ workflow }) => workflow.name);
  const red = picked.filter(({ run }) => run !== null && run.conclusion !== 'success');
  if (red.length > 0) {
    const names = red.map(({ workflow }) => workflow.name).join(' and ');
    const first = red[0].run;
    return {
      green: false,
      state: 'failure',
      description: `main is red: ${names} failed on ${first.head_sha.slice(0, 7)}. Merge the fix first (label ${FIX_LABEL}).`,
      targetUrl: first.html_url,
    };
  }
  if (missing.length > 0) {
    return {
      green: false,
      state: 'error',
      description: `No completed ${missing.join(' or ')} run on main to judge it by.`,
      targetUrl: `${serverUrl}/${repository}/actions`,
    };
  }
  return {
    green: true,
    state: 'success',
    description: 'main is green: its latest CI and Browser smoke runs passed.',
    targetUrl: `${serverUrl}/${repository}/actions`,
  };
}

/** The status one pull request should carry, given main's verdict. */
export function desiredStatus(verdict, pullRequest) {
  if (!verdict.green && pullRequest.labels.includes(FIX_LABEL)) {
    return {
      state: 'success',
      description: `main is red, but this pull request is labelled ${FIX_LABEL}.`,
      targetUrl: verdict.targetUrl,
    };
  }
  return { state: verdict.state, description: verdict.description, targetUrl: verdict.targetUrl };
}

/** Whether the head's current status (from GraphQL, or null) differs from the desired one. */
export function needsWrite(current, desired) {
  return (
    current === null ||
    current.state.toLowerCase() !== desired.state ||
    current.description !== desired.description.slice(0, DESCRIPTION_LIMIT) ||
    current.targetUrl !== desired.targetUrl
  );
}

const OPEN_PULL_REQUESTS = `
query($owner: String!, $name: String!, $after: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: OPEN, baseRefName: "main", first: 50, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number
        headRefOid
        labels(first: 50) { nodes { name } }
        commits(last: 1) {
          nodes { commit { oid status { context(name: "${CONTEXT}") { state description targetUrl } } } }
        }
      }
    }
  }
}`;

/** Every open pull request into main: number, head SHA, label names and current status. */
export async function openPullRequests(client, repository) {
  const [owner, name] = repository.split('/');
  const pullRequests = [];
  let after = null;
  for (;;) {
    const data = await client.graphql(OPEN_PULL_REQUESTS, { owner, name, after });
    const page = data.repository.pullRequests;
    for (const node of page.nodes) {
      const head = node.commits.nodes[0]?.commit;
      pullRequests.push({
        number: node.number,
        sha: node.headRefOid,
        labels: node.labels.nodes.map((label) => label.name),
        current: head?.oid === node.headRefOid ? (head.status?.context ?? null) : null,
      });
    }
    if (!page.pageInfo.hasNextPage) return pullRequests;
    after = page.pageInfo.endCursor;
  }
}

/** Reads main's verdict and writes `main-is-green` wherever it would change. */
export async function syncMainIsGreen({
  client,
  repository,
  serverUrl,
  log = console.log,
  wait = delay,
}) {
  const picked = [];
  for (const workflow of WATCHED_WORKFLOWS) {
    const { workflow_runs: runs } = await client.rest(
      `/repos/${repository}/actions/workflows/${workflow.file}/runs?branch=main&status=completed&exclude_pull_requests=true&per_page=30`,
    );
    const run = pickVerdictRun(runs);
    log(
      `${workflow.name}: ${run === null ? 'no verdict run' : `${run.conclusion} ${run.html_url}`}`,
    );
    picked.push({ workflow, run });
  }
  const verdict = mainVerdict(picked, { serverUrl, repository });
  log(`main-is-green: ${verdict.state} - ${verdict.description}`);

  const written = [];
  for (const pullRequest of await openPullRequests(client, repository)) {
    const desired = desiredStatus(verdict, pullRequest);
    if (!needsWrite(pullRequest.current, desired)) continue;
    if (written.length > 0) await wait(WRITE_SPACING_MS);
    await client.rest(`/repos/${repository}/statuses/${pullRequest.sha}`, {
      method: 'POST',
      body: {
        state: desired.state,
        context: CONTEXT,
        description: desired.description.slice(0, DESCRIPTION_LIMIT),
        target_url: desired.targetUrl,
      },
    });
    log(`#${pullRequest.number} ${pullRequest.sha.slice(0, 7)}: ${desired.state}`);
    written.push(pullRequest.number);
  }
  log(`Wrote ${written.length} status(es).`);
  return { verdict, written };
}

/** A minimal GitHub API client over fetch, authenticated with the run's GITHUB_TOKEN. */
export function githubClient({ token, apiUrl, fetchImpl = fetch }) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
  async function request(path, { method = 'GET', body } = {}) {
    const response = await fetchImpl(`${apiUrl}${path}`, {
      method,
      headers: body === undefined ? headers : { ...headers, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${method} ${path}: HTTP ${response.status} ${text}`);
    return text === '' ? null : JSON.parse(text);
  }
  return {
    rest: request,
    async graphql(query, variables) {
      const result = await request('/graphql', { method: 'POST', body: { query, variables } });
      if (result.errors?.length) throw new Error(`GraphQL: ${JSON.stringify(result.errors)}`);
      return result.data;
    },
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_API_URL, GITHUB_SERVER_URL } = process.env;
  if (!GITHUB_TOKEN || !GITHUB_REPOSITORY) {
    console.error('GITHUB_TOKEN and GITHUB_REPOSITORY are required.');
    process.exit(2);
  }
  await syncMainIsGreen({
    client: githubClient({
      token: GITHUB_TOKEN,
      apiUrl: GITHUB_API_URL ?? 'https://api.github.com',
    }),
    repository: GITHUB_REPOSITORY,
    serverUrl: GITHUB_SERVER_URL ?? 'https://github.com',
  });
}
