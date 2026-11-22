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
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "=== [dry-run] uninstall $LABEL ==="
    echo "launchctl bootout \"$GUI_DOMAIN/$LABEL\" 2>/dev/null || true"
    echo "rm -f \"$TARGET_PLIST\""
  else
    launchctl bootout "$GUI_DOMAIN/$LABEL" 2>/dev/null || true
    rm -f "$TARGET_PLIST"
    echo "Uninstalled $LABEL"
  fi
done

if [[ $MATCHED -eq 0 ]]; then
  echo "ERROR: no template matched --job '$JOB_FILTER'" >&2
  exit 1
fi
