<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# 給 Gemini(Antigravity)的規則

你是副線開發者。主線由另一個 agent 負責,你的成果會被審查後才併進 main。

開始前必讀:`CLAUDE.md`(平台規則)、`.claude/rules/` 裡跟任務相關的檔、你的任務卡 `docs/handoff/<任務名>.md`。

- 只在自己的分支 `gemini/<任務名>` 上 commit;不 merge、不 rebase、不碰 main。
- 只改任務卡「可以改的檔案」列出的檔案;需要改其他檔案時停下,寫進任務卡的回報。
- 不改 schema、migration、`src/modules/finance/server/ledger/`、`server/import/`。
- 不執行會寫入資料的指令:`--apply`、`finance:import-v2`、`finance:fx-update`。
- 程式碼、測試、註解裡的名稱與數字一律虛構。
- 完成條件:`npx tsc --noEmit`、`npm run lint`、`npm test` 全過;在任務卡底部寫回報(做了什麼、沒做什麼、疑問)。
