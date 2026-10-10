#!/usr/bin/env bash
# Try the v2 app on this machine against a LOCAL Supabase stack (Docker).
#
#   git checkout v2 && ./scripts/v2-lokalt.sh            # keeps local data between runs
#   ./scripts/v2-lokalt.sh --nollstall                   # wipes the local DB first
#
# What it does: starts local Supabase, applies all migrations (first run), sets
# the local Vault secrets the cron tick needs, serves the analys-steg Edge
# Function locally, and runs `npm run dev` (http://localhost:8080) pointed at
# the local stack. Uploads, jobs and results live only in Docker; the only
# external calls are to Claude (real cost, ~3–6 SEK per analysis).
#
# SAFETY: .env.local holds PRODUCTION credentials. Every PROJECT_* / spend
# variable is exported here with LOCAL values (exported variables win over
# .env.local), and the script refuses to start if PROJECT_URL is not local.
# Only ANTHROPIC_API_KEY is read from .env.local; it is written to a private
# temp file for the local Edge Function and deleted on exit.
#
# Stop with Ctrl-C. The Supabase containers keep running so the next start is
# fast; stop them with `npx supabase@2.117.0 stop`.

set -euo pipefail
cd "$(dirname "$0")/.."

NODE22="$HOME/.nvm/versions/node/v22.23.2/bin"
[ -d "$NODE22" ] && export PATH="$NODE22:$PATH"
SB=(npx --yes supabase@2.117.0)

if [ "$(git branch --show-current)" != "v2" ]; then
  echo "Kör skriptet från grenen v2:  git checkout v2" >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker körs inte. Starta Docker Desktop först." >&2
  exit 1
fi
if [ ! -f .env.local ] || ! grep -q '^ANTHROPIC_API_KEY=' .env.local; then
  echo "Hittar ingen ANTHROPIC_API_KEY i .env.local." >&2
  exit 1
fi

echo "▸ Startar lokal Supabase…"
"${SB[@]}" start >/dev/null

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep -E '^supabase_db_' | head -1)"
psql_lokal() { docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -tA "$@"; }

if [ "${1:-}" = "--nollstall" ] || [ -z "$(psql_lokal -c "select to_regclass('public.rapport')")" ]; then
  echo "▸ Applicerar alla migrationer på den lokala databasen…"
  "${SB[@]}" db reset --local >/dev/null
fi

# Local URLs and keys (never the production ones).
eval "$("${SB[@]}" status -o env 2>/dev/null | grep -E '^(API_URL|SECRET_KEY|PUBLISHABLE_KEY)=')"

TMP="$(mktemp -d)"
chmod 700 "$TMP"
SERVE_PID=""
cleanup() {
  [ -n "$SERVE_PID" ] && kill "$SERVE_PID" 2>/dev/null || true
  rm -rf "$TMP"
  echo
  echo "Stoppat. Lokala Supabase-containrar körs fortfarande (stoppa: npx supabase@2.117.0 stop)."
}
trap cleanup EXIT INT TERM

ANTHROPIC_KEY="$(grep -E '^ANTHROPIC_API_KEY=' .env.local | head -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//")"
AUTOMATIONS_KEY="$(openssl rand -hex 24)"

echo "▸ Sätter lokala Vault-hemligheter för cron-ticken…"
psql_lokal >/dev/null <<SQL
delete from vault.secrets where name in ('project_url', 'automations_key');
select vault.create_secret('http://kong:8000', 'project_url');
select vault.create_secret('${AUTOMATIONS_KEY}', 'automations_key');
SQL

# Edge Function env (inside Docker the API gateway is http://kong:8000).
umask 077
cat >"$TMP/fn.env" <<ENV
PROJECT_URL=http://kong:8000
PROJECT_SECRET_KEY=${SECRET_KEY}
AUTOMATIONS_KEY=${AUTOMATIONS_KEY}
ANTHROPIC_API_KEY=${ANTHROPIC_KEY}
MAX_DAILY_SPEND_SEK=50
MAX_COST_PER_ANALYSIS_SEK=10
ANALYSIS_KILL_SWITCH=off
ENV

echo "▸ Bygger och startar Edge Function analys-steg lokalt…"
npm run -s build:edge >/dev/null
"${SB[@]}" functions serve analys-steg --env-file "$TMP/fn.env" >"$TMP/funktion.log" 2>&1 &
SERVE_PID=$!

# Web app env: everything that could otherwise come from .env.local's
# production values is exported with local values.
export PROJECT_URL="$API_URL"
export PROJECT_SECRET_KEY="$SECRET_KEY"
export PROJECT_PUBLISHABLE_KEY="$PUBLISHABLE_KEY"
export ANTHROPIC_API_KEY="$ANTHROPIC_KEY"
export ANTHROPIC_MODEL="claude-sonnet-5-5"
export MAX_DAILY_SPEND_SEK=50
export MAX_COST_PER_ANALYSIS_SEK=10
export ANALYSIS_KILL_SWITCH=off

node -e '
  const h = new URL(process.env.PROJECT_URL).hostname;
  if (!["127.0.0.1", "localhost"].includes(h)) {
    console.error("AVBRYTER: PROJECT_URL pekar inte på den lokala stacken (" + h + ").");
    process.exit(2);
  }'

STUDIO_URL="$("${SB[@]}" status -o env 2>/dev/null | grep -E '^STUDIO_URL=' | cut -d= -f2- | tr -d '"')"
cat <<INFO

  Binfo v2 lokalt:   http://localhost:8080
  Lokal databas:     ${STUDIO_URL}   (Supabase Studio — se tabellerna rapport, analys, sidtext …)
  Funktionslogg:     ${TMP}/funktion.log
  Dagstak:           50 kr (lokal spend_day). Varje analys kostar riktiga Claude-pengar.

INFO

npm run dev
