/**
 * FILE: gemini.js (the AI Hub)
 * Handles communication with the Gemini, Claude, and ChatGPT APIs
 */

function generateRepliesWithAI(reviewerName, rating, reviewText, locationName) {
  const config = getSystemConfig();
  let errors = [];
  
  // SANITIZE INPUT: swap double quotes for single quotes so the AI doesn't echo quotes and break the JSON
  const safeReviewText = (reviewText || "").replace(/"/g, "'");

  // Build a dynamic system prompt that includes the staff list
  let systemPrompt = LA_LAPINE_SYSTEM_PROMPT;
  if (config.staffList && config.staffList.length > 0) {
    const staffNamesFull = config.staffList.map(s => `${s.vn} (English name: ${s.en})`).join(", ");
    systemPrompt += `\n\n[IMPORTANT: STAFF LIST FOR REWARDS]\nThe shop has the following staff: ${staffNamesFull}.\nIn the JSON output, add a "mentionedStaff": ["Name 1", "Name 2"] field listing any staff praised, mentioned, or pictured in the review. Return their names even if the customer used an English nickname. If nobody is mentioned, return an empty array [].`;
  }

  // 1. Try Gemini first (if it has a key and is switched ON)
  if (config.geminiApiKey && config.geminiStatus === "ON") {
    try {
      Logger.log("Calling Gemini API...");
      return callGemini(config.geminiApiKey, config.geminiModel, reviewerName, rating, safeReviewText, systemPrompt);
    } catch (e) {
      Logger.log("Gemini failed: " + e.message);
      errors.push("Gemini: " + e.message);
    }
  }

  // 2. If Gemini fails (or has no key / is OFF), try Claude
  if (config.claudeApiKey && config.claudeStatus === "ON") {
    try {
      Logger.log("Calling Claude API...");
      return callClaude(config.claudeApiKey, config.claudeModel, reviewerName, rating, safeReviewText, systemPrompt);
    } catch (e) {
      Logger.log("Claude failed: " + e.message);
      errors.push("Claude: " + e.message);
    }
  }

  // 3. If Claude also fails / is OFF, try ChatGPT
  if (config.chatgptApiKey && config.chatgptStatus === "ON") {
    try {
      Logger.log("Calling ChatGPT API...");
      return callChatGPT(config.chatgptApiKey, config.chatgptModel, reviewerName, rating, safeReviewText, systemPrompt);
    } catch (e) {
      Logger.log("ChatGPT failed: " + e.message);
      errors.push("ChatGPT: " + e.message);
    }
  }

  // If all of them fail
  sendLogToIT(`All AI APIs (Gemini/Claude/ChatGPT) failed while processing customer ${reviewerName}!\n\nError details:\n- ${errors.join("\n- ")}`, "ERROR");
  throw new Error("All AI APIs failed or are not configured. Error details: " + errors.join(" | "));
}

// ==========================================
// HÀM GỌI GEMINI API
// ==========================================
function callGemini(apiKey, model, reviewerName, rating, reviewText, systemPrompt) {
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const reviewContext = `=== REVIEW TO REPLY TO ===\nCustomer name: ${reviewerName}\nStars: ${rating}\nContent: "${reviewText || "(No content)"}"\n====================================`;

  const payload = {
    contents: [
      { parts: [{ text: systemPrompt }, { text: reviewContext }] }
    ],
    generationConfig: { temperature: 0.7 }
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  if (response.getResponseCode() !== 200) throw new Error(response.getContentText());
  
  const jsonResult = JSON.parse(response.getContentText());
  if (!jsonResult.candidates || jsonResult.candidates.length === 0) throw new Error("Gemini returned an empty response");
  
  let rawText = jsonResult.candidates[0].content.parts[0].text.trim();
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No valid JSON structure found in the response.");
    const cleanJsonStr = jsonMatch[0].replace(/[\u0000-\u001F]+/g, function(match) {
      if(match === '\n' || match === '\r' || match === '\t') return match;
      return "";
    });
    return JSON.parse(cleanJsonStr);
  } catch(e) {
    Logger.log("❌ RAW JSON ERROR (Gemini): " + rawText);
    throw new Error("JSON parse error: " + e.message);
  }
}

// ==========================================
// HÀM GỌI CLAUDE API
// ==========================================
function callClaude(apiKey, model, reviewerName, rating, reviewText, systemPrompt) {
  const apiUrl = `https://api.anthropic.com/v1/messages`;
  const reviewContext = `=== REVIEW TO REPLY TO ===\nCustomer name: ${reviewerName}\nStars: ${rating}\nContent: "${reviewText || "(No content)"}"\n====================================`;

  const payload = {
    model: model,
    max_tokens: 4096,
    temperature: 0.7,
    system: systemPrompt,
    messages: [
      { role: "user", content: reviewContext }
    ]
  };

  const options = {
    method: "post",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  if (response.getResponseCode() !== 200) throw new Error(response.getContentText());
  
  const jsonResult = JSON.parse(response.getContentText());
  let rawText = jsonResult.content[0].text.trim();
  
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No valid JSON structure found in the response.");
    const cleanJsonStr = jsonMatch[0].replace(/[\u0000-\u001F]+/g, function(match) {
      if(match === '\n' || match === '\r' || match === '\t') return match;
      return "";
    });
    return JSON.parse(cleanJsonStr);
  } catch(e) {
    Logger.log("❌ RAW JSON ERROR (Claude): " + rawText);
    throw new Error("JSON parse error: " + e.message);
  }
}

// ==========================================
// HÀM GỌI CHATGPT API
// ==========================================
function callChatGPT(apiKey, model, reviewerName, rating, reviewText, systemPrompt) {
  const apiUrl = `https://api.openai.com/v1/chat/completions`;
  const reviewContext = `=== REVIEW TO REPLY TO ===\nCustomer name: ${reviewerName}\nStars: ${rating}\nContent: "${reviewText || "(No content)"}"\n====================================`;

  const payload = {
    model: model,
    temperature: 0.8,
    top_p: 0.95,
    response_format: { type: "json_object" }, 
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: reviewContext }
    ]
  };

  const options = {
    method: "post",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(apiUrl, options);
  if (response.getResponseCode() !== 200) throw new Error(response.getContentText());
  
  const jsonResult = JSON.parse(response.getContentText());
  let rawText = jsonResult.choices[0].message.content.trim();
  
  try {
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No valid JSON structure found in the response.");
    const cleanJsonStr = jsonMatch[0].replace(/[\u0000-\u001F]+/g, function(match) {
      if(match === '\n' || match === '\r' || match === '\t') return match;
      return "";
    });
    return JSON.parse(cleanJsonStr);
  } catch(e) {
    Logger.log("❌ RAW JSON ERROR (ChatGPT): " + rawText);
    throw new Error("JSON parse error: " + e.message);
  }
}

