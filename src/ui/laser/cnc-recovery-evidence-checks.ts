// Builds the evidence rows the CNC recovery preview shows the operator before
// a re-entry is allowed. Split out of cnc-recovery-preview-model.ts, which had
// reached the hard file-size cap; that file keeps the decision logic (what is
// available, what refuses) and this one owns how each finding is described.
//
// Every row states what is PROVEN and what is not: recovery evidence is
// deliberately pessimistic, so 'diagnostic' and 'missing' are the common
// statuses and 'matched' is reserved for a real byte- or identity-level match.

export type CncRecoveryEvidenceCheck = {
  readonly id: string;
  readonly label: string;
  readonly status: 'matched' | 'diagnostic' | 'missing' | 'mismatch';
  readonly detail: string;
};

/** The acknowledged/total line counts every recovery record carries. */
export type RecoveryProgressCounts = {
  readonly ackedLines: number;
  readonly sendableLines: number;
};

export function exactEvidenceChecks(
  progress: RecoveryProgressCounts,
  identityMatches: boolean,
  preparedProgramMatches: boolean,
  manifestPresent: boolean,
  manifestMatches: boolean,
): ReadonlyArray<CncRecoveryEvidenceCheck> {
  const manifestStatus = !manifestPresent
    ? 'missing'
    : preparedProgramMatches && manifestMatches
      ? 'matched'
      : 'mismatch';
  const manifestDescription = !manifestPresent
    ? 'The exact capsule has no CNC recovery manifest.'
    : !preparedProgramMatches
      ? 'The archived prepared job does not reproduce the sealed exact G-code.'
      : manifestMatches
        ? 'The emitter-owned semantic job and recovery manifest are sealed together in the capsule.'
        : 'The archived manifest does not match the archived prepared semantic job.';
  return [
    evidence(
      'program-identity',
      'Saved execution artifact identity',
      identityMatches ? 'matched' : 'mismatch',
      identityMatches
        ? 'The exact emitted G-code and immutable run identity are retained in the capsule.'
        : 'The capsule run identity, progress total, or archived G-code fingerprint is inconsistent.',
    ),
    acknowledgementCheck(progress),
    evidence(
      'semantic-line-map',
      'Archived prepared job and recovery manifest',
      manifestStatus,
      manifestDescription,
    ),
    executionFenceCheck,
    evidence(
      'machine-state',
      'Archived controller observations',
      'diagnostic',
      'Retained settings, position, tool, and Work Z observations are diagnostics only; the live controller must be requalified.',
    ),
    runwayQualificationCheck,
  ];
}

export function legacyEvidenceChecks(
  progress: RecoveryProgressCounts,
): ReadonlyArray<CncRecoveryEvidenceCheck> {
  return [
    acknowledgementCheck(progress),
    evidence(
      'semantic-line-map',
      'Archived prepared job and recovery manifest',
      'missing',
      'This legacy fingerprint-only record predates the sealed semantic artifact.',
    ),
    executionFenceCheck,
    evidence(
      'machine-state',
      'Position, spindle, tool, and workholding',
      'missing',
      'No retained-session physical execution proof is attached.',
    ),
    runwayQualificationCheck,
  ];
}

export function legacyProgramIdentityCheck(matches: boolean): CncRecoveryEvidenceCheck {
  return evidence(
    'program-identity',
    'Legacy interrupted program identity',
    matches ? 'matched' : 'mismatch',
    matches
      ? 'The current project recompiles to the legacy G-code fingerprint.'
      : 'The current project produces different G-code from the legacy record.',
  );
}

// Rule 7 / ADR-228: the preview's warnings surface. A recovery review never
// opens Job Review, so a preflight finding demoted from a refusal has to be
// named here or the operator loses the signal entirely.
export function preflightAdvisoryChecks(
  messages: ReadonlyArray<string>,
): ReadonlyArray<CncRecoveryEvidenceCheck> {
  if (messages.length === 0) return [];
  return [
    evidence(
      'preflight-advisories',
      'Recompiled program preflight findings',
      'diagnostic',
      messages.join(' '),
    ),
  ];
}

function acknowledgementCheck(progress: RecoveryProgressCounts): CncRecoveryEvidenceCheck {
  return evidence(
    'acknowledgements',
    'Controller acknowledgements',
    'diagnostic',
    `${progress.ackedLines} of ${progress.sendableLines} lines were acknowledged; this does not prove physical execution.`,
  );
}

const executionFenceCheck = evidence(
  'execution-fence',
  'Controller execution fence',
  'missing',
  'No controller-owned proof identifies the last physically completed contour segment.',
);

const runwayQualificationCheck = evidence(
  'machine-profile',
  'Hardware-qualified runway profile',
  'missing',
  'The displayed acceleration and margin are illustrative, not machine qualification.',
);

function evidence(
  id: string,
  label: string,
  status: CncRecoveryEvidenceCheck['status'],
  detail: string,
): CncRecoveryEvidenceCheck {
  return { id, label, status, detail };
}
