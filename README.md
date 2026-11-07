# LINE AI 待辦小秘書（W6／W7 專題）

結合 LINE Messaging API、Google Apps Script、Gemini 與本機 Ollama Gemma 模型的 AI 助理。

本專題從 W6 的 LINE Bot 輕量版出發，在 W7 加入 Google Apps Script 與 Node.js 本機模型轉接站，讓使用者能透過 LINE 管理日常待辦，也能使用本機 AI 進行網頁搜尋與回答。

GitHub Repository：https://github.com/Ted411124/line_bot_lite

---

## 一、專案功能

### 原有功能

- **AI 待辦辨識：** 使用者傳送文字，透過 Gemini 辨識待辦事項。
- **照片辨識：** 傳送活動海報、便條紙等照片，由 AI 判斷是否包含待辦事項。
- **Google 試算表：** 自動記錄待辦內容、分類、日期及時間。
- **Google Drive：** 保存使用者傳送的照片。
- **Google 日曆：** 有明確日期與時間的待辦事項，可建立日曆提醒。

### W7 新增功能

- **本機 Gemma AI 搜尋：** 透過 Ollama 在自己的電腦執行 Gemma 模型。
- **網頁搜尋：** 模型可依問題需要使用網頁搜尋及網頁讀取工具。
- **來源回傳：** 回覆時附上實際取得的網頁標題與網址。
- **Cloudflare Tunnel：** 建立外部 HTTPS 通道，讓 Google Apps Script 能連接使用者電腦上的 Relay。
- **錯誤處理：** 本機搜尋服務無法使用時，明確通知使用者，不會自動改用 Gemini 代替搜尋。

---

## 二、W7 系統架構

使用者透過 LINE 傳送搜尋問題後，系統依照以下流程處理：

```text
使用者
  │
  ▼
LINE Messaging API
  │
  ▼
Google Apps Script（GAS）
  │
  ▼
Cloudflare Tunnel
  │
  ▼
Node.js Relay
  │
  ▼
Ollama
  │
  ▼
Gemma 4 E4B
  │
  ├── 模型自行判斷是否需要搜尋
  │
  ├── web_search：搜尋網頁
  │
  └── web_fetch：讀取網頁內容
  │
  ▼
整理回答與參考來源
  │
  ▼
透過 LINE 回覆使用者
```

### 技術分工

| 技術 | 負責工作 |
|---|---|
| LINE Messaging API | 接收與回覆使用者訊息 |
| Google Apps Script | 處理 LINE Webhook、待辦及搜尋分流 |
| Gemini | 原有待辦文字與照片辨識 |
| Google Sheets | 保存待辦資料 |
| Google Drive | 保存照片 |
| Google Calendar | 建立行事曆提醒 |
| Node.js | 執行本機搜尋轉接站 |
| Ollama | 在本機執行 AI 模型 |
| Gemma 4 E4B | 回答問題及判斷搜尋需求 |
| Cloudflare Tunnel | 讓雲端 GAS 連接本機 Relay |

---

## 三、LINE 使用方式

### 1. 一般待辦事項

直接傳送自然語言，例如：

- 提醒我明天下午三點交作業
- 週五前記得繳交報告
- 明天上午十點要開會

系統會辨識待辦內容，並依照日期與時間記錄至 Google 試算表；符合條件時也會建立 Google 日曆提醒。

### 2. 照片辨識

直接傳送活動海報、便條紙或其他包含待辦資訊的照片。

系統會透過 AI 判斷照片內容，並在辨識到待辦事項時進行記錄。

### 3. W7 本機 AI 搜尋

使用以下明確指令：

| 指令格式 | 範例 |
|---|---|
| 查 關鍵字 | 查 台灣歷史 |
| 搜尋 關鍵字 | 搜尋 人工智慧最新發展 |
| 查：關鍵字 | 查：世界史 |
| 搜尋：關鍵字 | 搜尋：2026年諾貝爾物理獎得主 |

搜尋問題會直接交給本機 Gemma 模型處理，不會寫入待辦試算表。

一般聊天及待辦訊息仍維持原有處理方式。

---

## 四、專案檔案結構

```text
line_bot_lite/
│
├── README.md
│
└── line-bot-lite/
    │
    ├── line_bot_lite.py
    │
    ├── Code.gs
    │
    └── line-search-relay.mjs
```

### 檔案說明

| 檔案 | 功能 |
|---|---|
| `line_bot_lite.py` | W6 Python 本機 LINE Bot 輕量版 |
| `Code.gs` | W7 Google Apps Script 主程式 |
| `line-search-relay.mjs` | W7 Node.js 本機 Gemma 搜尋轉接站 |
| `README.md` | 專案說明與操作文件 |

---

## 五、執行環境與需求

W7 系統需要以下軟體：

