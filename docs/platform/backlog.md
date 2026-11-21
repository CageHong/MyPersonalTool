# 平台 Backlog

平台層級還沒定或還沒做的事。各工具的在 `docs/<工具>/backlog.md`。

## 待決

(目前沒有)

## 待做

- **首頁**(`docs/platform/decisions.md` §4):第一段(只有工具入口)完成;第二段待做,在 finance 的報表(`reports` 模組)做好後加摘要小工具,由各工具提供小工具元件與摘要 API。
- **新套件要加進 `transpilePackages`**:`packages/` 的套件直接匯出 TypeScript 原始碼。Next.js 的程式(頁面、route handler、它們匯入的模組)第一次匯入某個套件時,把套件名稱加進 `next.config.ts` 的 `transpilePackages`(目前有 `statement-parsers`)。

## 明確不做(提出前先問)

使用者帳號、部署設定、深色模式。

## 之後要做,但不要主動提

- **共用設計系統**:要做(接近 Apple 的設計美學,各工具同一套樣式、各自的主題色),由使用者自己開 session 處理。做其他事時不要主動提議、不要順手抽元件或改樣式。
