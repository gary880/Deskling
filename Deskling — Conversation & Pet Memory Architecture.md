# Deskling — Conversation & Pet Memory Architecture

## Scope

Deskling 將三種概念分開：

```text
Conversation session 目前正在談什麼
Conversation history 發生過哪些對話
Pet memory       使用者允許 Pet 記住哪些重要資訊
```

History 不等於 memory。保存歷史不會自動建立記憶，完整 history 也不會直接加入 prompt。

## Native Windows

Desktop runtime 使用三個 Tauri window：

```text
control       Pet Lab 與設定
pet           320 × 300 的透明 Pet overlay
conversation  預先建立、預設隱藏的透明 sidecar
```

Conversation UI 是獨立 native window。Pet window 不會為了顯示對話而 resize，因此開啟、換邊、拖曳與關閉 sidecar 不應改變 Pet 的螢幕座標。Conversation header 可啟動原生 window drag；完成後將位置回報給 PetOverlay，保存成相對 Pet 的偏移，使 Pet 移動時 sidecar 仍會跟隨。左右停靠 action 會清除此偏移。PetOverlay 擁有 conversation runtime state，透過 Tauri events 將 UI state 傳到 ConversationWindow，並接收 send、stop、remember、typing、side、drag 和 close actions。

## Direct Conversation Flow

```text
使用者送出訊息
→ ConversationWindow 發送 action
→ PetOverlay 防止重複 send
→ 保存 user history（若已啟用）
→ 載入同一 Pet 的 approved memories（若已啟用）
→ relevance selector 與 context budget
→ Tauri start_pet_conversation
→ provider adapter 將 prompt 經 stdin 傳給 Codex 或 Claude Code CLI
→ runtime events 同步回 Pet 與 Conversation window
→ 保存 Pet response history（若已啟用）
```

Control window 將 provider 保存在 localStorage 並透過 event 同步給 Pet window。Rust runtime 為 Codex 與 Claude Code 各自保存 session ID，provider 切換時會停止目前 process，避免舊 provider 的延遲事件污染新對話。

Provider adapter 的安全設定：

- Codex CLI 使用 `--ask-for-approval never` 與 `--sandbox read-only`。
- Claude Code 使用 headless stream JSON、`--safe-mode`、`--tools ""`、`--disallowedTools "mcp__*"`、`--permission-mode dontAsk` 與 `--no-chrome`。
- 兩者都從 stdin 接收 prompt；memory 不作為 shell arguments。
- Runtime 會移除 provider 的 API key、auth token 與自訂 endpoint 環境變數，只接受 CLI 本身已登入的訂閱帳號。

Codex 使用 ChatGPT subscription login。Claude Code `claude -p` 使用訂閱帳號另附的 Agent SDK credit，不使用一般互動式 Claude Code rate limit；這項額度政策需在產品說明中明確呈現。

## Prompt Composition

順序固定為：

```text
Deskling safety policy
→ Pet identity
→ Pet personality and user overrides
→ Relevant approved memories
→ Conversation context
→ Current user message
→ Output policy
```

Memory 是背景資訊，不能作為 authority、security policy 或覆蓋 safety policy。Conversation context 使用目前 provider 的 runtime session continuity；保存到 App Data 的完整 history 不會被重新注入。

## Pet Memory Model

```ts
interface PetMemory {
  id: string;
  category: "preference" | "fact" | "ongoing";
  content: string;
  createdAt: number;
  updatedAt: number;
  sourceConversationId?: string;
}
```

每隻 Pet 獨立保存在：

```text
App Data/pet-memory/<pet-id>.json
```

Pet Lab 的 `MEMORY` 提供啟用／停用、最大筆數、查看、手動新增、編輯、刪除與全部清除。停用只阻止 memory 進入 prompt，不刪除內容。

## Explicit Confirmation

第一版只支援手動、明確確認：

- Pet Lab 手動新增。
- Direct conversation 完成後點 `＋ 記住資訊`。
- 草稿預填使用者上一句，而不是 Pet 的回覆。
- 使用者可修改內容並選擇類別。
- 點擊保存後才寫入 App Data。

