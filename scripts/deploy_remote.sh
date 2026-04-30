#!/usr/bin/env bash
set -euo pipefail

cd "${DEPLOY_PATH}"

if [[ ! -d ".venv" ]]; then
  python3 -m venv .venv
fi

source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

if [[ -n "${APP_ENV_FILE_CONTENT:-}" ]]; then
  printf "%s\n" "${APP_ENV_FILE_CONTENT}" > .env
fi

touch novel_writer.db

pkill -f "uvicorn main:app" || true
nohup .venv/bin/python -m uvicorn main:app \
  --host "${APP_HOST:-0.0.0.0}" \
  --port "${APP_PORT:-8004}" \
  > deploy.log 2>&1 &

sleep 2
echo "Deploy done. Process status:"
ps -ef | grep "uvicorn main:app" | grep -v grep || true
