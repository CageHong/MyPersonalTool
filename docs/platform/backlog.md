# 平台 Backlog

平台層級還沒定或還沒做的事。各工具的在 `docs/<工具>/backlog.md`。

## 待決

- **finance 的畫面怎麼套用 `globals.css`**:`globals.css` 的 `:root` 是全站共用的;finance 原本的設計基準是 Georgia / Helvetica Neue 與另一組配色(米白紙、鏽紅褐、赭橘、靛藍、橄欖),跟現在的系統字型堆疊與色票不同。做 finance 第一個畫面之前要定:兩個工具共用同一組色票、每個工具一組語意層覆寫,或其他做法。定案之前,「新增色票要先問」照樣適用。

## 待做

- **`next.config.ts` 的 `transpilePackages`**:`packages/` 的套件直接匯出 TypeScript 原始碼。Next.js 的程式(頁面、route handler、它們匯入的模組)第一次匯入某個套件時,把套件名稱加進 `transpilePackages`。目前只有測試與命令列工具(tsx)會用到套件,還不需要。

## 明確不做(提出前先問)

首頁 shell、使用者帳號、部署設定、共用設計系統、深色模式。
