# Deskling — Pet Asset & Avatar Architecture

## Avatar Strategy

Deskling MVP 採用：

```text
Manifest
+
Spritesheet
```

作為角色素材架構。

MVP **不使用 Live2D**。

原因：

- Deskling 的核心差異不是角色渲染技術。
- Cursor / Window / Drag / Sleep / Roaming 等互動不需要 Live2D。
- Spritesheet 的製作、匯入與分享成本更低。
- 更適合建立簡單的 user-generated pet package。
- 可以優先投入 Window-aware interaction 與 proactive behavior。
- 避免 MVP 過早綁定第三方動畫 runtime 與授權模式。

核心原則：

> **Behavior defines what the pet is doing.  
> Renderer only decides how it looks.**

---

# Pet Package

每一隻 Deskling 都是一個獨立的 Pet Package。

建議格式：

```text
my-pet/
├── deskling.json
├── spritesheet.webp
├── thumbnail.webp
│
└── sounds/
    ├── happy.wav
    ├── annoyed.wav
    └── sleep.wav
```

其中只有：

```text
deskling.json
spritesheet.webp
```

為必要檔案。

其他 asset 皆為 optional。

---

# Pet Manifest

`deskling.json` 描述角色：

- metadata
- renderer
- animations
- anchors
- hitboxes
- optional sounds

Example:

```json
{
  "schemaVersion": 1,

  "id": "mochi",
  "name": "Mochi",
  "author": "Gary",

  "renderer": {
    "type": "sprite",
    "asset": "spritesheet.webp",
    "frameWidth": 192,
    "frameHeight": 208
  },

  "animations": {
    "idle": {
      "row": 0,
      "frames": 6,
      "fps": 6,
      "loop": true
    },

    "walk": {
      "row": 1,
      "frames": 8,
      "fps": 10,
      "loop": true
    },

    "sleep": {
      "row": 2,
      "frames": 4,
      "fps": 3,
      "loop": true
    },

    "look": {
      "row": 3,
      "frames": 4,
      "fps": 6,
      "loop": false
    },

    "thinking": {
      "row": 4,
      "frames": 6,
      "fps": 5,
      "loop": true
    },

    "talking": {
      "row": 5,
      "frames": 4,
      "fps": 8,
      "loop": true
    },

    "happy": {
      "row": 6,
      "frames": 6,
      "fps": 8,
      "loop": false
    },

    "annoyed": {
      "row": 7,
      "frames": 5,
      "fps": 6,
      "loop": false
    }
  },

  "anchors": {
    "feet": [96, 200],
    "head": [96, 40],
    "speechBubble": [110, 30]
  },

  "hitboxes": {
    "body": {
      "x": 42,
      "y": 38,
      "width": 108,
      "height": 158
    },

    "head": {
      "x": 55,
      "y": 18,
      "width": 82,
      "height": 76
    }
  }
}
```

---

# Animation Semantics

Deskling 的 Behavior Engine 不應該知道 sprite row 或 frame。

Bad:

```ts
sprite.playRow(4);
```

Good:

```ts
pet.play("thinking");
```

資料流：

```text
Desktop Event
     ↓
Behavior Engine
     ↓
Pet Behavior
     ↓
Animation Resolver
     ↓
Animation ID
     ↓
Sprite Renderer
```

例如：

```text
User idle
↓
PetBehavior.sleeping
↓
"sleep"
↓
SpriteRenderer
```

AI：

```text
Codex starts reasoning
↓
AgentEvent.thinking
↓
PetBehavior.thinking
↓
"thinking"
↓
SpriteRenderer
```

---

# Core Animation Set

MVP Pet Package 應至少支援：

```text
idle
walk
sleep
thinking
talking
happy
```

建議額外：

```text
look
wake
surprised
annoyed
```

如果素材缺少某個 animation，runtime 必須 fallback。

Example:

```text
annoyed
↓
not available
↓
surprised
↓
not available
↓
idle
```

角色不能因為缺 animation 而 crash。

---

# Anchor System

Anchor 是 Deskling 與 Desktop World 互動的重要基礎。

MVP 支援：

```text
feet
head
speechBubble
```

## Feet

用來處理：

```text
Window edge sitting
Desktop floor positioning
Landing
Walking
```

例如：

```text
Pet feet anchor
       ↓
Active Window top edge
```

而不是把 sprite bounding box 直接對齊。

