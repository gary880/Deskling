# Deskling Desktop MVP

Deskling 的第一個可執行 Desktop Pet runtime。它依照《Deskling — Pet Asset & Avatar Architecture》實作 Manifest + WebP Spritesheet，並刻意讓 behavior、motion 與 sprite rendering 分離。

## 執行 Desktop App

```bash
npm install
npm run desktop
```

這會啟動三個原生視窗：

- `control`：Pet Package Lab 與角色／behavior／desktop 設定。
- `pet`：無邊框、透明、置頂的桌面寵物 overlay。
- `conversation`：預先建立、預設隱藏的對話 sidecar；顯示時位於 Pet 左側或右側，不會 resize 或移動 Pet window。

關閉 Control Window 只會隱藏它；可從 macOS menu bar 的 Deskling icon 重新開啟、切換角色、顯示或隱藏寵物，以及退出程式。

純瀏覽器預覽仍可用 `npm run dev` 啟動。

驗證：

```bash
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
```

## 已完成範圍

- OpenPets / Codex Pets `pet.json` loader 與固定 8×9 atlas adapter
- 選用的 `deskling.json` sidecar、雙層 compatibility/enhancement validation
- WebP spritesheet renderer、語意動畫 ID 與 fallback
- `feet`、`head`、`speechBubble` anchors
- `body`、`head` hitboxes
- 左右朝向、點擊移動、拖曳與基礎 behavior preview
- Mochi 與 Bella developer-local packages
- Tauri v2 macOS shell、Control／Pet／Conversation 三視窗與 event sync
- 透明、無邊框、always-on-top overlay
- 原生視窗拖曳、螢幕 work area 邊界限制與位置保存
- Click-through mode 與 menu bar 控制
- macOS Accessibility 授權狀態、系統設定引導與未授權降級
- Active window 的位置／尺寸追蹤、跨螢幕與負座標支援
- 以 package `feet` anchor 對齊視窗上緣或 Desktop Floor
- `dragging > reacting > roaming > sleeping > idle` 行為優先序與獨立 surface state
- 自主 idle variation、視窗／桌面表面散步與可設定的 sleep scheduling
- Rich Interaction：頭部游標感知、摸頭 gesture、hitbox-specific 點擊與 personality-aware 本機反應
- 可自訂 Pet personality、App Data override 與安全 prompt composition
- Codex／Claude Code 訂閱 CLI Conversation sidecar、雙擊開啟、左右換邊、中文 IME 安全輸入與 opt-in 主動短互動
- 每隻 Pet 獨立的本機 conversation history、保存期限與筆數限制
- 每隻 Pet 獨立、由使用者明確確認的本機 memory，以及敏感資料防護與 prompt context budget
- 安全的 Pet ZIP import、manifest／asset validation、衝突確認與原子安裝
- OpenPets Creator：atlas／animation mapping、anchor、hitbox、personality 視覺編輯與可重新匯入的完整 ZIP export

Pet catalog 位於 `public/pets/index.json`。新增角色時，建立含有 `pet.json` 與 `spritesheet.webp` 的 OpenPets package，再將 `pet.json` URL 加進 catalog；anchor、hitbox、播放設定、聲音與 personality 可放在選用的 `deskling.json` sidecar。舊版完整 `deskling.json` package 仍可載入與匯入。

目前優先支援 macOS。透明背景使用 Tauri 的 `macOSPrivateApi`，適合直接散佈與公證，但不符合 Mac App Store 的 private API 規則。其他平台的 window awareness 仍留在後續切片。

## Conversation、History 與 Memory

雙擊 Pet 開啟獨立的 Conversation sidecar。sidecar 可切換至 Pet 左側或右側，也可拖曳 header 自訂相對位置；拖曳 Pet 時會保留偏移並跟隨移動，按下左右箭頭會恢復標準停靠。關閉 sidecar 不會改變 Pet 的位置。一般 Enter 送出、Shift+Enter 換行；中文／日文等 IME 組字與選字期間的 Enter 不會送出訊息。

Conversation runtime 可在 Pet Lab 的 `AI PROVIDER` 選擇 Codex 或 Claude Code，直接使用已安裝 CLI 的訂閱登入，不要求也不保存 API key。Codex 需先執行 `codex login`，Claude Code 需先執行 `claude auth login`；狀態卡會顯示安裝版本與登入狀態。兩者皆以非互動模式執行，停用工具與權限請求，並移除 API key／自訂 endpoint 相關環境變數。

