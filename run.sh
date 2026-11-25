#!/usr/bin/env sh
# LIFEOS - start on macOS / Linux. First run sets everything up.
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || python3 -m venv .venv
.venv/bin/python -m pip install --disable-pip-version-check -q -r requirements.txt
mkdir -p data
echo "LIFEOS running on http://127.0.0.1:8000  (Ctrl+C to stop)"
exec .venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port "${PORT:-8000}"
