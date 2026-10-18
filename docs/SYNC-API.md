# ReVid Sync API — v1 規格

> 狀態：草案（Draft）。後端獨立 repo `revid-sync`，跑在另一台電腦；ReVid 客戶端照這份規格接。
> 目標：登入 LetMeUse 後，**同一個帳號**的劇院資料夾（含音樂模式歌單）在多台電腦之間自動同步。

## 0. 待決定事項（實作前要定）

| # | 問題 | 暫定預設 |
|---|------|----------|
| Q1 | 後端對外怎麼連？公開網域 or 只限區網 | ✅ 已定：公開 HTTPS 網域（出門的電腦也能同步）。`BASE_URL` 做成設定值 |
| Q2 | 後端怎麼驗證 LetMeUse token？ | ✅ 已定：呼叫 LetMeUse 公開端點 `GET /api/auth/me`，見 §2 |
| Q3 | 播放進度要不要同步 | 要（獨立合併，見 §4.3），客戶端可關 |
| Q4 | 刪除標記保留多久 | 90 天後伺服器清除 |

## 1. 範圍

**同步：** 劇院資料夾、資料夾內的課程/歌曲、排序、音樂模式開關、封面、播放進度。

**不同步：**
- 各影片網站的登入 session / cookie（安全風險，各電腦自己登入）
- 本機影片（grid/viewer 模式的本機檔案路徑在別台電腦不存在）
- UI 偏好（主題、語言、視窗大小、置頂）——各電腦自己的

沒登入或連不到後端時，ReVid 跟現在一樣純本機運作，**同步失敗絕不能影響本機資料**。

## 2. 認證

- 所有 `/v1/*`（除了 `/v1/health`）都要 `Authorization: Bearer <LetMeUse JWT>`。
- 客戶端用現有的 `useLetMeUse()` 拿 token（`src/hooks/useLetMeUse.js`）。
- 伺服器用 `verifyToken(token) → { userId } | null` 驗證，做法是轉問 LetMeUse 的公開端點：

  ```
  GET https://letmeuse.isnowfriend.com/api/auth/me
  Authorization: Bearer <token>
  ```

  | LetMeUse 回應 | 伺服器處理 |
  |---------------|-----------|
  | `200`，body `{ data: { user } }` 或 `{ user }` | 通過，`userId = user.id` |
  | `401` `{"success":false,"error":"Missing or invalid authorization header"}` | 回 `401 UNAUTHORIZED` |
  | 逾時（5 秒）/ 5xx / 連不上 | 回 `503 SERVER_ERROR`（**不是** 401，避免客戶端誤以為被登出） |

  - LetMeUse 網址做成環境變數 `LETMEUSE_BASE_URL`（預設 `https://letmeuse.isnowfriend.com`）。
  - ⚠️ `user` 物件的 id 欄位名稱需用真實 token 確認一次（SDK 原始碼只看得到 `displayName`、`email`、`avatar`、`role`）。
    若沒有 `id`，改用 JWT payload 的 `sub`。**絕不用 email 當 userId**（email 可以改）。
  - 驗證結果用 `sha256(token)` 當 key 快取，存活時間 = min(5 分鐘, token 剩餘有效期)，避免每個請求都打 LetMeUse。
  - ReVid 目前用的 LetMeUse app id 是 `app_5qXx5Wtv`（與 RePic 共用，見 `index.html`）。
- 資料一律用 `userId` 隔離，**絕不信任 body 裡傳來的任何使用者 id**。
- access token 會過期，SDK 會在到期前 5 分鐘自動 refresh。客戶端每次同步都要用 `window.letmeuse.getToken()` 取**當下**的 token，不能用快取的舊 token。
- token 無效或過期 → `401`，客戶端先觸發 SDK refresh 重試一次；仍失敗才停止同步並提示重新登入（不清本機資料）。

## 3. 資料模型（線上傳輸格式）

