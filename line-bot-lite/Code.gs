/**
 * LINE AI 待辦小秘書（Level 2：文字＋照片＋W7 本機 Gemma 網頁搜尋）
 *
 * 原有功能：
 *   Gemini 待辦辨識、試算表、照片、Google Drive、Google 日曆
 *
 * W7 新增功能：
 *   LINE → GAS → Cloudflare Tunnel → Node.js Relay → Ollama Gemma
 *
 * 搜尋指令：
 *   查 關鍵字
 *   搜尋 關鍵字
 *   查：關鍵字
 *   搜尋：關鍵字
 *
 * 搜尋訊息不會寫入待辦試算表。
 * 本機搜尋失敗時不會改用 Gemini。
 */

// ===== 1. 設定 =====
const PROPS = PropertiesService.getScriptProperties();

const GEMINI_API_KEY = PROPS.getProperty("GEMINI_API_KEY") || "";
const LINE_ACCESS_TOKEN = PROPS.getProperty("LINE_CHANNEL_ACCESS_TOKEN") || "";
const SHEET_ID = PROPS.getProperty("SHEET_ID") || "";

// Gemini 模型
const GEMINI_MODEL = PROPS.getProperty("GEMINI_MODEL") || "gemini-3.5-flash-lite";

// W7 本機搜尋轉接站設定
const SEARCH_RELAY_URL = (PROPS.getProperty("SEARCH_RELAY_URL") || "")
  .trim()
  .replace(/\/+$/, "");

const SEARCH_RELAY_KEY = (PROPS.getProperty("SEARCH_RELAY_KEY") || "").trim();

// 只辨識明確的搜尋指令，不誤判一般對話
const SEARCH_PREFIX = /^(?:查|搜尋)(?:\s+|[：:]\s*)([\s\S]+)$/;

const TZ = "Asia/Taipei";

const CATEGORIES = ["繳費", "會議", "課業", "生活", "其他"];

const HEADERS = [
  "建立時間",
  "事項",
  "分類",
  "日期",
  "時間",
  "來源",
  "日曆",
  "照片連結"
];

const GREETING = /^(hi|hello|hey|你好|嗨|哈囉|安安|早安|午安|晚安|謝謝|感謝|ok|好的|掰|bye|test|測試)$/i;

const HELP_TEXT = "你好！我是你的 AI 待辦小秘書 🤖\n\n直接傳給我：\n•「明天下午三點要開會」\n•「週五前記得繳房租」\n• 或拍一張活動海報、便條紙\n\n我會記進試算表；有日期和時間的，再幫你排進 Google 日曆。\n\n另外也可以使用：\n•「查 台灣歷史」\n•「搜尋 人工智慧最新發展」\n•「查：世界史」";


// ===== 2. LINE 送訊息進來的入口 =====

function doPost(e) {
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || "{}");

    // LINE 後台按 Verify 時，events 是空的
    (body.events || []).forEach(handleEvent);

  } catch (err) {
    console.error("讀不懂 LINE 送來的內容：", err);
  }

  return ContentService.createTextOutput("OK");
}


// 用瀏覽器打開 /exec 網址確認部署狀態
function doGet() {
  return ContentService.createTextOutput(
    "LINE AI 待辦小秘書運作中（Level 2 + W7）"
  );
}


// 一次處理一則訊息
function handleEvent(event) {
  if (event.type !== "message" || !event.replyToken) return;

  try {
    const msg = event.message;

    if (msg.type === "text") {
      const text = msg.text.trim();

      // ① 打招呼
      if (GREETING.test(text)) {
        return replyLine(event.replyToken, HELP_TEXT);
      }

      // ② W7 本機 Gemma 搜尋指令
      const searchMatch = text.match(SEARCH_PREFIX);

      if (searchMatch) {
        const question = searchMatch[1].trim();

        if (!question) {
          return replyLine(
            event.replyToken,
            "請在「查」或「搜尋」後面輸入想查詢的內容。"
          );
        }

        showLoading(event.source);

        // 直接交給本機搜尋，不經過 Gemini，也不寫入待辦試算表
        const result = askLocalSearch(question);

        return replyLine(event.replyToken, result);
      }

      // ③ 一般文字仍使用原本的 Gemini 待辦功能
      showLoading(event.source);

      return saveAndReply(
        event.replyToken,
        askGeminiAboutText(text),
        "文字"
      );
    }

    // ④ 照片仍使用原本的功能
    if (msg.type === "image") {
      showLoading(event.source);

      const image = downloadLineImage(msg.id);

      const photoUrl = savePhotoToDrive(image);

      return saveAndReply(
        event.replyToken,
        askGeminiAboutImage(image),
        "照片",
        photoUrl
      );
    }

    replyLine(
      event.replyToken,
      "目前我看得懂文字和照片，其他類型還不行喔。"
    );

  } catch (err) {
    console.error("處理訊息失敗：", err);

    try {
      replyLine(
        event.replyToken,
        "⚠️ 出錯了：" + err.message
      );

    } catch (err2) {
      console.error(
        "連錯誤訊息都回不出去（多半是 LINE token 沒設定或貼錯）：",
        err2
      );
    }
  }
}