1. Windows 或其他支援環境。
2. Node.js。
3. Ollama。
4. Gemma 4 E4B 模型。
5. Cloudflare Tunnel（cloudflared）。
6. LINE Messaging API 帳號與 Channel 設定。
7. Google Apps Script。
8. Google 試算表、Google Drive 及 Google 日曆。
9. 可使用 Gemini API 的 Google AI Studio 設定。

下載本機模型：

```powershell
ollama pull gemma4:e4b
```

確認模型是否已安裝：

```powershell
ollama list
```

---

## 六、W7 本機 Relay 啟動方式

先確認 Ollama 已經啟動，並且 Gemma 4 E4B 模型已安裝。

開啟 PowerShell，進入程式所在資料夾：

```powershell
cd "$env:USERPROFILE\OneDrive\Desktop\line_bot_lite\line-bot-lite"
```

啟動 Relay：

```powershell
node .\line-search-relay.mjs
```

程式會執行以下工作：

1. 啟動 Node.js 本機轉接服務。
2. 載入 Ollama 的 Gemma 4 E4B 模型。
3. 自動建立 Cloudflare Tunnel。
4. 產生本次連線所需的 HTTPS 網址。
5. 提供 GAS 所需的 Relay 網址及驗證金鑰設定資訊。

**重要：**

- Relay 執行期間，PowerShell 視窗必須保持開啟。
- 關閉 Relay 或按下 `Ctrl + C`，LINE 就無法繼續連接本機搜尋服務。
- Cloudflare Quick Tunnel 的網址每次重新啟動可能改變。
- 網址改變後，需要更新 Google Apps Script 的指令碼屬性。
- Relay 不需要另外安裝 npm 套件，使用 Node.js 內建功能。

---

## 七、Google Apps Script 設定

在 Google Apps Script 的「專案設定 → 指令碼屬性」中設定必要資料。

| 屬性名稱 | 用途 |
|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | LINE Messaging API 存取權杖 |
| `GEMINI_API_KEY` | Gemini API 金鑰 |
| `SHEET_ID` | Google 試算表 ID |
| `SEARCH_RELAY_URL` | 本機 Relay 的 Cloudflare HTTPS 網址 |
| `SEARCH_RELAY_KEY` | 本機 Relay 驗證金鑰 |

`GEMINI_MODEL` 可選擇設定，未設定時程式使用預設模型。

完成設定後，將 Apps Script 部署為網頁應用程式，並將部署網址設定為 LINE Developers 的 Webhook URL。

Relay 網址每次重新啟動後可能改變，因此需要同步更新 `SEARCH_RELAY_URL`。

---

## 八、安全性與注意事項

- API Key、LINE Channel Access Token、Channel Secret 與 Relay 驗證金鑰不應公開。
- 金鑰應存放於 Google Apps Script 指令碼屬性或本機安全位置。
- 不應將 `.env`、金鑰檔案或其他機密資料推送到 GitHub。
- Relay 使用獨立驗證金鑰，只有帶有正確驗證資訊的請求才能使用搜尋功能。
- Relay 只監聽本機介面，再透過 Cloudflare Tunnel 提供外部連線。
- 本機電腦必須保持開機、Ollama 正常運作，且 Relay 與 Tunnel 保持連線，W7 搜尋功能才能使用。
- 本機搜尋失敗時，系統不會自動改用 Gemini 搜尋。

---

## 九、W7 實際測試成果

本專題已完成以下功能測試：

- LINE 可以正常接收及回覆訊息。
- 一般文字待辦可以辨識並記錄至 Google 試算表。
- 有明確日期與時間的待辦可以進行 Google 日曆提醒。
- 照片可以進行 AI 辨識。
- 使用「查」及「搜尋」指令可以呼叫本機 Gemma。
- Gemma 可以依問題需要進行網頁搜尋。
- 搜尋結果可以附上來源標題及網址。
- 關閉本機 Relay 後，一般待辦功能仍可正常使用。
- 本機搜尋服務無法使用時，系統會顯示錯誤提示，不會改用 Gemini 代替。

---

## 十、專題目標

本專題希望透過 AI、LINE 與 Google 雲端服務的整合，建立一個方便使用者日常管理課業及生活事項的智慧助理。

W6 著重於本機 AI 與 LINE 的基本整合；W7 則進一步加入 Google Apps Script、Node.js、Cloudflare Tunnel 與本機 Gemma 網頁搜尋，使系統同時具備雲端待辦管理與本機 AI 搜尋能力。

透過這次實作，了解 LINE Messaging API、Webhook、API 串接、本機大型語言模型、網頁搜尋工具及雲端服務整合的實際應用。

---

**作者：Ted411124**

**GitHub：** https://github.com/Ted411124/line_bot_lite