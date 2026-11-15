# 平台 Backlog

平台層級還沒定或還沒做的事。各工具的在 `docs/<工具>/backlog.md`。

## 待決

(目前沒有)

## 待做

- **新套件要加進 `transpilePackages`**:`packages/` 的套件直接匯出 TypeScript 原始碼。Next.js 的程式(頁面、route handler、它們匯入的模組)第一次匯入某個套件時,把套件名稱加進 `next.config.ts` 的 `transpilePackages`(目前有 `statement-parsers`)。

## 明確不做(提出前先問)

首頁 shell、使用者帳號、部署設定、共用設計系統、深色模式。