所有時間都是 Unix 毫秒（`Date.now()`）。所有 id 是客戶端產生的字串（沿用現有 `generateId()`），全域唯一。

### 3.1 Folder

```json
{
  "id": "1792049904169-heb88xjej",
  "name": "Khalid - American Teen",
  "platform": "custom",
  "musicMode": true,
  "cover": "https://img.youtube.com/vi/xxxx/hqdefault.jpg",
  "courseOrder": ["courseId1", "courseId2"],
  "createdAt": 1792049904169,
  "updatedAt": 1792050000000,
  "deletedAt": null
}
```

- `courseOrder`：資料夾內歌曲順序。不在清單裡的歌，依 `addedAt` 排在最後（兩台同時新增歌也不會丟）。
- `deletedAt`：刪除標記。**客戶端的 `deleteFolder` 要改成設標記，不能直接從陣列移除**（目前是 `filter` 掉，同步會分不出「刪了」還是「還沒同步到」）。
- `cover` 如果是 data URI，上限 256 KB，超過就不同步封面（保留本機）。

### 3.2 Course（一首歌 / 一堂課）

```json
{
  "id": "1792049935170-ujvd4b8d7",
  "folderId": "1792049904169-heb88xjej",
  "url": "https://www.youtube.com/watch?v=0NChtZCDCsY",
  "title": "Khalid - American Teen (Official Video)",
  "thumbnail": "https://img.youtube.com/vi/0NChtZCDCsY/mqdefault.jpg",
  "platform": "youtube",
  "clickPath": [],
  "addedAt": 1792049935170,
  "updatedAt": 1792049935170,
  "deletedAt": null,
  "progress": {
    "lastPosition": 226.3,
    "duration": 229,
    "lastWatched": 1792050259348,
    "completed": false
  }
}
```

- `updatedAt` 只在**內容**改變時更新（改名、改網址、縮圖、刪除、搬資料夾）。播放進度變動**不**更新 `updatedAt`。
- `thumbnail` 如果是 data URI，上限 256 KB。
- 單筆紀錄（序列化後）上限 512 KB，超過回 `413`。

### 3.3 客戶端需要新增的本機欄位

| 欄位 | 位置 | 用途 |
|------|------|------|
| `updatedAt` | folder、course | 合併依據。舊資料沒有 → 用 `createdAt` / `addedAt` 補 |
| `deletedAt` | folder | 刪除標記 |
| `courseOrder` | folder | 排序同步（本機仍可用陣列順序，上傳時產生） |
| `sync.deviceId` | `theater-data.json` 旁的 `sync-state.json` | 每台電腦一個隨機 id |
| `sync.cursor` | 同上 | 上次拉到的伺服器序號 |
| `sync.userId` | 同上 | 換帳號時用來判斷要不要重來 |

## 4. 合併規則

伺服器和客戶端用**同一套**規則，結果才會一致。

### 4.1 Folder / Course 內容：Last-Write-Wins（逐筆）

比較兩邊的 `updatedAt`，大的贏，整筆內容（progress 除外）用贏的那邊。
相等時比較兩邊內容的穩定 JSON（key 排序後）字串，大的贏——紀錄裡沒有存 deviceId，用內容比較一樣能保證每台算出同一個結果。
贏的那邊缺少的欄位（例如超過大小沒同步的封面）保留輸的那邊的值。

> 參考實作：`src/utils/syncMerge.js`（`mergeFolder` / `mergeCourse` / `mergeProgress`），
> 後端請直接沿用同一套邏輯；`dev/mock-sync-server/core.mjs` 是照本規格寫的記憶體版伺服器。

### 4.2 刪除

刪除就是設 `deletedAt` 並更新 `updatedAt`，照 4.1 合併。被刪掉的紀錄繼續同步，客戶端顯示時過濾掉（現有 course 已經這樣做）。
伺服器在 `deletedAt` 超過 90 天後才真正清除（Q4）。

