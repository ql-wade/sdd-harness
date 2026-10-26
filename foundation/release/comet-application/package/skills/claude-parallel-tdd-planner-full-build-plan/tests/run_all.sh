#!/bin/sh
set -eu
skill_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
python3 -m unittest discover -s "$skill_root/tests" -p 'test_*.py' -v
python3 - "$skill_root" <<'PY'
from pathlib import Path
import re,sys
root=Path(sys.argv[1]); entry=root/'SKILL.md'
assert entry.stat().st_size<17500 and len(entry.read_text().splitlines())<500
for p in (root/'references').glob('*.md'):
    for link in re.findall(r'\]\(([^)#]+)(?:#[^)]*)?\)',p.read_text()):
        if '://' not in link: assert (p.parent/link).exists(), (p,link)
print('Budget and relative reference links: PASS')
PY