// ===== 3. W7 本機 Gemma 網頁搜尋 =====

function askLocalSearch(question) {
  try {
    // 確認轉接站設定
    if (!SEARCH_RELAY_URL) {
      throw new Error("尚未設定 SEARCH_RELAY_URL");
    }

    if (!SEARCH_RELAY_KEY) {
      throw new Error("尚未設定 SEARCH_RELAY_KEY");
    }

    // 呼叫 Node.js Relay
    const response = UrlFetchApp.fetch(
      SEARCH_RELAY_URL + "/ask",
      {
        method: "post",

        contentType: "application/json",

        headers: {
          "x-relay-key": SEARCH_RELAY_KEY
        },

        payload: JSON.stringify({
          question: question
        }),

        muteHttpExceptions: true,
        timeoutSeconds: 50
      }
    );

    const statusCode = response.getResponseCode();
    const responseText = response.getContentText();

    // Relay 回應錯誤
    if (statusCode !== 200) {
      console.error(
        "本機搜尋轉接站錯誤：",
        statusCode,
        responseText
      );

      throw new Error("本機搜尋轉接站回應錯誤（HTTP " + statusCode + "）");
    }

    // 解析 Relay 回傳的 JSON
    const data = JSON.parse(responseText);

    const answer = String(data.answer || "").trim();

    if (!answer) {
      throw new Error("本機模型沒有提供有效回答");
    }

    // 整理搜尋來源
    const sources = Array.isArray(data.sources)
      ? data.sources
      : [];

    let result = "🔎 本機 Gemma 搜尋結果\n\n";
    result += answer;

    if (sources.length > 0) {
      result += "\n\n📚 參考來源：";

      sources.slice(0, 5).forEach(function(source, index) {
        const title = String(source.title || "網頁來源").trim();
        const url = String(source.url || "").trim();

        result += "\n\n" + (index + 1) + ". " + title;

        if (url) {
          result += "\n" + url;
        }
      });

    } else {
      result += "\n\n📚 本次沒有取得可列出的來源連結。";
    }

    return result;

  } catch (err) {
    console.error("本機 Gemma 搜尋失敗：", err);

    // 明確告知本機模型無法使用
    // 不會改用 Gemini 作為替代
    return (
      "⚠️ 本機 Gemma 搜尋服務目前無法使用。\n\n" +
      "原因：" + err.message + "\n\n" +
      "請確認電腦上的 Relay 與 Cloudflare 通道仍在運作，" +
      "以及 Apps Script 的搜尋設定是否正確。\n\n" +
      "本次查詢不會改用 Gemini。"
    );
  }
}


// ===== 4. 記錄、回覆、排日曆 =====

function saveAndReply(replyToken, todo, source, photoUrl) {
  if (!todo.isTodo) {
    return replyLine(replyToken, todo.chatReply || HELP_TEXT);
  }

  // ① 先寫進試算表
  const row = appendTodoRow(todo, source, photoUrl || "");

  const wantsCalendar =
    todo.date !== "未指定" &&
    todo.time !== "未指定";

  // ② 回覆手機
  let reply =
    `✅ 記好了（試算表第 ${row} 列）\n\n` +
    `📌 ${todo.summary}\n` +
    `🏷️ ${todo.category}\n` +
    `📅 ${todo.date}　⏰ ${todo.time}`;

  reply += wantsCalendar
    ? "\n🗓️ 日曆提醒建立中，結果會寫在試算表的「日曆」欄"
    : "\nℹ️ 沒有明確的日期和時間，這筆先不排日曆";

  if (photoUrl) {
    reply += "\n📷 照片已存進 Drive 的「LINE待辦照片」資料夾";
  }

  replyLine(replyToken, reply);

  // ③ 最後才排日曆
  if (wantsCalendar) {
    getSheet()
      .getRange(row, 7)
      .setValue(createCalendarEvent(todo));
  }
}