function testGeminiConnection() {
  try {
    const config = getSystemConfig();
    const result = generateRepliesWithAI("Test Customer", 5, "Everything was great", "La Lapine");
    
    if (result && result.options) {
      return `✅ AI API CONNECTION SUCCESSFUL!\n\nThe AI generated:\n- Option 1: ${result.options[0].replyText}\n\nYou're ready to use the system!`;
    } else {
      return "⚠️ CONNECTED, BUT THE AI DID NOT RETURN VALID JSON.";
    }
  } catch (e) {
    return "❌ LỖI KẾT NỐI AI:\n" + e.message;
  }
}

/**
 * Ask the AI to write the weekly summary report
 */
function generateWeeklySummaryWithAI(reportText, totalReviews, avgStar) {
  const config = getSystemConfig();
  
  const sysPrompt = `You are a customer-data analyst for the premium cafe/bakery "La Lapine".
Based on the reviews and keyword tags from the past 7 days, write a short but complete summary report (for a manager to read on Telegram).

OUTPUT REQUIREMENTS:
- Overview: highlight the numbers (Total ${totalReviews} reviews, average ${avgStar} stars).
- Detailed analysis: keep the two branches SEPARATE (Location 1 and Location 2). For each branch, give:
  + Highlights (what customers praised most).
  + Areas to fix (complaints, suggestions, or 1-2 star reviews if any).
- General recommendations: 1-2 short tips to do better next week across the whole system.

Tone: professional, concise, with suitable emoji. RETURN TEXT FORMATTED WITH BASIC (TELEGRAM) HTML TAGS LIKE <b>bold</b>, <i>italic</i>, <u>underline</u>.
CRITICAL: DO NOT USE ANY MARKDOWN (LIKE **bold**, ## headings, > quotes, * bullets). ONLY USE A HYPHEN (-) FOR LISTS OR THE HTML TAGS ABOVE. Markdown breaks Telegram rendering.`;

  const userPrompt = `PAST WEEK'S DATA:\n${reportText}\n\nAnalyze it and write the report now!`;

  // Try Gemini first
  if (config.geminiApiKey && config.geminiStatus === "ON") {
    try {
      return callGeminiPlain(config.geminiApiKey, config.geminiModel, sysPrompt, userPrompt);
    } catch (e) {
      Logger.log("Error calling Gemini for the summary: " + e.message);
    }
  }

  // Fallback Claude
  if (config.claudeApiKey && config.claudeStatus === "ON") {
    try {
      return callClaudePlain(config.claudeApiKey, config.claudeModel, sysPrompt, userPrompt);
    } catch (e) {
      Logger.log("Error calling Claude for the summary: " + e.message);
    }
  }

  // Fallback ChatGPT
  if (config.chatgptApiKey && config.chatgptStatus === "ON") {
    try {
      return callChatGPTPlain(config.chatgptApiKey, config.chatgptModel, sysPrompt, userPrompt);
    } catch (e) {
      Logger.log("Error calling ChatGPT for the summary: " + e.message);
    }
  }

  throw new Error("All AI APIs failed or are not enabled.");
}