Codex 使用 ChatGPT 訂閱所含的 Codex 用量。Claude Code 的 headless `claude -p` 自 2026-06-15 起使用訂閱帳號另外附帶的 Agent SDK monthly credit，並非一般互動式 Claude Code rate limit；credit 用完後只有在使用者另行啟用 usage credits 時才會繼續計費。詳見 [Codex authentication](https://learn.chatgpt.com/docs/auth) 與 [Claude Agent SDK plan usage](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)。

Conversation history 和 Pet memory 是兩種不同資料：

- History 保存「發生過哪些對話」，可設定保存期限與筆數；不會直接整批加入 prompt。
- Memory 保存「使用者明確允許 Pet 記住的重要資訊」，可在 Pet Lab 的 `MEMORY` 查看、新增、編輯、刪除或全部清除。

Pet 回覆後的 `＋ 記住資訊` 會以使用者上一句作為草稿；使用者仍需編輯、選擇類別並確認保存。第一版不會自動從對話抽取或自動保存 memory。

直接對話最多挑選 5 項相關 memory，每項最多 300 字、總計最多 1,000 字。Proactive interaction 固定不使用 memory。完整資料流、prompt 順序與隱私限制見 [Conversation & Pet Memory Architecture](./Deskling%20%E2%80%94%20Conversation%20%26%20Pet%20Memory%20Architecture.md)。

### 本機資料

所有 personality、history、memory 與安裝的 Pet Package 都保存在 Tauri App Data，不會寫入目前 workspace。macOS identifier 為 `com.deskling.desktop`，預設位置為：

```text
~/Library/Application Support/com.deskling.desktop/
├── agent-workspace/
├── conversation-history/<pet-id>.json
├── pet-memory/<pet-id>.json
├── pet-settings/<pet-id>.json
└── pets/<pet-id>/
```

UI 開關與容量偏好使用 WebView `localStorage`，內容資料則由 Rust command 驗證並寫入 App Data。

### Window-aware mode（macOS）

從 Control Window 的 `DESKTOP WORLD` 區塊開啟視窗感知模式與跟隨使用中視窗。Deskling 會請求 macOS「輔助使用」權限；授權後只讀取 focused window 的位置、尺寸、最小化狀態與所屬程序 ID，不讀取視窗內容、標題或鍵盤輸入，也不會追蹤 Deskling 自己的 Control／Pet 視窗。

未授權、目標關閉或最小化時，寵物會在啟用 `Desktop floor fallback` 的情況下回到目前螢幕底部；拖曳與既有 behavior 仍可使用。權限也可從 menu bar 的 `Accessibility` 項目重新開啟系統設定。

### Autonomous behavior

Behavior 與 surface 是兩組獨立狀態：角色可以在 active window 或 Desktop Floor 上待機、散步與睡眠，而定位事件不會直接指定 sprite animation。Control Window 可開關自主行為與散步，設定 15／30／60 分鐘後睡眠（或永不睡眠），並決定 active window 改變時是否喚醒。

自主計時只使用 Deskling 自身互動、視窗目標變更與經過時間，不監聽全系統鍵盤或滑鼠輸入。預設約 45 秒後播放 idle variation，90–180 秒之間嘗試一次散步；拖曳、點擊與手動 behavior 會重設計時。

### Overlay 操作

- 按住角色的頭部或身體拖曳，即可移動桌面寵物。
- 短點頭部會播放 `happy` 反應。
- 游標靠近頭部時 Pet 會注視游標；在頭部來回移動可觸發具 cooldown 的摸頭反應。
- 頭部與身體點擊會依 Pet personality 選擇不同動畫與本機短句，不會呼叫 AI。
- 雙擊角色會開啟獨立 Conversation sidecar；header 的箭頭可切換左右位置。
- 拖曳 Conversation header 可自訂對話框位置；再次按左右箭頭可恢復停靠。
- 從 Control Window 選擇「散步」，寵物會在目前螢幕的可用範圍內水平走動。
- 開啟 Click-through 後 overlay 不接收滑鼠事件；需從 Control Window 或 menu bar 關閉 Click-through 才能再次拖曳。

### Pet Lab

Control Window 提供：

- 匯入、替換與移除 Pet ZIP
- Personality override 與安全預覽
- Codex／Claude Code provider 選擇、CLI 版本與訂閱登入狀態
- Conversation history 保存、retention、最大筆數與清除
- Pet memory 啟用狀態、最大筆數、CRUD、來源與更新時間
- Behavior、agent activity、autonomy、proactive conversation 與 desktop world 設定

Pet memory 的「停用」只代表不加入對話 context，不會刪除既有內容；只有刪除單項或 `Clear All Memory` 才會移除資料。

### Creator round trip

切換至 `Creator` 後，匯入或選擇一個 OpenPets 8×9 package，即可編輯 package metadata、逐列預覽 atlas、設定 frame／fps／loop、調整 semantic animation mapping、anchors、hitboxes 與預設 personality。幾何設定會疊加顯示在目前預覽 frame；`Advanced JSON` 仍保留給需要直接編輯 sidecar 的作者。以內建角色開始時會預設使用 `<id>-custom`，避免輸出一個無法覆寫內建 package 的 ID。

`Export installable ZIP` 會先執行與 runtime 相同的 sidecar／manifest 幾何驗證，再將編輯後的 `pet.json`、`deskling.json`、spritesheet 與引用的音效封裝成 `<pet-id>.zip`。輸出的檔案可直接透過 `Import Pet ZIP` 重新安裝；若 package ID 已存在，仍會走明確替換確認。