---

## Head

用來處理：

```text
Cursor awareness
Future touch interactions
Visual attention
```

---

## Speech Bubble

控制 bubble 相對 Pet 的定位。

```text
          ╭─────────────╮
          │ Hello!      │
          ╰──────┬──────╯
                 │
               🐱
```

不同 Pet 不需要擁有相同身形比例。

---

# Hitbox System

Hitbox 不應直接等於 sprite rectangle。

Deskling MVP 支援：

```text
body
head
```

用途：

```text
click body
→ normal interaction

click head
→ reaction

drag body
→ pick up pet

cursor near head
→ look at cursor
```

未來可以新增：

```text
tail
hand
special
```

但不屬於 MVP。

---

# Motion vs Animation

Deskling 必須將：

```text
角色在桌面上的移動
```

與：

```text
角色自身動畫
```

分離。

Architecture:

```text
                 Pet
                  │
        ┌─────────┴─────────┐
        │                   │
   Motion Engine      Avatar Renderer
        │                   │
 position / velocity      frames
 gravity                  animation
 destination              expression
 window anchor
```

例如 walking：

```text
Motion Engine
→ update x position

Sprite Renderer
→ play "walk"
```

兩個 subsystem 同步運作，但彼此不應直接控制。

---

# Motion Engine

MVP Motion Engine 負責：

```text
position
velocity
direction
target
window anchor
basic movement
```

Future:

```text
gravity
bounce
jump
fall
collision
```

複雜 physics 不屬於 MVP。

---

# Renderer Interface

即使 MVP 只有 Sprite，也保留 renderer abstraction。

```ts
interface AvatarRenderer {
  load(asset: AvatarPackage): Promise<void>;

  play(animation: AnimationId): void;

  setFacing(direction: "left" | "right"): void;

  hitTest(point: Point): HitRegion | null;

  getAnchor(name: AnchorName): Point | null;
}
```

MVP：

```text
AvatarRenderer
└── SpriteRenderer
```

這個 abstraction 的目的不是現在支援多種 renderer。

而是避免：

```text
Behavior Engine
Space Engine
Desktop Interaction
```

依賴 spritesheet implementation。

---

# User Pet Import

未來使用者可以匯入：

```text
.zip
```

內容：

```text
deskling.json
spritesheet.webp
thumbnail.webp
```

流程：

```text
Import
↓
Validate manifest
↓
Validate assets
↓
Preview
↓
Install Pet
```

Pet 儲存在：

```text
~/Library/Application Support/Deskling/pets/
```

MVP 可以先支援 developer-local package。

正式 user import 可以放到 Post-MVP。

---

# Package Validation

Deskling 必須驗證：

```text
schemaVersion
unique id
asset existence
frame dimensions
animation frame range
anchor bounds
hitbox bounds
```

非法 package：

```text
Invalid Pet Package
```

而不是讓 renderer runtime crash。

---

# Live2D Decision

Live2D **不屬於目前產品藍圖的必要技術**。

Deskling 不再規劃：

```text
MVP
↓
Live2D
```

而是：

```text
MVP
↓
Sprite Package
↓
Validate Desktop Interaction
↓
Validate User-created Pets
```

只有未來出現以下需求時才重新評估 Live2D：

```text
high-fidelity character movement
face tracking
continuous expression blending
lip sync
VTuber-oriented character packs
```

即使未來加入，也應實作為：

```text
Live2DRenderer implements AvatarRenderer
```

而不是修改 Behavior Engine。

---

# MVP Asset Scope

MVP：

```text
✓ Manifest-based Pet Package
✓ WebP spritesheet
✓ SpriteRenderer
✓ Animation fallback
✓ Feet anchor
✓ Head anchor
✓ Speech bubble anchor
✓ Body hitbox
✓ Head hitbox
✓ Left / right facing
```

暫時不做：

```text
✗ Live2D
✗ VRM
✗ 3D
✗ skeletal animation
✗ face tracking
✗ lip sync
✗ avatar marketplace
✗ remote pet repository
✗ complex physics
```

---

# Product Principle

Deskling 的角色系統最終應該達成：

> **Creating a Deskling should be closer to making a sprite pack than developing an application.**

使用者不應需要知道：

```text
React
Tauri
Rust
Animation Engine
AI Provider
```

只需要準備：

```text
spritesheet
+
manifest
```

就能讓自己的角色活在桌面上。