function getSheet() {
  const ss = SHEET_ID
    ? SpreadsheetApp.openById(SHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();

  if (!ss) {
    throw new Error(
      "找不到試算表：請從試算表的「擴充功能 → Apps Script」開程式，或在指令碼屬性填 SHEET_ID"
    );
  }

  const sheet = ss.getSheets()[0];

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);

    sheet
      .getRange(1, 1, 1, HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#0E7C7B")
      .setFontColor("#FFFFFF");
  }

  return sheet;
}


function appendTodoRow(todo, source, photoUrl) {
  const sheet = getSheet();

  const now = Utilities.formatDate(
    new Date(),
    TZ,
    "yyyy-MM-dd HH:mm:ss"
  );

  const lock = LockService.getScriptLock();

  lock.waitLock(10000);

  try {
    sheet.appendRow([
      now,
      todo.summary,
      todo.category,
      todo.date,
      todo.time,
      source,
      "",
      photoUrl || ""
    ]);

    return sheet.getLastRow();

  } finally {
    lock.releaseLock();
  }
}


// 照片存進 Google Drive
function savePhotoToDrive(blob) {
  const folderName = "LINE待辦照片";

  const found = DriveApp.getFoldersByName(folderName);

  const folder = found.hasNext()
    ? found.next()
    : DriveApp.createFolder(folderName);

  const stamp = Utilities.formatDate(
    new Date(),
    TZ,
    "yyyyMMdd-HHmmss"
  );

  const file = folder.createFile(
    blob.setName("line-" + stamp + ".jpg")
  );

  return file.getUrl();
}


function createCalendarEvent(todo) {
  try {
    const start = new Date(
      `${todo.date}T${todo.time}:00+08:00`
    );

    const end = new Date(
      start.getTime() + 30 * 60 * 1000
    );

    const event = CalendarApp
      .getDefaultCalendar()
      .createEvent(
        `【${todo.category}】${todo.summary}`,
        start,
        end,
        {
          description: "由 LINE AI 待辦小秘書建立"
        }
      );

    event.addPopupReminder(30);

    return "已建立";

  } catch (err) {
    console.error("建立日曆失敗：", err);

    return "失敗：" + err.message;
  }
}


// ===== 5. 請 Gemini 把口語整理成固定欄位 =====

const JSON_SHAPE = `只輸出一個 JSON 物件，欄位固定如下：
{"isTodo": true 或 false,
 "summary": "事項，簡短一句",
 "category": "繳費、會議、課業、生活、其他 五選一",
 "date": "YYYY-MM-DD，沒提到就填 未指定",
 "time": "HH:mm（24 小時制），沒提到就填 未指定",
 "chatReply": "不是待辦時，給使用者的一句簡短回覆；是待辦就填空字串"}`;


// 附上星期幾
function nowText() {
  return Utilities.formatDate(
    new Date(),
    TZ,
    "yyyy-MM-dd EEEE HH:mm"
  );
}


function askGeminiAboutText(text) {
  const prompt = `你是待辦事項助理。現在是台北時間 ${nowText()}。
判斷使用者這句話是不是待辦、提醒或行程。
是的話，把「明天」「下週五」這類說法換算成實際日期；不是的話，isTodo 填 false。
${JSON_SHAPE}
使用者說：${text}`;

  return checkTodo(
    callGemini([{ text: prompt }])
  );
}


function askGeminiAboutImage(blob) {
  const prompt = `你是待辦事項助理。現在是台北時間 ${nowText()}。
這是一張照片，可能是活動海報、便條紙或繳費單。找出上面最重要的一件待辦或活動。
照片上沒寫的欄位就填 未指定，不要自己猜。
${JSON_SHAPE}`;

  return checkTodo(
    callGemini([
      { text: prompt },
      {
        inlineData: {
          mimeType: blob.getContentType() || "image/jpeg",
          data: Utilities.base64Encode(blob.getBytes())
        }
      }
    ])
  );
}


function callGemini(parts) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "還沒設定 GEMINI_API_KEY（專案設定 → 指令碼屬性）"
    );
  }

  const res = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    {
      method: "post",

      contentType: "application/json",

      headers: {
        "x-goog-api-key": GEMINI_API_KEY
      },

      payload: JSON.stringify({
        contents: [
          {
            role: "user",
            parts: parts
          }
        ],

        generationConfig: {
          responseMimeType: "application/json"
        }
      }),

      muteHttpExceptions: true
    }
  );

  const code = res.getResponseCode();

  if (code !== 200) {
    throw new Error(
      `Gemini 回應 ${code}：${res.getContentText().slice(0, 150)}`
    );
  }

  const data = JSON.parse(res.getContentText());

  const cand = (data.candidates || [])[0];

  const text =
    cand &&
    cand.content &&
    (cand.content.parts || [])
      .map(p => p.text || "")
      .join("");

  if (!text) {
    throw new Error(
      `Gemini 沒有給內容（原因：${cand ? cand.finishReason : "沒有任何答案"}）`
    );
  }

  return JSON.parse(
    text.replace(/^```(json)?\s*|\s*```$/g, "")
  );
}


