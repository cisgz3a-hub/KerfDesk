"""
T1-22 — backfill `safetyOff` stub on every inline mock in tests/*.

Run from repo root:  python3 scripts/t1-22-backfill-test-stubs.py

This script is idempotent: re-running it after partial application produces
the same final state. Three operations:

(1) Insert `safetyOff: async () => ({ stage: 'm5' as const })` after the last
    `onRawLine: () => () => {},` in every mock that lacks `safetyOff`.

(2) For mocks whose `sendCommand` throws 'serial fault' or 'Not connected',
    convert the inserted happy-path stub to a `failed`-stage stub matching
    the test's intent (preserves existing assertions on `[LaserOff] blocked:`).

(3) For mocks whose `sendCommand` is `(cmd, _s) => { sent.push(cmd); }`
    (i.e. tracking outbound via a closure-bound `sent` array), convert the
    happy-path stub to one that also pushes `'M5 S0'` to `sent`, mirroring
    the real GrblController.safetyOff path through `port.writeCritical`.

Files touched are limited to `tests/*` and only those with `} as LaserController;`.
"""
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TESTS_DIR = os.path.join(REPO_ROOT, 'tests')

INSERT_PATTERN = re.compile(
    r"^( +)(onRawLine: \(\) => \(\) => \{\},)([^\n]*\n)",
    re.MULTILINE,
)

HAPPY_STUB = "safetyOff: async () => ({ stage: 'm5' as const }),"
HAPPY_PUSH_REPL = (
    "safetyOff: async () => {\n"
    "        sent.push('M5 S0');\n"
    "        return { stage: 'm5' as const };\n"
    "      },"
)

PAT_SERIAL = re.compile(
    r"(sendCommand: \(\) => \{\s*throw new Error\('serial fault'\);\s*\},.*?onRawLine: \(\) => \(\) => \{\},\s*)safetyOff: async \(\) => \(\{ stage: 'm5' as const \}\),",
    re.DOTALL,
)
PAT_NC = re.compile(
    r"(sendCommand: \(\) => \{\s*throw new Error\('Not connected'\);\s*\},.*?onRawLine: \(\) => \(\) => \{\},\s*)safetyOff: async \(\) => \(\{ stage: 'm5' as const \}\),",
    re.DOTALL,
)


def list_test_files() -> list[str]:
    out = []
    for name in os.listdir(TESTS_DIR):
        if not (name.endswith('.test.ts') or name.endswith('.test.tsx')):
            continue
        out.append(os.path.join(TESTS_DIR, name))
    return sorted(out)


def insert_stub(src: str) -> tuple[str, int]:
    """Step 1: insert happy-path stub into every mock missing one."""
    parts = src.split("} as LaserController;")
    rebuilt = []
    inserted = 0
    for part in parts:
        if 'safetyOff' in part:
            rebuilt.append(part)
            continue
        ms = list(INSERT_PATTERN.finditer(part))
        if not ms:
            rebuilt.append(part)
            continue
        m = ms[-1]
        indent = m.group(1)
        end_pos = m.end()
        insertion = f"{indent}{HAPPY_STUB}\n"
        rebuilt.append(part[:end_pos] + insertion + part[end_pos:])
        inserted += 1
    return "} as LaserController;".join(rebuilt), inserted


def convert_throw_to_failed(src: str) -> tuple[str, int]:
    """Step 2: throwing-sendCommand mocks → safetyOff returns failed."""
    n = 0
    new = PAT_SERIAL.sub(
        r"\1safetyOff: async () => ({ stage: 'failed' as const, error: new Error('serial fault') }),",
        src,
    )
    if new != src:
        n += new.count("Error('serial fault')") // 2 - src.count("Error('serial fault')") // 2
        src = new
    new = PAT_NC.sub(
        r"\1safetyOff: async () => ({ stage: 'failed' as const, error: new Error('Not connected') }),",
        src,
    )
    if new != src:
        n += 1
        src = new
    return src, n


def convert_to_push_m5(src: str) -> tuple[str, int]:
    """Step 3: mocks whose sendCommand pushes to closure `sent` should also push M5."""
    parts = src.split("} as LaserController;")
    rebuilt = []
    n = 0
    for part in parts:
        if HAPPY_STUB in part and 'sent.push(cmd)' in part:
            new_part = part.replace(HAPPY_STUB, HAPPY_PUSH_REPL, 1)
            if new_part != part:
                n += 1
            rebuilt.append(new_part)
        else:
            rebuilt.append(part)
    return "} as LaserController;".join(rebuilt), n


def main() -> int:
    files = list_test_files()
    total_inserted = 0
    total_failed = 0
    total_pushed = 0
    for path in files:
        with open(path, 'r', encoding='utf-8') as f:
            src = f.read()
        orig = src

        src, n_ins = insert_stub(src)
        src, n_fail = convert_throw_to_failed(src)
        src, n_push = convert_to_push_m5(src)

        if src != orig:
            with open(path, 'w', encoding='utf-8') as f:
                f.write(src)
            rel = os.path.relpath(path, REPO_ROOT)
            print(f"  {rel}: inserted={n_ins} failed-stubs={n_fail} push-m5={n_push}")
            total_inserted += n_ins
            total_failed += n_fail
            total_pushed += n_push

    print(f"\nTotal: {total_inserted} stubs inserted, "
          f"{total_failed} converted to 'failed', {total_pushed} updated to push M5")
    return 0


if __name__ == '__main__':
    sys.exit(main())
