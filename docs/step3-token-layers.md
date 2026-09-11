# 步驟 3:token 分層

目標:建立語意層,讓每個用途各有一個可單獨調整的變數。
**值不動**——第一層保留你現在調好的顏色,只改名稱。

---

## 1. 第一層:色票

把現有 `:root` 裡的 14 個變數**改名**,右邊的值原封不動。

| 現在的名稱 | 改成 |
|---|---|
| `--color-bg` | `--palette-base` |
| `--color-surface` | `--palette-panel` |
| `--color-text` | `--palette-ink` |
| `--color-text-muted` | `--palette-ink-soft` |
| `--color-border` | `--palette-line` |
| `--color-accent` | `--palette-accent` |
| `--color-on-accent` | `--palette-on-accent` |
| `--color-danger` | `--palette-danger` |
| `--color-backdrop` | `--palette-shade` |
| `--color-priority-low` | `--palette-green` |
| `--color-priority-medium` | `--palette-amber` |
| `--color-priority-high` | `--palette-red` |
| `--space-1` … `--space-5` | 不動 |
| `--radius` | 不動 |
| `--font-sans` | 不動 |

改名是刻意的:任何一處忘了改的元件會引用到已不存在的變數,畫面會當場壞掉,你立刻看得到。留著舊名稱的話,漏改的地方會靜悄悄地繼續運作,直到某天你調值時才發現。

---

## 2. 第二層:語意

接在色票後面,整段貼上。元件只能引用這一層。

```css
  /* ---- 版面 ---- */
  --color-page-bg: var(--palette-base);
  --color-column-aside: var(--palette-panel);   /* 左欄、右欄 */
  --color-column-main: var(--palette-base);     /* 中欄 */
  --color-divider: var(--palette-line);         /* 欄與欄之間 */
  --color-dialog-bg: var(--palette-base);
  --color-dialog-border: var(--palette-line);
  --color-dialog-section-line: var(--palette-line);
  --color-backdrop: var(--palette-shade);

  /* ---- 文字 ---- */
  --color-text: var(--palette-ink);
  --color-text-muted: var(--palette-ink-soft);
  --color-text-subtle: var(--palette-ink-soft);  /* 第四階,之後調淡 */

  /* ---- 可輸入欄位 ---- */
  --color-field-bg: var(--palette-base);
  --color-field-text: var(--palette-ink);
  --color-field-border: var(--palette-line);
  --color-field-border-invalid: var(--palette-danger);
  --color-field-label: var(--palette-ink-soft);
  --color-field-placeholder: var(--palette-ink-soft);
  --color-field-disabled-bg: var(--palette-panel);
  --color-field-disabled-text: var(--palette-ink-soft);

  /* ---- 清單項目 ---- */
  --color-row-bg: var(--palette-panel);
  --color-row-border: var(--palette-line);
  --color-row-selected-border: var(--palette-accent);
  --color-row-meta: var(--palette-ink-soft);
  --color-row-done-text: var(--palette-ink-soft);
  --color-row-action-border: var(--palette-line);

  /* ---- 左欄檢視 ---- */
  --color-nav-text: var(--palette-ink);
  --color-nav-muted: var(--palette-ink-soft);
  --color-nav-hover-bg: var(--palette-base);
  --color-nav-selected-bg: var(--palette-base);
  --color-nav-selected-border: var(--palette-accent);

  /* ---- 動作 ---- */
  --color-action-bg: var(--palette-accent);
  --color-action-text: var(--palette-on-accent);
  --color-action-disabled-bg: var(--palette-panel);
  --color-action-disabled-text: var(--palette-ink-soft);
  --color-destructive-text: var(--palette-danger);

  /* ---- 狀態 ---- */
  --color-overdue: var(--palette-danger);
  --color-error-text: var(--palette-danger);
  --color-priority-low: var(--palette-green);
  --color-priority-medium: var(--palette-amber);
  --color-priority-high: var(--palette-red);

  /* ---- 月曆 ---- */
  --color-calendar-today-bg: var(--palette-panel);
  --color-calendar-selected-bg: var(--palette-accent);
  --color-calendar-selected-text: var(--palette-on-accent);
  --color-calendar-focus-border: var(--palette-accent);
  --color-calendar-weekday: var(--palette-ink-soft);
  --color-calendar-nav-border: var(--palette-line);
```

`--color-nav-hover-bg` 和 `--color-nav-selected-bg` 目前指向同一個色票,因為現況就是同值。它們是兩個名字,步驟 5 可以分開調。

---

## 3. 逐行替換表

### ThreeColumnLayout.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 17 | `background: var(--color-surface)` | `var(--color-column-aside)` |
| 18 | `border-right: … var(--color-border)` | `var(--color-divider)` |
| 25 | `border-right: … var(--color-border)` | `var(--color-divider)` |

**新增兩行**(這是「中欄右欄改不了」的根因):

```css
.tasks  { background: var(--color-column-main); }
.detail { background: var(--color-column-aside); }
```

### globals.css 的 body

現在沒有任何 `background` 宣告,所以整頁底是瀏覽器預設白。補上:

```css
body { background: var(--color-page-bg); }
```

### CategoryColumn.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 16 | `border: 1px solid transparent` | 不動(佔位,避免選中時位移) |
| 18 | `background: transparent` | 不動 |
| 19 | `--color-text` | `--color-nav-text` |
| 26 | `--color-bg` | `--color-nav-hover-bg` |
| 30 | `--color-accent` | `--color-nav-selected-border` |
| 31 | `--color-bg` | `--color-nav-selected-bg` |
| 38 | `--color-text-muted` | `--color-text-subtle` |

