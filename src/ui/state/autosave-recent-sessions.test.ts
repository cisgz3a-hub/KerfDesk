import { IDBFactory as FakeIDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createProject, type Project } from '../../core/scene';
import { AutosaveDurableService } from './autosave-durable';
import { IndexedDbAutosaveRepository } from './autosave-indexeddb';
import { AutosaveSessionLocks } from './autosave-session-lock';

// U1-P2-3 (ADR-686): a beginner who misses the recovery offer and starts new
// work must still be able to reach the first design from the app.
describe('AutosaveDurableService.readRecent', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('keeps the first session reachable after a later session starts new work', async () => {
    const repository = testRepository();
    const first = testService(repository, 'first-session');
    await first.write(project('first design'), 1_000);
    await first.stop();

    // Session 2 ignored the offer and drew something new.
    const second = testService(repository, 'second-session');
    await second.write(project('second design'), 2_000);
    await second.stop();

    // Session 3: startup offers only the newest, but the earlier one is listed.
    const third = testService(repository, 'third-session');
    expect((await third.readLatest()).snapshot?.project.notes).toBe('second design');
    const recent = await third.readRecent();
    expect(recent.map((snapshot) => snapshot.project.notes)).toEqual([
      'second design',
      'first design',
    ]);
    await third.stop();
  });

  it("does not list this window's own autosave, which is the work on screen", async () => {
    const repository = testRepository();
    const earlier = testService(repository, 'earlier-session');
    await earlier.write(project('earlier design'), 1_000);
    await earlier.stop();

    const current = testService(repository, 'current-session');
    await current.write(project('work on screen'), 2_000);
    const recent = await current.readRecent();
    expect(recent.map((snapshot) => snapshot.project.notes)).toEqual(['earlier design']);
    await current.stop();
  });
});

function project(notes: string): Project {
  return { ...createProject(), notes };
}

function testRepository(): IndexedDbAutosaveRepository {
  return new IndexedDbAutosaveRepository({
    factory: new FakeIDBFactory(),
    databaseName: `curvedesk-autosave-test-${crypto.randomUUID()}`,
  });
}

function testService(
  repository: IndexedDbAutosaveRepository,
  sessionId: string,
): AutosaveDurableService {
  return new AutosaveDurableService({
    repository,
    locks: new AutosaveSessionLocks(null),
    initialSessionId: sessionId,
    rotateSessionId: () => `rotated-${crypto.randomUUID()}`,
  });
}
