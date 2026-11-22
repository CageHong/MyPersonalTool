#!/usr/bin/env bash
set -euo pipefail

DRY_RUN=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      echo "Usage: $0 [--dry-run]"
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
cd "$REPO_DIR"

LABEL="com.personal-tools.web"
PLIST_PATH="$HOME/Library/LaunchAgents/$LABEL.plist"
GUI_DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$GUI_DOMAIN/$LABEL"

if [[ ! -f "$PLIST_PATH" ]]; then
  if [[ "$DRY_RUN" == "true" ]]; then
    echo "[dry-run] warning: plist not found at $PLIST_PATH (would fail unless npm run deploy:install was run first)" >&2
    PROD_DATA_DIR="<from plist: PERSONAL_TOOLS_DATA_DIR>"
    PROD_DIST_DIR="<from plist: NEXT_DIST_DIR>"
  else
    echo "ERROR: 找不到已安裝的 plist（${PLIST_PATH}），請先執行 npm run deploy:install" >&2
    exit 1
  fi
else
  PROD_DATA_DIR="$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:PERSONAL_TOOLS_DATA_DIR" "$PLIST_PATH")"
  PROD_DIST_DIR="$(/usr/libexec/PlistBuddy -c "Print :EnvironmentVariables:NEXT_DIST_DIR" "$PLIST_PATH")"
fi

if [[ "$DRY_RUN" == "true" ]]; then
  echo "=== [dry-run] deploy steps ==="
  echo "1. Verify git branch is 'main' and working tree is clean"
  echo "2. npm test"
  echo "3. launchctl bootout \"$SERVICE_TARGET\" 2>/dev/null || true"
  echo "4. PERSONAL_TOOLS_DATA_DIR=\"$PROD_DATA_DIR\" npm run tasks:db:migrate"
  echo "   PERSONAL_TOOLS_DATA_DIR=\"$PROD_DATA_DIR\" npm run finance:db:migrate"
  echo "5. NODE_ENV=production NEXT_DIST_DIR=\"$PROD_DIST_DIR\" PERSONAL_TOOLS_DATA_DIR=\"$PROD_DATA_DIR\" npm run build"
  echo "6. launchctl bootstrap \"$GUI_DOMAIN\" \"$PLIST_PATH\""
  exit 0
fi

echo "[1/6] 檢查 git 分支與工作區狀態..."
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$CURRENT_BRANCH" != "main" ]]; then
  echo "ERROR: deploy 失敗於第 1 步（目前分支為 '$CURRENT_BRANCH'，必須在 'main' 上執行；正式版保持原狀）" >&2
  exit 1
fi
if [[ -n "$(git status --porcelain)" ]]; then
  echo "ERROR: deploy 失敗於第 1 步（工作區有未 commit 的變更，請先處理；正式版保持原狀）" >&2
  exit 1
fi

echo "[2/6] 執行測試..."
if ! npm test; then
  echo "ERROR: deploy 失敗於第 2 步（npm test 失敗；正式版保持原狀）" >&2
  exit 1
fi

echo "[3/6] 停止正式版服務..."
launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true

echo "[4/6] 套用資料庫 migration（PERSONAL_TOOLS_DATA_DIR=${PROD_DATA_DIR}）..."
if ! PERSONAL_TOOLS_DATA_DIR="$PROD_DATA_DIR" npm run tasks:db:migrate; then
  echo "ERROR: deploy 失敗於第 4 步（tasks:db:migrate 失敗）。正式版已維持停止，請修正問題後重新執行 npm run deploy。" >&2
  exit 1
fi
if ! PERSONAL_TOOLS_DATA_DIR="$PROD_DATA_DIR" npm run finance:db:migrate; then
  echo "ERROR: deploy 失敗於第 4 步（finance:db:migrate 失敗）。正式版已維持停止，請修正問題後重新執行 npm run deploy。" >&2
  exit 1
fi

echo "[5/6] 建置正式版（NEXT_DIST_DIR=${PROD_DIST_DIR}）..."
if ! NODE_ENV=production NEXT_DIST_DIR="$PROD_DIST_DIR" PERSONAL_TOOLS_DATA_DIR="$PROD_DATA_DIR" npm run build; then
  echo "ERROR: deploy 失敗於第 5 步（next build 失敗）。正式版已維持停止，請修正問題後重新執行 npm run deploy。" >&2
  exit 1
fi

echo "[6/6] 啟動正式版服務..."
if ! launchctl bootstrap "$GUI_DOMAIN" "$PLIST_PATH"; then
  echo "ERROR: deploy 失敗於第 6 步（launchctl bootstrap 失敗）。請檢查 $PLIST_PATH 與 log。" >&2
  exit 1
fi

echo "✓ deploy 完成（http://localhost:3100）"
