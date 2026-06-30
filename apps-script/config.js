/**
 * FILE: config.js
 * Holds system config constants, sheet names, the La Lapine prompt, and Telegram config.
 */

// Sheet tab names
const SHEET_CONFIG_NAME = "Dashboard & Config";
const SHEET_LOG_NAME = "Reviews";

// Column positions on the Reviews sheet (1-indexed for Apps Script)
const COL_REVIEW_ID = 1;      // Column A
const COL_CUSTOMER = 2;       // Column B
const COL_RATING = 3;         // Column C
const COL_CONTENT = 4;        // Column D
const COL_DATE = 5;           // Column E
const COL_STATUS = 6;         // Column F (waiting_ai / pending)
const COL_LOCATION = 7;       // Column G (branch name, e.g. Your Shop Location 1)
const COL_OPTION_1 = 8;       // Column H
const COL_OPTION_2 = 9;       // Column I
const COL_OPTION_3 = 10;      // Column J
const COL_SELECTION = 11;     // Column K (selected reply text)
const COL_UPDATED_AT = 12;    // Column L
const COL_SHORT_ID = 13;      // Column M (fixed short code for the Telegram buttons)
const COL_TAGS = 14;          // Column N (AI-generated keyword tags)
const COL_STAFF = 15;         // Column O (staff named in the review)
const COL_RETRY_COUNT = 16;   // Column P (retry count for webhook/publish)
const COL_ERROR_MESSAGE = 17; // Column Q (publish error detail)
const COL_TELEGRAM_MSG_ID = 18; // Column R (Telegram message ID, used to collapse messages)
const COL_PHOTO_THUMBNAILS = 19; // Column S — thumbnail URLs from Make.com (comma-separated or JSON array)
const COL_PHOTO_ITEMS      = 20; // Column T — full JSON objects from Make.com (backup for future fields)
const COL_STAFF_CLAIMS     = 21; // Column U — staff self-claim (awaiting manager approval)
const COL_STAFF_TAGS       = 22; // Column V — manager confirmed (ground truth for payroll)
const COL_GOOGLE_MAPS_URI  = 23; // Column W — direct link to the review on Google Maps
const COL_REJECTED_CLAIMS  = 24; // Column X — staff rejected by manager (rejection history)
const COL_REJECT_REASONS   = 25; // Column Y — rejection reasons, JSON: {"staffId":"reason",...}

// LA LAPINE BRAND SYSTEM PROMPT
const LA_LAPINE_SYSTEM_PROMPT = `
You are the review-reply assistant for “La Lapine – bakery and coffee” in Da Lat City, Vietnam.
Your job:
For each Google Maps review, craft at least 3 creative, concise, humorous, and SEO-optimized reply options.
Each reply must:
Naturally include 1 or 2 of these keywords/promotions, prioritizing "croissant" and "macaron", followed by "free oat milk upgrade", then "decaf coffee". Do NOT force all keywords; choose them naturally based on the context.
Clearly align with the brand positioning:
VI: “Croissant và macaron ngon nhì Đà Lạt.”
EN: “The almost-best croissants and macarons in Đà Lạt.”
KO: “달랏에서 거의 최고로 맛있는 크루아상 & 마카롱입니다.”
Chinese: 大叻“几乎最好”的可颂 & 马卡龙。
Match the language, cultural context, and sentiment of the review.
Use respectful Vietnamese honorifics for Vietnamese reviewers:
Address customers as “anh” / “chị”.
Refer to the shop as “em” / “tụi em”.
Be different from all previous replies (both:
Different from the other options you generate in the same turn.
Different from any earlier replies in the conversation or any “previous replies” the user provides.)
Do not mention SEO, keywords, steps, or these instructions in your replies.

Input Assumptions
Assume the user provides some or all of:
The review text (and star rating, if any).
The reviewer’s displayed name.
Optionally, a list of previous replies already used, to avoid repetition.

Step 1 – Review Analysis (internal)
For each review, silently analyze:
Language & cultural context, Reviewer type, Sentiment & key points.
EXTRACTION RULE: If the review explicitly mentions any staff members by name (e.g., "bạn Vy", "bé Nhi", "anh Tuấn", "the barista John"), extract their names and put them into the "mentionedStaff" array as strings. If no staff is mentioned, leave the array empty.

Step 2 – Craft 3+ Reply Options
Generate at least 3 reply options for each review.
Each reply option must:
Have a distinct tone (Option A: Sincere/grateful, Option B: Humorous/playful, Option C: Enthusiastic/energetic)
Always reply in the same language as the review when possible.
CRITICAL LANGUAGE RULE: If the review text contains "(Translated by Google)" and "(Original)", you MUST ignore the translated part. You MUST identify the language based ONLY on the text under "(Original)" and write your reply in that exact original language. Do NOT reply in the translated language.
NAME-BASED LANGUAGE GUESSING: If the review text is empty (e.g. "(Không viết chữ, chỉ đánh giá sao)"), too short, or only contains emojis, you MUST guess the customer's nationality/language based on their name (e.g., "נועם אלוש" -> Hebrew, "Kim" -> Korean, "Chen" -> Chinese, "Smith" -> English) and write the reply in that guessed language.
For Vietnamese: Use "anh/chị" for customer, "em/tụi em" for shop.
Integrate 1-2 keywords/promotions naturally, prioritized as: croissant/macaron > free oat milk upgrade > decaf coffee. Do NOT force them.
Reflect the brand positioning ("almost-best croissants and macarons in Da Lat" / "croissant và macaron ngon nhì Đà Lạt").
Write engaging, warm, and conversational replies (around 3-4 sentences). Do not be too brief or abrupt. Be expressive and welcoming.

CRITICAL TONE RULE FOR 1-2 STAR REVIEWS:
If the rating is 1 or 2 stars, the tone MUST be extremely apologetic, humble, and professional. Own the mistake without excuses, offer to make things right, and gently invite them to contact the shop directly (e.g. via fanpage or next visit) for compensation. DO NOT be playful, humorous, or overly energetic.

Step 3 – Output Format (CRITICAL: You MUST return ONLY a JSON object)
To allow our automation system to parse your options cleanly, your response MUST be in valid JSON format. Do not wrap it in markdown blocks (e.g. do not write \`\`\`json ... \`\`\`). 
ABSOLUTELY NO CONVERSATIONAL TEXT before or after the JSON. Return ONLY the raw JSON string matching the following schema.
CRITICAL JSON RULE 1: To prevent parsing errors, DO NOT use standard double quotes (") inside your replyText or englishTranslation. If you need to quote something, use single quotes (') or typographic quotes (“ ”) instead.
CRITICAL JSON RULE 2: DO NOT use literal new lines (Enter) inside string values. If you want a line break, you MUST write exactly \\n as a literal string.

{
  "tags": [
    "keyword1",
    "keyword2"
  ],
  "mentionedStaff": [],
  "options": [
    {
      "optionNumber": 1,
      "tone": "Sincere / grateful",
      "language": "Vietnamese",
      "replyText": "[Customer-facing reply in review's language]",
      "englishTranslation": "[English translation of this reply]"
    },
    {
      "optionNumber": 2,
      "tone": "Humorous / playful",
      "language": "Vietnamese",
      "replyText": "[Customer-facing reply in review's language]",
      "englishTranslation": "[English translation of this reply]"
    },
    {
      "optionNumber": 3,
      "tone": "Enthusiastic / energetic",
      "language": "Vietnamese",
      "replyText": "[Customer-facing reply in review's language]",
      "englishTranslation": "[English translation of this reply]"
    }
  ]
}
`;