// ===== 6. 驗算：AI 給的欄位不直接照單全收 =====

function checkTodo(t) {
  return {
    isTodo: t.isTodo === true,

    summary:
      String(t.summary || "").trim() || "（沒抓到事項）",

    category:
      CATEGORIES.includes(t.category)
        ? t.category
        : "其他",

    date:
      isRealDate(t.date)
        ? t.date
        : "未指定",

    time:
      /^([01]\d|2[0-3]):[0-5]\d$/.test(t.time)
        ? t.time
        : "未指定",

    chatReply: String(t.chatReply || "")
  };
}


// 確認日期是否真實存在
function isRealDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    return false;
  }

  const d = new Date(`${s}T12:00:00+08:00`);

  return (
    !isNaN(d.getTime()) &&
    Utilities.formatDate(d, TZ, "yyyy-MM-dd") === s
  );
}


// ===== 7. LINE 相關 =====

function lineApi(path, payload, host) {
  if (!LINE_ACCESS_TOKEN) {
    throw new Error(
      "還沒設定 LINE_CHANNEL_ACCESS_TOKEN（專案設定 → 指令碼屬性）"
    );
  }

  const options = {
    method: payload ? "post" : "get",

    headers: {
      Authorization: "Bearer " + LINE_ACCESS_TOKEN
    },

    muteHttpExceptions: true
  };

  if (payload) {
    options.contentType = "application/json";
    options.payload = JSON.stringify(payload);
  }

  return UrlFetchApp.fetch(
    (host || "https://api.line.me") + path,
    options
  );
}


function replyLine(replyToken, text) {
  const res = lineApi(
    "/v2/bot/message/reply",
    {
      replyToken: replyToken,

      messages: [
        {
          type: "text",
          text: text.slice(0, 5000)
        }
      ]
    }
  );

  if (res.getResponseCode() !== 200) {
    console.error(
      "LINE 回覆失敗：",
      res.getResponseCode(),
      res.getContentText()
    );
  }
}


// 「對方正在輸入…」動畫
function showLoading(source) {
  if (!source || source.type !== "user") return;

  try {
    lineApi(
      "/v2/bot/chat/loading/start",
      {
        chatId: source.userId,
        loadingSeconds: 20
      }
    );

  } catch (err) {
    console.warn("輸入中動畫沒開成：", err);
  }
}


// 下載 LINE 照片
function downloadLineImage(messageId) {
  const res = lineApi(
    `/v2/bot/message/${messageId}/content`,
    null,
    "https://api-data.line.me"
  );

  if (res.getResponseCode() !== 200) {
    throw new Error(
      `照片下載失敗（LINE 回應 ${res.getResponseCode()}）`
    );
  }

  const blob = res.getBlob();

  if (blob.getBytes().length > 10 * 1024 * 1024) {
    throw new Error(
      "照片太大（超過 10 MB），請截圖或壓縮後再傳"
    );
  }

  return blob;
}


// ===== 8. 自我檢查 =====

function testSetup() {
  const results = [];

  const check = (name, fn) => {
    try {
      results.push(`✅ ${name}：${fn()}`);

    } catch (err) {
      results.push(`❌ ${name}：${err.message}`);
    }
  };

  check("LINE token", () => {
    const res = lineApi("/v2/bot/info");

    if (res.getResponseCode() !== 200) {
      throw new Error(
        `LINE 回應 ${res.getResponseCode()}，token 可能貼錯或已經重發`
      );
    }

    return (
      "bot 名稱「" +
      JSON.parse(res.getContentText()).displayName +
      "」"
    );
  });

  check("Google 日曆", () => {
    return (
      "可以使用「" +
      CalendarApp.getDefaultCalendar().getName() +
      "」"
    );
  });

  let todo = null;

  check("Gemini", () => {
    todo = askGeminiAboutText(
      "明天早上十點要交房租，記得轉帳給房東"
    );

    return JSON.stringify(todo);
  });

  check("試算表", () => {
    if (!todo) {
      throw new Error("Gemini 那關沒過，先不寫");
    }

    return (
      `寫進第 ${appendTodoRow(todo, "testSetup")} 列`
    );
  });

  console.log(results.join("\n"));

  console.log(
    "👉 打開試算表，親眼看到多了一列才算成功。出現權限錯誤，或這裡說成功、表裡卻沒有，多半是授權畫面沒有全部勾選。"
  );
}