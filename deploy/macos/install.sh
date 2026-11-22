#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false
JOB_FILTER=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --job)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --job requires a value (e.g. --job web)" >&2
        exit 1
      fi
      JOB_FILTER="$2"
      shift 2
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run] [--job <name>]"
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

NODE_BIN="${NODE_BIN:-$(command -v node || true)}"
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  echo "ERROR: cannot find executable node binary (set NODE_BIN or ensure node is in PATH)" >&2
  exit 1
fi
NODE_DIR="$(dirname "$NODE_BIN")"

RAW_DATA_DIR="${PERSONAL_TOOLS_DATA_DIR:-$(cd "$(dirname "$REPO_DIR")" && pwd)/personal-tools-data}"
if [[ "$RAW_DATA_DIR" == ~* ]]; then
  DATA_DIR="$HOME${RAW_DATA_DIR#\~}"
else
  DATA_DIR="$RAW_DATA_DIR"
fi

LOG_DIR="${PERSONAL_TOOLS_LOG_DIR:-$HOME/Library/Logs/personal-tools}"
PORT="${PERSONAL_TOOLS_PORT:-3100}"
DIST_DIR="${NEXT_DIST_DIR:-.next-prod}"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
GUI_DOMAIN="gui/$(id -u)"

shopt -s nullglob
TEMPLATES=("$SCRIPT_DIR"/*.plist.template)
shopt -u nullglob

if [[ ${#TEMPLATES[@]} -eq 0 ]]; then
  echo "ERROR: no *.plist.template files found in $SCRIPT_DIR" >&2
  exit 1
fi

MATCHED=0
for TEMPLATE in "${TEMPLATES[@]}"; do
  LABEL="$(basename "$TEMPLATE" .plist.template)"
  if [[ -n "$JOB_FILTER" && "$LABEL" != "$JOB_FILTER" && "$LABEL" != "com.personal-tools.$JOB_FILTER" ]]; then
    continue
  fi
  MATCHED=$((MATCHED + 1))

  TARGET_PLIST="$LAUNCH_AGENTS_DIR/$LABEL.plist"
  RENDERED="$(
    sed \
      -e "s|__NODE_BIN__|$NODE_BIN|g" \
      -e "s|__NODE_DIR__|$NODE_DIR|g" \
      -e "s|__REPO_DIR__|$REPO_DIR|g" \
      -e "s|__DATA_DIR__|$DATA_DIR|g" \
      -e "s|__LOG_DIR__|$LOG_DIR|g" \
      -e "s|__PORT__|$PORT|g" \
      -e "s|__DIST_DIR__|$DIST_DIR|g" \
      "$TEMPLATE"
  )"

  if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== [dry-run] $TARGET_PLIST ==="
    printf '%s\n' "$RENDERED"
    echo "=== [dry-run] commands ==="
    echo "mkdir -p \"$LOG_DIR\" \"$LAUNCH_AGENTS_DIR\""
    echo "launchctl bootout \"$GUI_DOMAIN/$LABEL\" 2>/dev/null || true"
    echo "launchctl bootstrap \"$GUI_DOMAIN\" \"$TARGET_PLIST\""
  else
    mkdir -p "$LOG_DIR" "$LAUNCH_AGENTS_DIR"
    printf '%s\n' "$RENDERED" > "$TARGET_PLIST"
    launchctl bootout "$GUI_DOMAIN/$LABEL" 2>/dev/null || true
    # bootout 是非同步的；還沒卸載完就 bootstrap 會失敗（5: Input/output error），最多等 10 秒
    for _ in {1..20}; do
      launchctl print "$GUI_DOMAIN/$LABEL" >/dev/null 2>&1 || break
      sleep 0.5
    done
    launchctl bootstrap "$GUI_DOMAIN" "$TARGET_PLIST"
    echo "Installed and started $LABEL ($TARGET_PLIST)"
  fi
done

if [[ $MATCHED -eq 0 ]]; then
  echo "ERROR: no template matched --job '$JOB_FILTER'" >&2
  exit 1
fi