### NewTaskForm.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 14 | `--color-text-muted` | `--color-field-label` |
| 19, 41 | `--color-border` | `--color-field-border` |
| 21, 43 | `--color-bg` | `--color-field-bg` |
| 22, 44 | `--color-text` | `--color-field-text` |
| 33, 54 | `--color-surface` | `--color-field-disabled-bg` |
| 34, 55 | `--color-text-muted` | `--color-field-disabled-text` |
| 61 | `border: none` | 不動 |
| 63 | `--color-accent` | `--color-action-bg` |
| 64 | `--color-bg` | `--color-action-text` ← **bug 修正** |
| 71 | `--color-text-muted` | `--color-action-disabled-bg` ← **bug 修正** |

### TaskItem.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 7 | `--color-border` | `--color-row-border` |
| 9 | `--color-surface` | `--color-row-bg` |
| 15 | `--color-accent` | `--color-row-selected-border` |
| 38–40 | `border: 0` / `background: none` / `color: inherit` | 不動 |
| 54 | `--color-text-muted` | `--color-row-meta` |
| 59 | `--color-danger` | `--color-overdue` |
| 68, 72, 76 | `--color-priority-*` | 不動 |
| 81 | `--color-border` | `--color-row-action-border` |
| 84 | `--color-danger` | `--color-destructive-text` |
| 91, 97 | `--color-text-muted` | 見下方待確認 |

### TaskDetail.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 14, 22 | `--color-text-muted` | `--color-field-label` |

### TaskTitleField / TaskNotesField / TaskDueDateField

三個檔案結構相同:

| 行 | 現在 | 改成 |
|---|---|---|
| 4 | `--color-border` | `--color-field-border` |
| 6 | `--color-bg` | `--color-field-bg` |
| 7 | `--color-text` | `--color-field-text` |
| placeholder 的 `--color-text-muted` | | `--color-field-placeholder` |

TaskDueDateField 額外兩行:

| 行 | 現在 | 改成 |
|---|---|---|
| 13 | `border-color: var(--color-danger)` | `--color-field-border-invalid` |
| 14 | `color: var(--color-danger)` | `--color-error-text` |

### TaskPriorityField.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 12 | `--color-border` | `--color-field-border` |
| 14 | `--color-text-muted` | `--color-field-label` |
| 19 | `--color-accent` | `--color-field-border-focus`(新增,見下) |
| 20 | `--color-surface` | `--color-field-selected-bg`(新增,見下) |
| 34, 38, 42 | `--color-priority-*` | 不動 |

這兩個變數要補進語意層:

```css
  --color-field-border-focus: var(--palette-accent);
  --color-field-selected-bg: var(--palette-panel);
```

### DueDateDialog.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 4 | `--color-border` | `--color-dialog-border` |
| 6 | `--color-bg` | `--color-dialog-bg` |
| 7 | `--color-text` | `--color-text` (不動) |
| 11 | `--color-backdrop` | 不動 |
| 30 | `--color-border` | `--color-field-border` |
| 33 | `--color-text` | 不動 |
| 43 | `border-top: … var(--color-border)` | `--color-dialog-section-line` |
| 48 | `--color-border` | `--color-field-border` |
| 51 | `--color-danger` | `--color-destructive-text` |
| 58 | `--color-accent` | `--color-action-bg` |
| 60 | `--color-accent` | `--color-action-bg` |
| 61 | `--color-on-accent` | `--color-action-text` |

### MonthCalendar.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 20 | `--color-border` | `--color-calendar-nav-border` |
| 22, 45 | `background: transparent` | 不動 |
| 23, 46 | `--color-text` | 不動 |
| 36 | `--color-text-muted` | `--color-calendar-weekday` |
| 43 | `border: 1px solid transparent` | 不動 |
| 52 | `--color-surface` | `--color-calendar-today-bg` |
| 57 | `--color-accent` | `--color-calendar-focus-border` |
| 61, 66 | `--color-accent` | `--color-calendar-selected-bg` |
| 62 | `--color-on-accent` | `--color-calendar-selected-text` |

### TaskList.module.css

| 行 | 現在 | 改成 |
|---|---|---|
| 16 | `--color-text-muted` | `--color-text-subtle`(空狀態文字) |
| 20 | `--color-danger` | `--color-error-text` |

---

## 4. 待確認

`TaskItem.module.css` 第 91、97 行都是 `--color-text-muted`,但看宣告分不出用途。
要 CC 依 selector 判斷:已完成任務的標題用 `--color-row-done-text`,其餘 meta 資訊用 `--color-row-meta`,並回報它判給了哪個。

---

## 5. 驗收

改完後畫面應該和現在**幾乎一模一樣**。只有三處會變,而且都是修正:

1. 中欄與右欄出現背景色(原本是瀏覽器預設白,沒接上變數)
2. 新增鈕的文字變成 `--palette-on-accent`(原本誤用背景色當文字色)
3. 停用狀態的按鈕底色不再是文字色

除此之外任何一處改變,都代表某行換錯了變數。

另外要確認:全專案不應該再有任何 `var(--color-bg)`、`var(--color-surface)`、`var(--color-border)` 之類的舊名稱。

```bash
grep -rn 'var(--color-\(bg\|surface\|border\)\b' src --include='*.css'
```

應該沒有輸出。