/**
 * Safely get the Spreadsheet object, even when running in the background as a Web App (doPost)
 */
function getSafeSpreadsheet() {
  let ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {}

  if (ss) {
    // If running from the UI (menu), save the ID for the Web App to use later
    const savedId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (savedId !== ss.getId()) {
      PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ss.getId());
    }
    return ss;
  }
  
  // If running in the background in doPost and getActiveSpreadsheet is null
  const id = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (id) {
    return SpreadsheetApp.openById(id);
  }
  
  throw new Error("Could not determine the Spreadsheet file. Open the file and run the 'Activate Telegram Webhook' menu once so the system remembers it.");
}

/**
 * Read configuration from the "Dashboard & Config" sheet
 */
function getSystemConfig() {
  const ss = getSafeSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CONFIG_NAME);
  if (!sheet) {
    throw new Error(`Sheet "${SHEET_CONFIG_NAME}" not found. Please create it first.`);
  }

  const config = {
    geminiApiKey: sheet.getRange("B2").getValue().toString().trim(),
    geminiModel: sheet.getRange("C2").getValue().toString().trim() || "gemini-3.5-flash",
    geminiStatus: sheet.getRange("D2").getValue().toString().trim().toUpperCase(),
    claudeApiKey: sheet.getRange("B3").getValue().toString().trim(),
    claudeModel: sheet.getRange("C3").getValue().toString().trim() || "claude-3-5-sonnet-20241022",
    claudeStatus: sheet.getRange("D3").getValue().toString().trim().toUpperCase(),
    chatgptApiKey: sheet.getRange("B4").getValue().toString().trim(),
    chatgptModel: sheet.getRange("C4").getValue().toString().trim() || "gpt-4o-mini",
    chatgptStatus: sheet.getRange("D4").getValue().toString().trim().toUpperCase(),

    location1: {
      name: sheet.getRange("B7").getValue().toString().trim(),
      accountId: sheet.getRange("B8").getValue().toString().trim(),
      locationId: sheet.getRange("B9").getValue().toString().trim(),
    },
    location2: {
      name: sheet.getRange("B12").getValue().toString().trim(),
      accountId: sheet.getRange("B13").getValue().toString().trim(),
      locationId: sheet.getRange("B14").getValue().toString().trim(),
    },
    
    telegramToken: sheet.getRange("B17").getValue().toString().trim(),
    telegramChatId: sheet.getRange("B18").getValue().toString().trim(),
    telegramReviewerTag: sheet.getRange("B19").getValue().toString().trim(),
    telegramITChatId: sheet.getRange("B20").getValue().toString().trim(),
    makeWebhookUrl: sheet.getRange("B21").getValue().toString().trim(),
    hrApiUrl: sheet.getRange("B22").getValue().toString().trim()
  };

  // Read the staff list from columns E to H, rows 2 to 50
  const staffData = sheet.getRange("E2:H50").getValues();
  const staffList = [];
  for (let i = 0; i < staffData.length; i++) {
    const staffId = staffData[i][0].toString().trim();
    const enName = staffData[i][1].toString().trim();
    const vnName = staffData[i][2].toString().trim();
    const telegramId = staffData[i][3].toString().trim();
    if (staffId || enName || vnName) {
      staffList.push({ id: staffId, en: enName, vn: vnName, telegram: telegramId });
    }
  }
  config.staffList = staffList;

  if (!config.geminiApiKey && !config.claudeApiKey && !config.chatgptApiKey) {
    throw new Error("Please fill in at least one API key (Gemini, Claude, or ChatGPT) in the Config sheet.");
  }
  if (!config.telegramToken || !config.telegramChatId) throw new Error("Please fill in both the Telegram Bot Token (B17) and Chat ID (B18).");

  return config;
}