### 4.3 播放進度：獨立合併

`progress` 不跟著 4.1，而是比 `progress.lastWatched`，大的贏。
這樣 A 電腦改歌名、B 電腦同時在聽這首歌，兩邊的改動都會保留。

### 4.4 時鐘誤差

LWW 依賴各電腦的時鐘。個人用多台電腦，誤差通常是秒級，可以接受。
伺服器在回應標頭帶 `X-Server-Time`，客戶端若發現本機時鐘差超過 60 秒，在設定頁顯示警告。

## 5. API

Base URL：`{BASE_URL}/v1`。Request / Response 一律 JSON（`Content-Type: application/json`）。

### 5.1 共用回應格式

```json
{ "success": true, "data": { } }
{ "success": false, "error": "human readable message", "code": "UNAUTHORIZED" }
```

| HTTP | code | 意思 / 客戶端處理 |
|------|------|-------------------|
| 400 | `BAD_REQUEST` | 格式錯 → 記 log，不重試 |
| 401 | `UNAUTHORIZED` | token 無效 → 停同步、提示重新登入 |
| 413 | `TOO_LARGE` | body > 5 MB 或單筆 > 512 KB → 拆小批 / 跳過該筆 |
| 429 | `RATE_LIMITED` | 依 `Retry-After` 等待 |
| 500/503 | `SERVER_ERROR` | 指數退避重試（5s → 10s → … 最多 5 分鐘） |

錯誤訊息不得洩漏內部資訊（stack trace、SQL、檔案路徑）。

### 5.2 `GET /v1/health`

不用登入。回 `{ "success": true, "data": { "version": "1.0.0", "time": 1792050000000 } }`。
客戶端用來判斷後端是否可用。

### 5.3 `GET /v1/me`

回目前 token 對應的使用者，客戶端登入後先打一次確認後端認得這個帳號。

```json
{ "success": true, "data": { "userId": "u_123" } }
```

### 5.4 `GET /v1/sync?since={cursor}&limit={n}`

拉取 `since` 之後伺服器上有變動的紀錄。第一次 `since=0` 等於拉全部。

- `limit` 預設 500，上限 1000
- 回傳依伺服器序號（`seq`）排序

```json
{
  "success": true,
  "data": {
    "folders": [ { "...Folder": "" } ],
    "courses": [ { "...Course": "" } ],
    "cursor": 1234,
    "hasMore": false
  }
}
```

`hasMore: true` 時用新的 `cursor` 繼續拉，直到 `false`。

### 5.5 `POST /v1/sync`

上傳本機有變動（dirty）的紀錄。伺服器逐筆用 §4 規則合併。

Request：

```json
{
  "deviceId": "d_8f3a...",
  "folders": [ { "...Folder": "" } ],
  "courses": [ { "...Course": "" } ]
}
```

Response：

```json
{
  "success": true,
  "data": {
    "accepted": 12,
    "conflicts": {
      "folders": [],
      "courses": [ { "...伺服器版本較新的完整紀錄": "" } ]
    },
    "cursor": 1240
  }
}
```

- `conflicts`：伺服器版本贏的紀錄，回傳伺服器上的**完整版本**，客戶端直接套用。
- 每筆被接受（有改變）的紀錄，伺服器指派新的 `seq`。
- 伺服器驗證：`id` 必填且 ≤ 64 字元；`url` 必須是 `http(s)://`；`name`/`title` ≤ 500 字元；時間戳是合理正整數；未知欄位丟掉不存。
- `course.folderId` 指向不存在的資料夾 → 照樣存（另一台可能晚點才上傳資料夾），客戶端顯示時忽略孤兒。

### 5.6 Rate limit

每個 `userId` 每分鐘 60 次請求，超過回 `429` + `Retry-After`。

## 6. 客戶端同步流程

### 6.1 什麼時候同步

