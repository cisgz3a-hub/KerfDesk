// What Help > Save Support Report never copies (ADR-546 item 2, Amendment 2).
//
// grblHAL prints its password settings in plain text in `$$` unless its WebUI
// is connected (core settings.c, Format_Password): $75 Wi-Fi station, $77
// access point, $330 admin, $331 user and $533 MQTT broker (core settings.h).
// FluidNC names them `$Sta/Password` and `$AP/Password`, also set with
// `[ESP101]` and `[ESP106]` (WebUI/WifiConfig.cpp). They reach the report
// through the `$$` rows, the console lines and incident raw text (audit
// 27-P2-3). Sign-ins written into an address (a camera's
// rtsp://user:pass@host) and key=value secrets go the same way.

// A value the first pass removed stays as it is on the second, so the text
// after an escaped line break in an incident cell survives.
const NOT_REMOVED = String.raw`(?!\[(?:password )?removed\])`;
const SECRET_KEY = String.raw`[\w-]*(?:password|passwd|pwd|token|secret|api[_-]?key)`;

const REDACTIONS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bKD\d+\.[\w-]+\.[\w-]+/g, 'KD1.[licence key removed]'],
  // Up to the authority's last @, so a password holding an unencoded @ goes too.
  [/\b([a-z][a-z\d+.-]*:\/\/)[^\s/?#]+@/gi, '$1[sign-in removed]@'],
  [/\b(Bearer\s+)[\w.~+/=-]+/gi, '$1[token removed]'],
  // A setting's whole value goes, spaces included, to the end of its line.
  [
    new RegExp(String.raw`(\$(?:75|77|330|331|533)\s*=)${NOT_REMOVED}[^\r\n]*`, 'g'),
    '$1[password removed]',
  ],
  [
    new RegExp(String.raw`(\$[\w/]*password\s*=)${NOT_REMOVED}[^\r\n]*`, 'gi'),
    '$1[password removed]',
  ],
  [new RegExp(String.raw`(\[ESP10[16]\])${NOT_REMOVED}[^\r\n]*`, 'g'), '$1[password removed]'],
  [new RegExp(String.raw`\b(${SECRET_KEY})=${NOT_REMOVED}[^\s&;,"']+`, 'gi'), '$1=[removed]'],
  [new RegExp(String.raw`("${SECRET_KEY}"\s*:\s*")[^"]*"`, 'gi'), '$1[removed]"'],
];

/** Applied before cell escaping and again to the complete local support report. */
export function redactSupportReportText(text: string): string {
  return REDACTIONS.reduce(
    (current, [pattern, replacement]) => current.replace(pattern, replacement),
    text,
  );
}
