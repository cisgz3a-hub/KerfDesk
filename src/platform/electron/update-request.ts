/** Only update-status/check/download admission is bounded here; install consent
 * retains its existing verified native handoff. A timeout does not cancel a
 * transfer that main has already accepted. Its current status must be read. */
export async function boundedUpdateRequest<T>(
  request: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer!: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('The desktop update service did not answer in time.');
      controller.abort(error);
      reject(error);
    }, 15_000);
  });
  try {
    return await Promise.race([request(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
