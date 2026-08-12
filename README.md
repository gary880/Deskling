# Deskling Desktop MVP

Deskling 的第一個可執行 Desktop Pet runtime。它依照《Deskling — Pet Asset & Avatar Architecture》實作 Manifest + WebP Spritesheet，並刻意讓 behavior、motion 與 sprite rendering 分離。

## 執行 Desktop App

```bash
npm install
npm run desktop
```

這會啟動兩個原生視窗：

- `control`：Pet Package Lab 與角色／behavior／desktop 設定。
- `pet`：無邊框、透明、置頂的桌面寵物 overlay。

關閉 Control Window 只會隱藏它；可從 macOS menu bar 的 Deskling icon 重新開啟、切換角色、顯示或隱藏寵物，以及退出程式。

純瀏覽器預覽仍可用 `npm run dev` 啟動。

驗證：

```bash
npm test
npm run build
cd src-tauri && cargo check
```

## 已完成範圍

- `deskling.json` package manifest 與 runtime validation
- WebP spritesheet renderer、語意動畫 ID 與 fallback
- `feet`、`head`、`speechBubble` anchors
- `body`、`head` hitboxes
- 左右朝向、點擊移動、拖曳與基礎 behavior preview
- Mochi 與 Bella developer-local packages
- Tauri v2 macOS shell、Control／Pet 雙視窗與 event sync
- 透明、無邊框、always-on-top overlay
- 原生視窗拖曳、螢幕 work area 邊界限制與位置保存
- Click-through mode 與 menu bar 控制
- macOS Accessibility 授權狀態、系統設定引導與未授權降級
- Active window 的位置／尺寸追蹤、跨螢幕與負座標支援
- 以 package `feet` anchor 對齊視窗上緣或 Desktop Floor
- `dragging > reacting > windowFollowing > roaming > sleeping > idle` 行為優先序

Pet catalog 位於 `public/pets/index.json`。新增角色時，建立含有 `deskling.json` 與 `spritesheet.webp` 的資料夾，再將 manifest URL 加進 catalog 即可。

目前優先支援 macOS。透明背景使用 Tauri 的 `macOSPrivateApi`，適合直接散佈與公證，但不符合 Mac App Store 的 private API 規則。正式 ZIP import 與其他平台的 window awareness 仍留在後續切片。

### Window-aware mode（macOS）

從 Control Window 的 `DESKTOP WORLD` 區塊開啟視窗感知模式與跟隨使用中視窗。Deskling 會請求 macOS「輔助使用」權限；授權後只讀取 focused window 的位置、尺寸、最小化狀態與所屬程序 ID，不讀取視窗內容、標題或鍵盤輸入，也不會追蹤 Deskling 自己的 Control／Pet 視窗。

未授權、目標關閉或最小化時，寵物會在啟用 `Desktop floor fallback` 的情況下回到目前螢幕底部；拖曳與既有 behavior 仍可使用。權限也可從 menu bar 的 `Accessibility` 項目重新開啟系統設定。

### Overlay 操作

- 按住角色的頭部或身體拖曳，即可移動桌面寵物。
- 短點頭部會播放 `happy` 反應。
- 從 Control Window 選擇「散步」，寵物會在目前螢幕的可用範圍內水平走動。
- 開啟 Click-through 後 overlay 不接收滑鼠事件；需從 Control Window 或 menu bar 關閉 Click-through 才能再次拖曳。
