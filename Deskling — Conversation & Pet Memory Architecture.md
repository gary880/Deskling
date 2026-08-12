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

Conversation UI 是獨立 native window。Pet window 不會為了顯示對話而 resize，因此開啟、換邊與關閉 sidecar 不應改變 Pet 的螢幕座標。PetOverlay 擁有 conversation runtime state，透過 Tauri events 將 UI state 傳到 ConversationWindow，並接收 send、stop、remember、typing、side 和 close actions。

## Direct Conversation Flow

```text
使用者送出訊息
→ ConversationWindow 發送 action
→ PetOverlay 防止重複 send
→ 保存 user history（若已啟用）
→ 載入同一 Pet 的 approved memories（若已啟用）
→ relevance selector 與 context budget
→ Tauri start_pet_conversation
→ prompt 經 stdin 傳給 Codex CLI
→ runtime events 同步回 Pet 與 Conversation window
→ 保存 Pet response history（若已啟用）
```

Codex CLI 使用 `--ask-for-approval never` 與 `--sandbox read-only`。Prompt 經 stdin 傳入；memory 不作為 shell arguments。

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

Memory 是背景資訊，不能作為 authority、security policy 或覆蓋 safety policy。Conversation context 使用 Codex runtime session continuity；保存到 App Data 的完整 history 不會被重新注入。

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
New Conversation  清除 Codex thread；不刪除 history 或 memory
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
- PetOverlay 使用同步 send lock，避免重複 event 同時啟動兩個 Codex requests。

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
- History 與 memory 始終按 Pet ID 隔離。