/**
 * Ask the AI to write the monthly report (aggregated from weekly reports)
 */
function generateMonthlySummaryWithAI(weeklySummariesText, stats) {
  const config = getSystemConfig();
  
  const sysPrompt = `You are a senior customer-data analyst for the cafe/bakery "La Lapine".
Based on each week's report from the past month, write a short, concise, strategic monthly summary (for the owner to read on Telegram).

MONTHLY STATS FOR ${stats.monthName}/${stats.targetYear}:
- Total reviews: ${stats.totalReviews} (last month: ${stats.lastMonthReviews})
- Average rating: ${stats.avgStar} stars (last month: ${stats.lastAvgStar} stars)
- 5-star reviews: ${stats.fiveStarCount}
- 1-2 star reviews: ${stats.lowStarCount}

REQUIRED REPORT STRUCTURE:
<b>📊 BÁO CÁO REVIEW THÁNG ${stats.monthName}/${stats.targetYear} - LA LAPINE</b>

<b>1. Overview</b>
- Total reviews: ${stats.totalReviews}
- Average rating: ${stats.avgStar}
- Vs. last month: (analyze % change in review count and rating)
- 5-star review rate: (as a %)
- 1-2 star reviews: ${stats.lowStarCount} cases

<b>2. Management summary</b>
- Overall status: (positive / stable / needs attention)
- Biggest strength:
- Priority issue:
- Opportunity next month:

<b>3. Per-branch analysis</b>

<b>Location 1</b>
- Highlights:
- Areas to fix:
- Notes on the branch's role:

<b>Location 2</b>
- Highlights:
- Areas to fix:
- Notes on the branch's role:

<b>4. Standout products & experiences</b>
- Most-praised products:
- Products to watch:
- Customer-experience insight:

<b>5. Recurring issues this month</b>
- Recurring issue:
- One-off feedback:
- Priority level:

<b>6. Staff & service</b>
- Service strengths:
- Training needs:

<b>7. Recommended actions next month</b>
- Keep doing:
- Improve:
- Try:

IMPORTANT ANALYSIS NOTES:
- This is a MONTHLY report, not just a sum of weekly ones. Focus on trends, recurring issues, management insight, and next month's actions.
- Clearly separate "recurring issues" (appear often) from "one-off feedback" (only one person). Do not overstate feedback that appeared only once.
- Only call an issue "notable" if it appears 2+ times or relates to a serious 1-2 star review.
- Do not speculate if the data is insufficient. If data is missing, write "not enough data to conclude".
- For each branch, comment on both the experience quality and the branch's role within the La Lapine system.
- Point out which product is making the strongest brand impression this month.
- ALWAYS RETURN TEXT FORMATTED WITH BASIC HTML TAGS LIKE <b>bold</b>, <i>italic</i>, <u>underline</u>.
- NEVER USE MARKDOWN (like **bold**, ## headings, * bullets). Only use a hyphen (-) for lists.`;

  const userPrompt = `WEEKLY REPORTS FROM THE PAST MONTH:\n${weeklySummariesText}\n\nAnalyze them and write the monthly report following the required format!`;

  if (config.geminiApiKey && config.geminiStatus === "ON") {
    try { return callGeminiPlain(config.geminiApiKey, config.geminiModel, sysPrompt, userPrompt); } catch(e){}
  }
  if (config.claudeApiKey && config.claudeStatus === "ON") {
    try { return callClaudePlain(config.claudeApiKey, config.claudeModel, sysPrompt, userPrompt); } catch(e){}
  }
  if (config.chatgptApiKey && config.chatgptStatus === "ON") {
    try { return callChatGPTPlain(config.chatgptApiKey, config.chatgptModel, sysPrompt, userPrompt); } catch(e){}
  }

  return "⚠️ Could not connect to the AI to build the monthly report.";
}

