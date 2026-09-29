// A packaged build that sells licences refuses Chromium's remote-debugging
// switches (ADR-544). With one of them, Chrome DevTools attaches to the renderer
// of a signed, fused build and can switch Pro on without changing a file; no
// Electron fuse covers them. Preview and free builds keep them, because the
// installed-app checks drive packaged Preview builds that way.

const REFUSED_SWITCHES = ['remote-debugging-port', 'remote-debugging-pipe'] as const;

// Chromium also reads "-switch" and, on Windows, "/switch", in any letter case.
const REMOTE_DEBUGGING_ARGUMENT = /^(?:--?|\/)remote-debugging/i;

export function refusedDebugSwitch(options: {
  readonly packaged: boolean;
  /** Anything but a plain free build, so malformed licensing metadata counts. */
  readonly sellsLicences: boolean;
  readonly argv: ReadonlyArray<string>;
  readonly hasSwitch: (name: string) => boolean;
}): string | null {
  if (!options.packaged || !options.sellsLicences) return null;
  const named = REFUSED_SWITCHES.find((name) => options.hasSwitch(name));
  if (named !== undefined) return `--${named}`;
  const argument = options.argv.find((value) => REMOTE_DEBUGGING_ARGUMENT.test(value));
  return argument === undefined ? null : (argument.split('=')[0] ?? argument);
}
