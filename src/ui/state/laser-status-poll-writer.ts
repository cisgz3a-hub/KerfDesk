type StatusPollWrite = (line: string) => Promise<void>;

/** Keeps the background status query at one unresolved transport write per poll loop. */
export function createLaserStatusPollWriter(write: StatusPollWrite): StatusPollWrite {
  let pending: Promise<void> | null = null;
  return async (line) => {
    if (pending !== null) return;
    pending = write(line).catch(() => undefined);
    await pending;
    pending = null;
  };
}
