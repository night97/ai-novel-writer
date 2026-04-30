#!/usr/bin/env bash
set -euo pipefail

cd "${DEPLOY_PATH}"

mkdir -p .deploy_backups
ts="$(date +%Y%m%d-%H%M%S)"
if [[ -f "novel_writer.db" ]]; then
  cp -f "novel_writer.db" ".deploy_backups/novel_writer.db.${ts}.bak"
fi
if [[ -f ".env" ]]; then
  cp -f ".env" ".deploy_backups/.env.${ts}.bak"
fi

PYTHON_BIN="python3"
PIP_CMD="python3 -m pip"

if [[ ! -d ".venv" ]]; then
  if python3 -m venv .venv; then
    echo "venv created."
  else
    echo "WARN: python3 -m venv failed, fallback to system python."
  fi
fi

if [[ -f ".venv/bin/activate" ]]; then
  source .venv/bin/activate
  PYTHON_BIN="python"
  PIP_CMD="pip"
fi

$PYTHON_BIN -m pip install --upgrade pip
$PIP_CMD install -r requirements.txt

if [[ -n "${APP_ENV_FILE_CONTENT:-}" ]]; then
  if [[ ! -f ".env" ]]; then
    printf "%s\n" "${APP_ENV_FILE_CONTENT}" > .env
  fi
fi

touch novel_writer.db

pkill -f "uvicorn main:app" || true
nohup $PYTHON_BIN -m uvicorn main:app \
  --host "${APP_HOST:-0.0.0.0}" \
  --port "${APP_PORT:-8004}" \
  > deploy.log 2>&1 &

sleep 2
echo "Deploy done. Process status:"
ps -ef | grep "uvicorn main:app" | grep -v grep || true