目前不會由 AI 自動分析、抽取或保存記憶。未來若加入 AI suggestions，仍必須讓使用者逐項確認。

## Context Budget and Selection

直接對話的 memory context 限制：

- 最多 5 項。
- 每項最多 300 Unicode characters。
- 總計最多 1,000 characters。
- 以目前訊息的 token overlap、`ongoing` 類別與更新時間排序。
- Rust prompt composer 會再次限制數量、長度、類別與敏感內容。

目前 selector 會在不足 5 項時以更新時間補入低相關 memory；這是第一版限制，不應將其描述為嚴格 semantic retrieval。

## Proactive Privacy Boundary

Proactive interaction 預設且固定不使用 Pet memory。前端呼叫明確傳入空陣列，Rust prompt composer 也只在 purpose 為 `conversation` 時接受 memory。

Proactive context 只包含 Deskling 自身產生的安全狀態，例如約略時段、閒置分鐘、behavior、personality traits 與最近互動結果；不讀取視窗標題、剪貼簿、文件或 workspace。

觸發規則：

- `often`／`sometimes`／`rare` 的 idle threshold 分別為 10／20／30 分鐘；frequency cooldown 仍分別為 30／90／180 分鐘。
- 使用者觸碰或拖曳 Pet、操作 Conversation、手動 behavior、切換 provider／proactive 設定時會同步更新同一份 last-user-activity clock。
- Sleeping 不再是永久阻擋；符合其他 guardrail 時會先透過 Autonomy scheduler 喚醒再顯示短句。
- Conversation open、active request、dragging、typing 與 Pet window 不可見仍會阻擋。
- `useAi: false` 使用按 personality traits 與偏好語言選擇的本機白名單短句，不啟動 provider process。
- `Test now` 忽略 idle、quiet hours、frequency、daily limit 與 ignored backoff，但不繞過 operational safety，並把成功、阻擋原因或 runtime error 回報 Control window。

## Sensitive-data Guardrails

Memory 禁止保存疑似：

- 密碼
- API key 或 token
- 私鑰
- 信用卡與銀行資料
- 政府身分證號
- 精確醫療／病歷資訊
- Package 作者要求保存的資料

前端在確認前提示，Rust 儲存層再次驗證。這是保守的 pattern-based guardrail，不是完整的資料外洩偵測系統；使用者仍不應將秘密輸入 Deskling memory。

## Persistence and Sessions

```text
New Conversation  清除目前 provider 的 session；不刪除 history 或 memory
Switch Provider    停止 active process；Codex 與 Claude session 分開保存
App restart        history 與 memory 從 App Data 重新載入
Switch Pet         切換到另一份 per-pet files
Disable Memory     保留資料但不加入 prompt
Clear All Memory   刪除該 Pet 的 memory file
```

Conversation history 支援 retention days 與 maximum entries。Memory 不使用 retention，僅使用 per-pet maximum entries。

## Input and Event Safety

- IME composition 期間、keyCode 229，以及 composition 結束後的短暫 Enter 不會送出。
- Shift+Enter 換行；一般 Enter 送出。
- Conversation action listener 會處理 React StrictMode 的非同步 cleanup。
- PetOverlay 使用同步 send lock，避免重複 event 同時啟動兩個 provider requests。
- Conversation event 包含 provider，切換後會忽略舊 provider 的殘留事件。

## Testing Expectations

提交 conversation 或 memory 相關變更前至少執行：

```bash
npm test
npm run build
cd src-tauri
cargo test
cargo fmt --check
```

應維持的關鍵 invariant：

- Proactive prompt 永不包含 memory。
- Safety policy 排在 personality、memory 與 user message 之前。
- Memory 受固定 context budget 限制。
- IME 選字不會送出訊息。
- Sidecar 開關不 resize 或移動 Pet window。
- Sidecar 拖曳只改變 conversation offset；Pet 移動時仍保留相對位置。
- History 與 memory 始終按 Pet ID 隔離。
- Provider CLI 必須維持 tool-free、non-interactive，且不得讀取 API key 環境變數。