/**
 * Ask the AI to write the yearly report (aggregated from monthly reports)
 */
function generateYearlySummaryWithAI(monthlySummariesText, stats) {
  const config = getSystemConfig();
  
  const sysPrompt = `You are a senior business and brand strategy analyst for the bakery & cafe "La Lapine" in Da Lat.
Based on each month's summary from the past year, write a concise, strategic year-end report (for the owner to read on Telegram).

YEARLY STATS FOR ${stats.targetYear}:
- Total reviews for the year: ${stats.totalReviews}
- Average rating for the year: ${stats.avgStar} stars
- 5-star reviews: ${stats.fiveStarCount}
- 1-2 star reviews: ${stats.lowStarCount}

REQUIRED REPORT STRUCTURE:
<b>📊 ${stats.targetYear} YEAR-END REVIEW REPORT — LA LAPINE</b>

<b>1. The year in numbers</b>
- Total reviews: ${stats.totalReviews}
- Average rating: ${stats.avgStar} stars
- 5-star review rate: (as a %)
- Total negative reviews (1-2 star): ${stats.lowStarCount} cases

<b>2. Strategy & operations review</b>
- Big-picture notes: (brand growth, customer satisfaction across quarters)
- Most prominent core strength:
- Operational bottleneck to fully resolve:

<b>3. Two-branch review</b>
- <b>Location 1:</b> (summary of service quality, products, and customer feedback over the year)
- <b>Location 2:</b> (summary of service quality, products, and customer feedback over the year)

<b>4. Top brand-defining products</b>
- Which croissants / macarons / coffees were praised most and left the strongest impression.
- Products needing recipe or service improvements.

<b>5. Staff & service takeaways</b>
- Progress in staff service attitude.
- Standout staff (if mentioned in the data).

<b>6. Direction & recommended actions for next year</b>
- Suggestions to improve the menu, raise service quality, or adjust operations.

IMPORTANT ANALYSIS NOTES:
- This is a YEARLY report; focus on big quarterly/annual trends, systemic recurring issues, and long-term strategic solutions.
- ALWAYS RETURN TEXT FORMATTED WITH BASIC HTML TAGS LIKE <b>bold</b>, <i>italic</i>, <u>underline</u>.
- NEVER USE MARKDOWN (like **bold**, ## headings, * bullets). Only use a hyphen (-) for lists.`;

  const userPrompt = `MONTHLY REPORTS FROM THE PAST YEAR:\n${monthlySummariesText}\n\nAnalyze them and write the yearly report following the required format!`;

  if (config.geminiApiKey && config.geminiStatus === "ON") {
    try { return callGeminiPlain(config.geminiApiKey, config.geminiModel, sysPrompt, userPrompt); } catch(e){}
  }
  if (config.claudeApiKey && config.claudeStatus === "ON") {
    try { return callClaudePlain(config.claudeApiKey, config.claudeModel, sysPrompt, userPrompt); } catch(e){}
  }
  if (config.chatgptApiKey && config.chatgptStatus === "ON") {
    try { return callChatGPTPlain(config.chatgptApiKey, config.chatgptModel, sysPrompt, userPrompt); } catch(e){}
  }

  return "⚠️ Could not connect to the AI to build the yearly report.";
}

// === API CALL FUNCTIONS THAT RETURN PLAIN TEXT (no forced JSON) ===

function callGeminiPlain(apiKey, model, sysPrompt, userPrompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = {
    system_instruction: { parts: { text: sysPrompt } },
    contents: [{ parts: [{ text: userPrompt }] }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (json.error) throw new Error(json.error.message);
  return json.candidates[0].content.parts[0].text;
}

function callClaudePlain(apiKey, model, sysPrompt, userPrompt) {
  const url = "https://api.anthropic.com/v1/messages";
  const payload = {
    model: model,
    max_tokens: 4096,
    system: sysPrompt,
    messages: [{ role: "user", content: userPrompt }]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01"
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (json.error) throw new Error(json.error.message);
  return json.content[0].text;
}

function callChatGPTPlain(apiKey, model, sysPrompt, userPrompt) {
  const url = "https://api.openai.com/v1/chat/completions";
  const payload = {
    model: model,
    messages: [
      { role: "system", content: sysPrompt },
      { role: "user", content: userPrompt }
    ]
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: { "Authorization": "Bearer " + apiKey },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(url, options);
  const json = JSON.parse(response.getContentText());
  
  if (json.error) throw new Error(json.error.message);
  return json.choices[0].message.content;
}
