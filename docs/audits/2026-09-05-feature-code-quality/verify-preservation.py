"""Read-only audit integrity check; writes only its report next to this script."""
from pathlib import Path
import hashlib
import json
import subprocess
import tarfile
from datetime import datetime, timezone

report_dir = Path(__file__).resolve().parent
workspace = report_dir.parents[2]
baseline = json.loads((report_dir / 'baseline.json').read_text(encoding='utf-8-sig'))
snapshot = Path(baseline['sourceSnapshot'])

def sha(data):
    return hashlib.sha256(data).hexdigest().upper()

inherited_changes = []
for item in baseline['inheritedFileHashes']:
    target = workspace / item['path']
    actual = sha(target.read_bytes()) if target.is_file() else None
    if actual != item['sha256']:
        inherited_changes.append({'path': item['path'], 'actual': actual})

archive_changes = []
archive_files = 0
with tarfile.open(snapshot / 'source.tar') as archive:
    for member in archive:
        if not member.isfile():
            continue
        archive_files += 1
        target = snapshot / member.name
        archived = archive.extractfile(member).read()
        actual = target.read_bytes() if target.is_file() else None
        if actual is None or sha(actual) != sha(archived):
            archive_changes.append(member.name)

def git(*args):
    return subprocess.check_output(['git', '-C', str(workspace), *args], text=True).strip()

result = {
    'checkedUtc': datetime.now(timezone.utc).isoformat(),
    'inheritedFilesChecked': len(baseline['inheritedFileHashes']),
    'inheritedFilesChanged': inherited_changes,
    'archiveFilesChecked': archive_files,
    'archivedSourceFilesChanged': archive_changes,
    'workingHead': git('rev-parse', 'HEAD'),
    'workingBranch': git('branch', '--show-current'),
    'currentRemoteMain': git('ls-remote', 'origin', 'refs/heads/main').split()[0],
    'workingStatus': git('status', '--short'),
    'note': 'New audit-only fixtures and node_modules in the extracted snapshot are not original archive members. Only report files were added to the working checkout.',
}
(report_dir / 'preservation-result.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({k:v for k,v in result.items() if k != 'workingStatus'}, indent=2))
if inherited_changes or archive_changes:
    raise SystemExit(1)