| 時機 | 動作 |
|------|------|
| 登入成功 / app 啟動（已登入） | push dirty → pull since cursor |
| 本機內容變動（新增、改名、刪除、排序、音樂模式、封面） | 標 dirty，3 秒 debounce 後 push → pull |
| 播放進度變動 | 標 dirty，最多每 30 秒 push 一次；關閉 app 前 push 一次（盡力） |
| app 開著時 | 每 5 分鐘 pull 一次 |
| 視窗重新取得焦點 | pull（距上次 > 30 秒才打） |

順序永遠是 **先 push 再 pull**，pull 的結果照 §4 合併進本機，再寫回 `theater-data.json`（沿用現有 atomic 寫入）。

### 6.2 第一次登入（本機已有資料）

1. `since=0` 把雲端全部拉下來
2. 雲端和本機照 §4 合併（同 id 照規則，不同 id 兩邊都保留）
3. 把本機有、雲端沒有的全部 push 上去

→ **兩台電腦各自累積的資料夾都會保留，不會互相覆蓋。**

### 6.3 登出 / 換帳號

- 登出：停止同步，本機資料保留。
- 換成另一個帳號（`sync.userId` 不同）：清掉 `cursor`，照 6.2 重新合併。

### 6.4 實作位置

- 同步的網路請求放 main process（`electron/sync-client.cjs`），經 `ipcMain.handle` / `preload.cjs` 暴露給 renderer，跟現有架構一致。
- token 由 renderer 傳給 main（同現有 `uploadToPokkit` 做法）。
- 合併規則寫成純函式（`mergeFolder`、`mergeCourse`、`mergeProgress`），前後端共用同一份邏輯並各自寫單元測試。

## 7. 後端參考實作（`revid-sync`）

- Node.js + Express（或 Fastify）+ SQLite（`better-sqlite3`），單一行程即可
- 設定全部走環境變數：`PORT`、`DB_PATH`、`LETMEUSE_BASE_URL`、`CORS_ORIGIN`
- 公開部署必須 HTTPS（反向代理或 CloudPipe）

### 7.1 SQLite schema

```sql
CREATE TABLE records (
  user_id     TEXT    NOT NULL,
  kind        TEXT    NOT NULL CHECK (kind IN ('folder', 'course')),
  id          TEXT    NOT NULL,
  data        TEXT    NOT NULL,          -- JSON（Folder / Course）
  updated_at  INTEGER NOT NULL,
  deleted_at  INTEGER,
  seq         INTEGER NOT NULL,          -- 每個 user 遞增，用於 cursor
  PRIMARY KEY (user_id, kind, id)
);
CREATE INDEX idx_records_seq ON records (user_id, seq);

CREATE TABLE user_seq (
  user_id TEXT PRIMARY KEY,
  seq     INTEGER NOT NULL DEFAULT 0
);
```

- 一次 `POST /v1/sync` 在**單一 transaction** 裡完成：逐筆合併 → 有變動的 `seq = ++user_seq`。
- 一律 parameterized query。

### 7.2 後端驗收清單

- [ ] `verifyToken` 轉問 LetMeUse `/api/auth/me`：通過、401、LetMeUse 掛掉（→ 503）三條路徑都有測試（mock LetMeUse）
- [ ] 用真實 token 確認 `user.id` 欄位名稱
- [ ] §4 合併規則單元測試（LWW、相等決勝、刪除、progress 獨立合併）
- [ ] 不同使用者資料完全隔離的測試
- [ ] `since` 分頁（`hasMore`）測試
- [ ] 輸入驗證 + 大小限制 + rate limit
- [ ] 錯誤回應不洩漏內部資訊

## 8. 版本

- 路徑帶 `/v1`。破壞性變更開 `/v2`，`/v1` 至少保留到所有客戶端更新。
- 客戶端在 `GET /v1/health` 的 `version` 主版號不相容時，停止同步並提示更新 ReVid。
