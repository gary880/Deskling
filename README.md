# Deskling MVP

Deskling 的第一個可執行 Pet Package runtime。它依照《Deskling — Pet Asset & Avatar Architecture》實作 Manifest + WebP Spritesheet，並刻意讓 behavior、motion 與 sprite rendering 分離。

## 執行

```bash
npm install
npm run dev
```

驗證：

```bash
npm test
npm run build
```

## 已完成範圍

- `deskling.json` package manifest 與 runtime validation
- WebP spritesheet renderer、語意動畫 ID 與 fallback
- `feet`、`head`、`speechBubble` anchors
- `body`、`head` hitboxes
- 左右朝向、點擊移動、拖曳與基礎 behavior preview
- Mochi 與 Bella developer-local packages

Pet catalog 位於 `public/pets/index.json`。新增角色時，建立含有 `deskling.json` 與 `spritesheet.webp` 的資料夾，再將 manifest URL 加進 catalog 即可。

目前是 browser runtime，以便先驗證 package 與互動模型；Tauri desktop shell、正式 ZIP import 與 OS window awareness 留在下一個切片。
