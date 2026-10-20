#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
exec python3 -B -m unittest discover -s tests -p 'test_*.py' -v
