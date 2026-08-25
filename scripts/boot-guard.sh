#!/usr/bin/env bash
# boot-guard.sh - guarded boot for DeepSeek Harness (macOS/Linux).
#
# Snapshots every profile, starts the DSH server, health-checks it, and on
# failure kills the server, rolls back to the last good snapshot and retries
# once. On first-attempt failure it also writes an incident report + marker.
#
# Wire it into your launcher (or run it directly):
#   DSH_HOME="$HOME/.dsh" HARNESS_ROOT=/path/to/harness ./boot-guard.sh
#
# Launch order: if $DSH_HOME/guard/launch.json exists (written by the plugin on
# every confirmed-good boot) it is consumed to start the server; otherwise a
# `dsh` on PATH is used; otherwise the boot fails cleanly with a clear message.
#
# Requires: node (guard CLI + launch manifest), curl (health probe).
set -u

FIRST_WAIT_SEC="${FIRST_WAIT_SEC:-60}"
RETRY_WAIT_SEC="${RETRY_WAIT_SEC:-30}"
PORT="${PORT:-3080}"
PROFILE="${PROFILE:-web}"
HARNESS_ROOT="${HARNESS_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"

# Resolve DSH_HOME: honor an explicitly set $DSH_HOME (expanding a leading `~`
# to $HOME), otherwise default to $HOME/.dsh. Never derive it from this
# script's own location.
if [ -n "${DSH_HOME:-}" ]; then
  case "$DSH_HOME" in
    '~') DSH_HOME="$HOME" ;;
    '~/'*) DSH_HOME="$HOME/${DSH_HOME#~/}" ;;
  esac
else
  DSH_HOME="$HOME/.dsh"
fi
export DSH_HOME

# Launch manifest written by the plugin on every confirmed-good boot. When
# present it tells us exactly how to start the server (modern installs launch
# DSH via `node --import tsx/esm <checkout>/apps/cli/src/bin.ts web` — there is
# no `dsh` on PATH), so we never have to guess.
LAUNCH_JSON="$DSH_HOME/guard/launch.json"

# Guard CLI lives inside the profile's node_modules. If it is missing we log a
# single line and skip guard actions rather than crash the boot.
CLI="$DSH_HOME/profiles/$PROFILE/node_modules/dsh-fuhuobi/scripts/guard-cli.js"
GUARD_MISSING_LOGGED=0

LOG_DIR="$DSH_HOME/guard/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
BOOT_LOG="$LOG_DIR/boot-$STAMP.log"
SERVER_OUT="$LOG_DIR/server-$STAMP.out.log"
SERVER_ERR="$LOG_DIR/server-$STAMP.err.log"
STATUS_FILE="$LOG_DIR/last-boot.txt"

log() { echo "[$(date +%H:%M:%S)] $*" >> "$BOOT_LOG"; }
set_status() { echo "$(date '+%F %T') $1 $2 (log: $STAMP)" > "$STATUS_FILE"; }
healthy() { curl -fsS --max-time 3 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; }

guard() {
  if [ ! -f "$CLI" ]; then
    if [ "$GUARD_MISSING_LOGGED" -eq 0 ]; then
      log "guard-cli missing at $CLI - skipping guard actions"
      GUARD_MISSING_LOGGED=1
    fi
    return 0
  fi
  node "$CLI" "$@" 2>&1 | while IFS= read -r line; do [ -n "$line" ] && log "  [guard] $line"; done
}

wait_healthy() {
  local deadline=$((SECONDS + $1))
  while [ $SECONDS -lt $deadline ]; do
    healthy && return 0
    sleep 0.5
  done
  return 1
}

