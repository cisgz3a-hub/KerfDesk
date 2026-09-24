// File > Open asks the picker. Recent Projects and the operating system
// (ADR-378) arrive with the file already chosen, and skip it.

import type { OpenProjectFile } from './project-open-parser';

export async function chosenOrPickedProjectFiles(
  chosenFile: OpenProjectFile | undefined,
  pick: () => Promise<ReadonlyArray<OpenProjectFile>>,
): Promise<ReadonlyArray<OpenProjectFile>> {
  return chosenFile === undefined ? pick() : [chosenFile];
}
