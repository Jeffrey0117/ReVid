# ReVid 功能規劃

## 待實作功能清單

### Phase 1 — 快速見效

#### #6 播放速度預設
- **難度**: ⭐ 簡單
- **說明**: 工具列加入速度按鈕群組
- **實作**:
  - 在 viewer 工具列加入速度選擇器
  - 預設選項: 0.5x, 0.75x, 1x, 1.25x, 1.5x, 2x
  - 點擊切換，當前速度高亮顯示
  - 用 `video.playbackRate` 控制
- **UI**: 下拉選單或按鈕群組

#### #11 快捷鍵總覽面板
- **難度**: ⭐ 簡單
- **說明**: 按 `?` 鍵開啟快捷鍵說明 modal
- **實作**:
  - 新建 `KeyboardShortcutsModal.jsx`
  - 列出所有快捷鍵分類顯示
  - ESC 或點擊背景關閉
- **快捷鍵清單**:
  - 空白鍵: 播放/暫停
  - 左右鍵: 快退/快進 5 秒
  - 上下鍵: 音量調整
  - M: 靜音
  - F: 全螢幕
  - 等等...

---

### Phase 2 — 音訊增強

#### #2 音量增強器
- **難度**: ⭐ 簡單
- **說明**: 音量滑桿可超過 100%，最高 200%
- **實作**:
  - 建立 Web Audio API context
  - 用 `createMediaElementSource()` 連接 video
  - 建立 `GainNode` 控制增益
  - 0-100% 用原生 volume，100-200% 用 GainNode
- **注意**:
  - 超過 100% 可能造成破音，可加 DynamicsCompressorNode
  - Audio context 需要用戶互動後才能啟動

---

### Phase 3 — 進階播放

#### #4 A-B 循環
- **難度**: ⭐⭐ 中等
- **說明**: 選定影片區段無限循環播放
- **實作**:
  - 工具列加入 [A] [B] [清除] 按鈕
  - 點 [A] 標記起點，點 [B] 標記終點
  - 監聽 `timeupdate`，到達 B 點時跳回 A 點
  - 時間軸上顯示 A-B 區段高亮
- **狀態**:
  ```js
  const [loopRange, setLoopRange] = useState({ a: null, b: null });
  ```
- **UI**: 時間軸上用不同顏色標示循環區段

---

### Phase 4 — 內容輔助

#### #8 字幕載入
- **難度**: ⭐⭐ 中等
- **說明**: 載入外部 .srt / .vtt 字幕檔
- **實作**:
  - 工具列加入「載入字幕」按鈕
  - 支援拖放 .srt / .vtt 到播放器
  - .srt 需轉換成 .vtt 格式 (簡單的時間格式轉換)
  - 用 `<track>` 元素或自訂渲染層顯示
- **SRT → VTT 轉換**:
  ```js
  function srtToVtt(srt) {
    return 'WEBVTT\n\n' + srt
      .replace(/\r\n/g, '\n')
      .replace(/(\d{2}):(\d{2}):(\d{2}),(\d{3})/g, '$1:$2:$3.$4');
  }
  ```
- **字幕樣式**: 可調整字體大小、顏色、位置

#### #9 書籤/章節標記
- **難度**: ⭐⭐ 中等
- **說明**: 在時間軸上標記重要位置
- **實作**:
  - 雙擊時間軸新增書籤
  - 書籤可命名、編輯、刪除
  - 點擊書籤跳轉到該時間點
  - 儲存到 localStorage (以檔案路徑為 key)
- **資料結構**:
  ```js
  {
    "file:///path/to/video.mp4": [
      { time: 120.5, label: "重點開始", color: "#f59e0b" },
      { time: 300.0, label: "結論", color: "#3b82f6" }
    ]
  }
  ```
- **UI**:
  - 時間軸上顯示小三角形標記
  - Hover 顯示標籤名稱
  - 右鍵選單: 編輯/刪除

---

## 優先順序

1. ✅ Phase 1: #6 播放速度 + #11 快捷鍵面板
2. ⬜ Phase 2: #2 音量增強
3. ⬜ Phase 3: #4 A-B 循環
4. ⬜ Phase 4: #8 字幕 + #9 書籤

---

## 相關檔案

| 功能 | 需修改/新增的檔案 |
|------|------------------|
| 播放速度 | `App.jsx` (工具列), `i18n.jsx` |
| 快捷鍵面板 | `components/KeyboardShortcutsModal.jsx` (新), `App.jsx` |
| 音量增強 | `hooks/useAudioBoost.js` (新), `App.jsx` |
| A-B 循環 | `App.jsx`, 時間軸元件 |
| 字幕載入 | `utils/subtitles.js` (新), `App.jsx` |
| 書籤標記 | `hooks/useBookmarks.js` (新), 時間軸元件 |