# Reads $LAUNCH_JSON and, via a single `node -e`, either prints a fully-quoted
# shell command line (viaShell: true -> run through `sh -c`) or spawns the
# child detached with stdio redirected to the guard's log files and prints the
# child pid. Node is guaranteed present (DSH itself runs on node), so no jq.
# File/args/cwd paths are passed in via env vars to avoid argv-index ambiguity.
NODE_LAUNCH_CODE="$(cat <<'DSH_NODE_EOF'
const fs = require('fs');
let m;
try { m = JSON.parse(fs.readFileSync(process.env.DSH_LAUNCH_JSON, 'utf8')); }
catch (e) { console.error('manifest parse failed: ' + e.message); process.exit(2); }
const file = m.file, args = (m.args || []), cwd = (m.cwd || process.cwd());
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";
if (m.viaShell) {
  let parts = [q(file)].concat(args.map(q));
  let cmd = parts.join(' ');
  if (cwd) cmd = 'cd ' + q(cwd) + ' && ' + cmd;
  process.stdout.write(cmd + '\n');
  process.exit(0);
}
const cp = require('child_process');
const so = fs.openSync(process.env.DSH_SERVER_OUT, 'a');
const se = fs.openSync(process.env.DSH_SERVER_ERR, 'a');
const child = cp.spawn(file, args, { cwd: cwd, detached: true, stdio: ['ignore', so, se] });
if (!child.pid) { console.error('spawn failed for ' + file); process.exit(2); }
child.unref();
process.stdout.write(String(child.pid) + '\n');
process.exit(0);
DSH_NODE_EOF
)"

start_server() {
  local pid=""
  if [ -f "$LAUNCH_JSON" ]; then
    local out
    out="$(DSH_LAUNCH_JSON="$LAUNCH_JSON" DSH_SERVER_OUT="$SERVER_OUT" DSH_SERVER_ERR="$SERVER_ERR" node -e "$NODE_LAUNCH_CODE")" || return 1
    case "$out" in
      '')
        log "launch manifest produced no launch command"
        return 1
        ;;
      *[!0-9]*)
        # viaShell: $out is the full quoted command line for sh -c
        setsid sh -c "$out" >"$SERVER_OUT" 2>"$SERVER_ERR" < /dev/null &
        pid=$!
        ;;
      *)
        # non-viaShell: node spawned the child detached and printed its pid
        pid=$out
        ;;
    esac
  elif command -v dsh >/dev/null 2>&1; then
    setsid dsh web >"$SERVER_OUT" 2>"$SERVER_ERR" < /dev/null &
    pid=$!
  else
    log "no launch manifest and no dsh on PATH - boot DSH once from the CLI so $DSH_HOME/guard/launch.json gets written"
    return 1
  fi
  echo "$pid"
}

stop_server() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -- "-$pid" 2>/dev/null || kill "$pid" 2>/dev/null || true
  sleep 1
  kill -9 -- "-$pid" 2>/dev/null || kill -9 "$pid" 2>/dev/null || true
}

fail_boot() {
  guard incident --kind boot-failure
  echo ""
  echo "=================================================="
  echo " [DSH Revival Coin] Boot failed!"
  echo " Double-click DSHReviveCoinX1.cmd on the desktop or in the DSH root,"
  echo " or run: dsh-fuhuobi revive-coin"
  echo "=================================================="
  echo ""
}

log "=== boot guard start ==="
if healthy; then
  log "already healthy"
  set_status OK already-running
  exit 0
fi

PID=""
if ! PID=$(start_server) || [ -z "$PID" ]; then
  # Nothing was launched (no manifest + no dsh, or the manifest launcher
  # failed). Go straight to the failure path: no server, no rollback, no
  # half-started state, no crash.
  log "boot cannot proceed: server launch failed"
  set_status FAILED launch-failed
  fail_boot
  exit 1
fi
log "started server (pgid $PID)"
if wait_healthy "$FIRST_WAIT_SEC"; then
  log "boot ok on first attempt"
  set_status OK first-attempt
  # Two-phase health check passed: auto-mint a revival coin (3-level rotation).
  guard revive-coin --mark
  # Stay attached so launchers that kill the process group on window close
  # keep their close-to-quit semantics.
  wait
  log "server exited; boot guard done"
  exit 0
fi
log "server unhealthy after ${FIRST_WAIT_SEC}s; stopping and rolling back"
stop_server "$PID"

guard rollback --good

PID2=$(start_server)
log "restarted server (pgid $PID2)"
if wait_healthy "$RETRY_WAIT_SEC"; then
  set_status OK rolled-back-retry
  guard revive-coin --mark
  wait
  log "server exited; boot guard done"
  exit 0
fi
stop_server "$PID2"
set_status FAILED boot-failed
fail_boot

if healthy; then
  wait
  log "server exited; boot guard done"
  exit 0
fi
exit 1
