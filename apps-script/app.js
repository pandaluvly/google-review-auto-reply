/**
 * FILE: app.js
 * Main orchestration logic for the system.
 * Runs on Google Apps Script, linked to Google Sheets and the Telegram Webhook.
 */

/**
 * Runs automatically when the Google Sheet opens, to build the custom menu.
 */
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("🧁 La Lapine Tool")
    .addItem("🤖 Run AI processing", "processAIQueue")
    .addSeparator()
    .addItem("⚙️ Activate Telegram Webhook", "runSetupWebhook")
    .addItem("🔍 Check Webhook Errors", "checkWebhookStatus")
    .addItem("🛠️ Set Up Sheet Layout", "autoCreateConfigSheet")
    .addSeparator()
    .addItem("⏰ Enable Auto-Run (every 5 min)", "setupAutoRunTrigger")
    .addItem("⏰ Enable Auto Report (Mon morning)", "setupWeeklyReportTrigger")
    .addItem("🏆 Enable Monthly Auto Report (1st)", "setupMonthlyTrigger")
    .addItem("📊 Weekly Report (send via Telegram)", "generateWeeklyReport")
    .addItem("🏆 Yearly Report (send via Telegram)", "runYearlyReportFromMenu")
    .addItem("🧪 Test AI Connection (Gemini)", "runGeminiTest")
    .addToUi();
}

/**
 * Run a Gemini connection test from the menu.
 */
function runGeminiTest() {
  const ui = SpreadsheetApp.getUi();
  ui.alert("Testing AI connection...", "The system will try generating a reply. Please wait a moment.", ui.ButtonSet.OK);
  
  const status = testGeminiConnection();
  ui.alert("Test Result", status, ui.ButtonSet.OK);
}

/**
 * Set up a trigger to run processAIQueue every 5 minutes
 */
function setupAutoRunTrigger() {
  const ui = SpreadsheetApp.getUi();
  try {
    // Delete old triggers with the same name to avoid duplicates
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "processAIQueue") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    
    // Create a new trigger running every 5 minutes
    ScriptApp.newTrigger("processAIQueue")
      .timeBased()
      .everyMinutes(5)
      .create();
      
    ui.alert("✅ Success", "AUTO mode enabled! From now on, every 5 minutes the system scans for new reviews and notifies you on Telegram — no manual clicks needed.", ui.ButtonSet.OK);
  } catch(e) {
    ui.alert("❌ Error", "Could not create the trigger. Details: " + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Set up a trigger to run the weekly report on Monday morning
 */
function setupWeeklyReportTrigger() {
  const ui = SpreadsheetApp.getUi();
  try {
    createWeeklyReportTrigger();
      
    ui.alert("✅ Success", "Enabled auto-sending of the summary report at 9am every Monday!", ui.ButtonSet.OK);
  } catch(e) {
    ui.alert("❌ Error", "Could not create the trigger. Details: " + e.message, ui.ButtonSet.OK);
  }
}

function createWeeklyReportTrigger() {
  const ss = getSafeSpreadsheet();
  PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ss.getId());

  const triggers = ScriptApp.getProjectTriggers();
  for (let i = 0; i < triggers.length; i++) {
    const handler = triggers[i].getHandlerFunction();
    if (handler === "generateWeeklyReport_Silent" || handler === "generateWeeklyReport") {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  return ScriptApp.newTrigger("generateWeeklyReport_Silent")
    .timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY)
    .atHour(9)
    .inTimezone("Asia/Ho_Chi_Minh")
    .create();
}

/**
 * Set up auto-sending of the monthly report at 9am on the 1st of each month
 */
function setupMonthlyTrigger() {
  const ui = SpreadsheetApp.getUi();
  try {
    // Delete the old monthly-report trigger if present
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'generateMonthlyReport_Silent') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
    
    // Create a new trigger running on the 1st of each month at 9am
    ScriptApp.newTrigger('generateMonthlyReport_Silent')
      .timeBased()
      .onMonthDay(1)
      .atHour(9)
      .create();
      
    ui.alert("✅ Success", "Enabled auto-sending of the summary report at 9am on the 1st of each month!", ui.ButtonSet.OK);
  } catch(e) {
    ui.alert("❌ Error", "Could not create the trigger. Details: " + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Background helper that runs without showing UI
 */
function generateWeeklyReport_Silent() {
  if (!isTriggerEnabled('generateWeeklyReport_Silent')) {
    Logger.log('🚫 Trigger generateWeeklyReport_Silent is OFF. Skipping.');
    return { success: true, sent: false, skipped: "disabled" };
  }
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log("Skipping the weekly report because another process is running.");
    return { success: true, sent: false, skipped: "already_running" };
  }

  try {
    const properties = PropertiesService.getScriptProperties();
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const periodKey = Utilities.formatDate(monday, "Asia/Ho_Chi_Minh", "yyyy-MM-dd");

    if (properties.getProperty("LAST_WEEKLY_REPORT_PERIOD") === periodKey) {
      Logger.log("Skipping the weekly report already sent for the period starting " + periodKey);
      return { success: true, sent: false, skipped: "already_sent", periodKey: periodKey };
    }

    const result = generateWeeklyReport(true);
    if (result && result.sent) {
      properties.setProperty("LAST_WEEKLY_REPORT_PERIOD", periodKey);
    }
    Logger.log("Weekly report result: " + JSON.stringify(result));
    return result;
  } catch (error) {
    Logger.log("Weekly report trigger failed: " + error.stack);
    sendLogToIT(`Weekly report trigger failed: ${error.message}`, "ERROR", {
      functionName: "generateWeeklyReport_Silent"
    });
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function normalizeReviewRating(value) {
  const normalized = String(value || "").trim().toUpperCase();
  const ratingMap = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
  if (ratingMap[normalized]) return ratingMap[normalized];

  const numericRating = Number(value);
  return Number.isFinite(numericRating) && numericRating >= 1 && numericRating <= 5
    ? numericRating
    : 5;
}

function parseReviewDate(value) {
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  const match = String(value || "").trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (match) {
    const localDate = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return isNaN(localDate.getTime()) ? null : localDate;
  }

  const parsedDate = new Date(value);
  return isNaN(parsedDate.getTime()) ? null : parsedDate;
}

/**
 * Build the weekly summary report and send it via Telegram
 */
function generateWeeklyReport(isSilent = false, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const ss = getSafeSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOG_NAME);
  if (!sheet) throw new Error(`Sheet "${SHEET_LOG_NAME}" not found.`);

  const data = sheet.getDataRange().getValues();
  if (data.length === 0) {
    const sent = sendSimpleTelegramMessage("📊 <b>LAST WEEK'S REVIEW REPORT</b>\n\nNo reviews were recorded last week.", targetChatId);
    if (!sent) throw new Error("Telegram did not confirm sending the empty weekly report.");
    return { success: true, sent: true, totalReviews: 0 };
  }

  // Get the timestamp from 7 days ago
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let reportText3Thang2 = "";
  let reportTextTBH = "";
  let totalReviews = 0;
  let totalStars = 0;
  let staffMentionCount = {};

  // The Reviews sheet has no header; rows without a valid date are skipped automatically.
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const dateValue = row[COL_DATE - 1];
    
    if (!dateValue) continue;
    
    const reviewDate = parseReviewDate(dateValue);
    if (!reviewDate) continue;
    
    if (reviewDate >= sevenDaysAgo) {
      const rating = normalizeReviewRating(row[COL_RATING - 1]);
      const content = String(row[COL_CONTENT - 1] || "");
      const tags = String(row[COL_TAGS - 1] || "");
      const locationName = String(row[COL_LOCATION - 1] || "Unknown");
      
      let reviewString = "";
      if (content.trim().length > 0 || tags.trim().length > 0) {
        reviewString = `- ${rating} SAO: "${content}" (Tags: ${tags})\n`;
      }
      
      const mentionedStaffStr = String(row[COL_STAFF - 1] || "");
      if (mentionedStaffStr.trim().length > 0) {
        const names = mentionedStaffStr.split(",").map(s => s.trim()).filter(s => s);
        for (let name of names) {
          staffMentionCount[name] = (staffMentionCount[name] || 0) + 1;
        }
      }
      
      if (locationName.toUpperCase().includes("3 THÁNG 2") || locationName.includes("3/2")) {
        reportText3Thang2 += reviewString;
      } else if (locationName.toUpperCase().includes("TBH") || locationName.toUpperCase().includes("TRẦN BÌNH TRỌNG")) {
        reportTextTBH += reviewString;
      } else {
        reportText3Thang2 += reviewString; // Default to branch 1 if unclear
      }

      totalReviews++;
      totalStars += rating;
    }
  }

  if (totalReviews === 0) {
    const sent = sendSimpleTelegramMessage("📊 <b>LAST WEEK'S REVIEW REPORT</b>\n\nNo reviews were recorded last week.", targetChatId);
    if (!sent) throw new Error("Telegram did not confirm sending the empty weekly report.");
    if (!isSilent && SpreadsheetApp.getActiveSpreadsheet()) {
      SpreadsheetApp.getUi().alert("Notice", "No reviews to report from last week.", SpreadsheetApp.getUi().ButtonSet.OK);
    }
    return { success: true, sent: true, totalReviews: 0 };
  }

  const avgStar = (totalStars / totalReviews).toFixed(1);
  
  if (!isSilent && SpreadsheetApp.getActiveSpreadsheet()) {
    SpreadsheetApp.getUi().alert("Analyzing data...", `Found ${totalReviews} reviews in the past 7 days. The system is calling the AI to analyze them and will send the result to Telegram shortly.`, SpreadsheetApp.getUi().ButtonSet.OK);
  }

  let fullReportText = `--- CHI NHÁNH 3/2 ---\n${reportText3Thang2}\n\n--- CHI NHÁNH TBH ---\n${reportTextTBH}`;
  let staffSummaryText = "";
  if (Object.keys(staffMentionCount).length > 0) {
    staffSummaryText = "\n\n🏆 <b>Staff praised this week:</b>\n" + 
      Object.keys(staffMentionCount)
        .sort((a,b) => staffMentionCount[b] - staffMentionCount[a])
        .map(name => `- ${name}: ${staffMentionCount[name]} time(s)`)
        .join("\n");
  }

  try {
    const summary = generateWeeklySummaryWithAI(fullReportText, totalReviews, avgStar);
    const sent = sendSimpleTelegramMessage(`📊 <b>BÁO CÁO REVIEW TUẦN QUA</b>\n\n${summary}${staffSummaryText}`, targetChatId);
    if (!sent) throw new Error("Telegram did not confirm sending the weekly report.");

    // Only save the summary after Telegram confirms it was sent.
    saveWeeklySummary(summary);
    return { success: true, sent: true, totalReviews: totalReviews, avgStar: avgStar };
  } catch (error) {
    Logger.log("Error building the weekly report: " + error.message);
    if (isSilent) {
      throw error;
    }
    if (targetChatId) {
      sendSimpleTelegramMessage(`❌ Error building the weekly report: ${error.message}`, targetChatId);
    }
    if (!isSilent && SpreadsheetApp.getActiveSpreadsheet()) {
      SpreadsheetApp.getUi().alert("Error", "Could not build the report. Details: " + error.message, SpreadsheetApp.getUi().ButtonSet.OK);
    }
    return { success: false, sent: false, error: error.message };
  }
}

/**
 * Save the weekly summary into a hidden sheet
 */
function saveWeeklySummary(summaryText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeSpreadsheet();
  let sheet = ss.getSheetByName("Weekly Summaries");
  if (!sheet) {
    sheet = ss.insertSheet("Weekly Summaries");
    sheet.appendRow(["Timestamp", "MonthYear", "SummaryText"]);
    sheet.hideSheet(); // Hide the sheet to keep things tidy
  }
  
  const now = new Date();
  const monthYearStr = `${now.getFullYear()}-${(now.getMonth() + 1).toString().padStart(2, '0')}`;
  sheet.appendRow([now, monthYearStr, summaryText]);
}

/**
 * Build the monthly summary report (0: this month, -1: last month)
 */
function generateMonthlyReport(monthOffset = 0, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOG_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const now = new Date();
  let targetYear = now.getFullYear();
  let targetMonth = now.getMonth() + monthOffset;
  
  if (targetMonth < 0) {
    targetMonth = 11;
    targetYear--;
  }
  
  let lastMonth = targetMonth - 1;
  let lastMonthYear = targetYear;
  if (lastMonth < 0) {
    lastMonth = 11;
    lastMonthYear--;
  }

  let totalReviews = 0;
  let totalStars = 0;
  let fiveStarCount = 0;
  let lowStarCount = 0;
  let staffMentionCount = {};
  
  let lastMonthReviews = 0;
  let lastMonthStars = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dateValue = row[COL_DATE - 1];
    if (!dateValue) continue;
    
    let reviewDate;
    try {
      reviewDate = new Date(dateValue);
    } catch(e) {
      continue;
    }
    
    const rYear = reviewDate.getFullYear();
    const rMonth = reviewDate.getMonth();
    const rating = parseInt(row[COL_RATING - 1] || 5);
    
    // Count for last month
    if (rYear === lastMonthYear && rMonth === lastMonth) {
      lastMonthReviews++;
      lastMonthStars += rating;
    }

    // Count for this month
    if (rYear === targetYear && rMonth === targetMonth) {
      if (rating === 5) fiveStarCount++;
      if (rating <= 2) lowStarCount++;
      
      const mentionedStaffStr = row[COL_STAFF - 1] || "";
      if (mentionedStaffStr.trim().length > 0) {
        const names = mentionedStaffStr.split(",").map(s => s.trim()).filter(s => s);
        for (let name of names) {
          staffMentionCount[name] = (staffMentionCount[name] || 0) + 1;
        }
      }
      
      totalReviews++;
      totalStars += rating;
    }
  }

  const monthName = targetMonth + 1;
  if (totalReviews === 0) {
    sendSimpleTelegramMessage(`📊 <b>MONTHLY REPORT ${monthName}/${targetYear}</b>\n\nNo reviews were recorded this month.`, targetChatId);
    return;
  }

  const avgStar = (totalReviews > 0) ? (totalStars / totalReviews).toFixed(2) : 0;
  const lastAvgStar = (lastMonthReviews > 0) ? (lastMonthStars / lastMonthReviews).toFixed(2) : 0;
  
  let staffSummaryText = "No staff were named this month.";
  if (Object.keys(staffMentionCount).length > 0) {
    staffSummaryText = 
      Object.keys(staffMentionCount)
        .sort((a,b) => staffMentionCount[b] - staffMentionCount[a])
        .map(name => `- ${name}: ${staffMentionCount[name]} mention(s)`)
        .join("\n");
  }
  // Read the weekly summaries within the month
  const targetMonthStr = `${targetYear}-${(targetMonth + 1).toString().padStart(2, '0')}`;
  let weeklySummariesText = "";
  const sumSheet = ss.getSheetByName("Weekly Summaries");
  if (sumSheet) {
    const sumData = sumSheet.getDataRange().getValues();
    for (let i = 1; i < sumData.length; i++) {
      if (sumData[i][1] === targetMonthStr) {
        weeklySummariesText += `--- BÁO CÁO TUẦN TRONG THÁNG ---\n${sumData[i][2]}\n\n`;
      }
    }
  }

  let aiSummaryStr = "";
  if (weeklySummariesText.trim().length > 0) {
    const stats = {
      totalReviews: totalReviews,
      avgStar: avgStar,
      lastMonthReviews: lastMonthReviews,
      lastAvgStar: lastAvgStar,
      fiveStarCount: fiveStarCount,
      lowStarCount: lowStarCount,
      monthName: monthName,
      targetYear: targetYear
    };
    
    try {
      aiSummaryStr = generateMonthlySummaryWithAI(weeklySummariesText, stats) + "\n\n";
      saveMonthlySummary(targetMonthStr, aiSummaryStr);
    } catch (error) {
      Logger.log("Error building the monthly report with AI: " + error.message);
      if (targetChatId) {
        sendSimpleTelegramMessage(`❌ Error analyzing the monthly report: ${error.message}`, targetChatId);
      }
    }
  } else {
    aiSummaryStr = `📈 <b>Total reviews:</b> ${totalReviews}\n⭐ <b>Average rating:</b> ${avgStar} stars\n\n`;
    saveMonthlySummary(targetMonthStr, aiSummaryStr);
  }

  const msg = aiSummaryStr +
              `🏆 <b>Staff Honor Roll:</b>\n${staffSummaryText}\n\n` +
              `<i>(Bonus calculations will be added later on request.)</i>`;
              
  sendSimpleTelegramMessage(msg, targetChatId);
}

function generateMonthlyReport_Silent() {
  if (!isTriggerEnabled('generateMonthlyReport_Silent')) {
    Logger.log('🚫 Trigger generateMonthlyReport_Silent is OFF. Skipping.');
    return;
  }
  generateMonthlyReport(-1); // The 1st-of-month auto-run exports the previous month's report
}

/**
 * Save the monthly summary into a hidden sheet (match MonthYear to overwrite and avoid duplicates)
 */
function saveMonthlySummary(monthYearStr, summaryText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeSpreadsheet();
  let sheet = ss.getSheetByName("Monthly Summaries");
  if (!sheet) {
    sheet = ss.insertSheet("Monthly Summaries");
    sheet.appendRow(["Timestamp", "MonthYear", "SummaryText"]);
    sheet.hideSheet(); // Hide the sheet to keep things tidy
  }
  
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][1] === monthYearStr) {
      rowIndex = i + 1;
      break;
    }
  }
  
  const now = new Date();
  if (rowIndex !== -1) {
    // Update the existing row
    sheet.getRange(rowIndex, 1).setValue(now);
    sheet.getRange(rowIndex, 3).setValue(summaryText);
  } else {
    // Add a new row
    sheet.appendRow([now, monthYearStr, summaryText]);
  }
}

/**
 * Build the yearly summary report
 */
function generateYearlyReport(yearOffset = 0, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_LOG_NAME);
  if (!sheet) return;

  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return;

  const now = new Date();
  const targetYear = now.getFullYear() + yearOffset;

  let totalReviews = 0;
  let totalStars = 0;
  let fiveStarCount = 0;
  let lowStarCount = 0;
  let staffMentionCount = {};

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const dateValue = row[COL_DATE - 1];
    if (!dateValue) continue;

    let reviewDate;
    try {
      reviewDate = new Date(dateValue);
    } catch(e) {
      continue;
    }

    const rYear = reviewDate.getFullYear();
    if (rYear === targetYear) {
      const rating = parseInt(row[COL_RATING - 1] || 5);
      if (rating === 5) fiveStarCount++;
      if (rating <= 2) lowStarCount++;

      const mentionedStaffStr = row[COL_STAFF - 1] || "";
      if (mentionedStaffStr.trim().length > 0) {
        const names = mentionedStaffStr.split(",").map(s => s.trim()).filter(s => s);
        for (let name of names) {
          staffMentionCount[name] = (staffMentionCount[name] || 0) + 1;
        }
      }

      totalReviews++;
      totalStars += rating;
    }
  }

  if (totalReviews === 0) {
    sendSimpleTelegramMessage(`📊 <b>YEARLY REPORT ${targetYear}</b>\n\nNo reviews were recorded this year.`, targetChatId);
    return;
  }

  const avgStar = (totalReviews > 0) ? (totalStars / totalReviews).toFixed(2) : 0;

  let staffSummaryText = "No staff were named this year.";
  if (Object.keys(staffMentionCount).length > 0) {
    staffSummaryText = 
      Object.keys(staffMentionCount)
        .sort((a,b) => staffMentionCount[b] - staffMentionCount[a])
        .map(name => `- ${name}: ${staffMentionCount[name]} mention(s)`)
        .join("\n");
  }

  // Read the monthly summaries for the year from the hidden "Monthly Summaries" sheet
  const targetYearStr = targetYear.toString();
  let monthlySummariesText = "";
  const sumSheet = ss.getSheetByName("Monthly Summaries");
  if (sumSheet) {
    const sumData = sumSheet.getDataRange().getValues();
    for (let i = 1; i < sumData.length; i++) {
      const monthYear = sumData[i][1] ? sumData[i][1].toString() : "";
      if (monthYear.indexOf(targetYearStr) === 0) {
        monthlySummariesText += `--- BÁO CÁO THÁNG ${monthYear} ---\n${sumData[i][2]}\n\n`;
      }
    }
  }

  let aiSummaryStr = "";
  if (monthlySummariesText.trim().length > 0) {
    const stats = {
      totalReviews: totalReviews,
      avgStar: avgStar,
      fiveStarCount: fiveStarCount,
      lowStarCount: lowStarCount,
      targetYear: targetYear
    };

    try {
      aiSummaryStr = generateYearlySummaryWithAI(monthlySummariesText, stats) + "\n\n";
    } catch (error) {
      Logger.log("Error building the yearly report with AI: " + error.message);
      if (targetChatId) {
        sendSimpleTelegramMessage(`❌ Error analyzing the yearly report: ${error.message}`, targetChatId);
      }
    }
  } else {
    aiSummaryStr = `📈 <b>Total reviews this year:</b> ${totalReviews}\n⭐ <b>Average rating:</b> ${avgStar} stars\n\n`;
  }

  const msg = aiSummaryStr +
              `🏆 <b>Staff Honor Roll (Year):</b>\n${staffSummaryText}\n\n` +
              `<i>(Yearly bonus calculations will be integrated later if requested.)</i>`;

  sendSimpleTelegramMessage(msg, targetChatId);
}

/**
 * Run the yearly report from the Sheet menu (prompts for the year)
 */
function runYearlyReportFromMenu() {
  const ui = SpreadsheetApp.getUi();
  const response = ui.prompt(
    "Build Yearly Report",
    "Enter the year to report on (e.g. 2026). Leave blank for the current year:",
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  const inputYear = response.getResponseText().trim();
  let yearOffset = 0;
  if (inputYear) {
    const yearNum = parseInt(inputYear);
    if (!isNaN(yearNum)) {
      yearOffset = yearNum - new Date().getFullYear();
    }
  }
  ui.alert("Notice", "Preparing the yearly report. Please wait and check Telegram...", ui.ButtonSet.OK);
  generateYearlyReport(yearOffset);
}

/**
 * STAGE 2: Queue Processor
 * Runs in the background via a trigger (e.g. every 5 minutes).
 * Finds up to 20 reviews that are "waiting_ai" or blank (pushed in by Make), has the AI write replies, then sends them to Telegram.
 */
function processAIQueue(targetChatId = null) {
  // Avoid errors when the Apps Script trigger passes an Event Object (e) as the first argument
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }

  // Clean up rows stuck in 'publishing' for over 15 minutes
  try {
    checkAndResetStuckPublishing();
  } catch(e) {
    Logger.log("Error in checkAndResetStuckPublishing: " + e.toString());
  }
  
  // Auto-retry publishing for rows with connection_error / publish_failed
  try {
    retryPublishQueue();
  } catch(e) {
    Logger.log("Error in retryPublishQueue: " + e.toString());
  }

  if (!targetChatId && !isTriggerEnabled('processAIQueue')) {
    Logger.log('🚫 Trigger processAIQueue is OFF. Skipping.');
    return;
  }
  const ss = getSafeSpreadsheet();
  const logSheet = ss.getSheetByName("Reviews"); // Your sheet is named Reviews
  if (!logSheet) return;
  
  const lastRow = logSheet.getLastRow();
  if (lastRow <= 1) return;
  
  // Read all existing data
  const data = logSheet.getDataRange().getValues();
  
  let processedCount = 0;
  const BATCH_LIMIT = 20; // Raised to 20 per the user's request
  
  // Loop over all rows (start at 0 since the sheet has no header)
  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const reviewId = row[0];        // Column A
    const reviewerName = row[1];    // Column B
    const rating = row[2];          // Column C (FIVE, FOUR...)
    const comment = row[3];         // Column D
    const status = row[5];          // Column F
    const locationName = row[6] || "La Lapine"; // Column G
    
    const s = status ? status.toString().trim().toLowerCase() : "";
    
    // Check how long it's been stuck
    let isStuckTooLong = false;
    if (s === "pending" || s === "ai_error") {
      const updatedAt = row[COL_UPDATED_AT - 1]; // Column L
      if (updatedAt) {
        try {
          const diffHours = (new Date() - new Date(updatedAt)) / (1000 * 60 * 60);
          if (diffHours >= 6) { // Auto-resend after 6 hours
            isStuckTooLong = true;
          }
        } catch(e) {}
      } else {
        isStuckTooLong = true; // No timestamp -> treat as stuck
      }
    }

    // If status is blank, "waiting_ai", or stuck over 6 hours
    if (s === "" || s === "waiting_ai" || s === "waiting_ai" || isStuckTooLong) {
      const rowIndex = i + 1; // +1 because the array starts at 0
      
      Logger.log(`Calling AI for ${reviewerName}'s review...`);
      if (isStuckTooLong) {
        sendLogToIT(`Customer ${reviewerName}'s review was stuck in "${status}" for over 6 hours. The system is automatically re-running the AI.`, "WARNING");
      }
      
      // Convert the star format
      let numericRating = 5;
      if (rating === "FIVE") numericRating = 5;
      else if (rating === "FOUR") numericRating = 4;
      else if (rating === "THREE") numericRating = 3;
      else if (rating === "TWO") numericRating = 2;
      else if (rating === "ONE") numericRating = 1;
      
      // Create a shortId if missing (rows pushed in by Make.com have none)
      let shortId = row[12]; // Column 13 (M)
      if (!shortId) {
        shortId = Utilities.getUuid().substring(0, 8);
        logSheet.getRange(rowIndex, 13).setValue(shortId);
      }

      let aiOutput;
      try {
        aiOutput = generateRepliesWithAI(reviewerName, numericRating, comment, locationName);
        if (!aiOutput || !aiOutput.options) {
          throw new Error("The returned data is empty or missing options.");
        }
      } catch (error) {
        Logger.log("AI generation error for " + reviewerName + ": " + error.message);
        sendLogToIT(`AI generation error for customer ${reviewerName}.\nDetails: ${error.message}`, "ERROR");
        logSheet.getRange(rowIndex, COL_STATUS).setValue("ai_error");
        logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
        SpreadsheetApp.flush();
        
        const inlineKeyboard = {
          inline_keyboard: [
            [
              { text: "🔄 Retry AI", callback_data: `retryai_${shortId}` },
              { text: "✍️ Write my own reply", callback_data: `custom_${shortId}` }
            ]
          ]
        };
        const config = getSystemConfig();
        UrlFetchApp.fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify({ 
            chat_id: targetChatId || config.telegramChatId, 
            text: `⚠️ *REPLY GENERATION ERROR (AI)*\n\nCould not generate a reply for *${reviewerName}*.\n\n*Reason:* ${error.message}\n\nWhat would you like to do next?`,
            parse_mode: "Markdown",
            reply_markup: JSON.stringify(inlineKeyboard)
          }),
          muteHttpExceptions: true
        });
        continue;
      }
      
      const opt1Text = formatOptionText(aiOutput.options[0]);
      const opt2Text = formatOptionText(aiOutput.options[1]);
      const opt3Text = formatOptionText(aiOutput.options[2]);
      
      // Save AI results to the sheet: Option 1 (H), 2 (I), 3 (J)
      logSheet.getRange(rowIndex, COL_OPTION_1).setValue(opt1Text);  
      logSheet.getRange(rowIndex, COL_OPTION_2).setValue(opt2Text);  
      logSheet.getRange(rowIndex, COL_OPTION_3).setValue(opt3Text); 
      logSheet.getRange(rowIndex, COL_STATUS).setValue("pending"); // Change status in Column F
      logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date()); // Save the time to detect stalls
      
      // SAVE KEYWORD TAGS TO COLUMN 14 (N)
      if (aiOutput.tags && Array.isArray(aiOutput.tags) && aiOutput.tags.length > 0) {
        logSheet.getRange(rowIndex, COL_TAGS).setValue(aiOutput.tags.join(", "));
      }

      // SAVE NAMED STAFF TO COLUMN 15 (O)
      if (aiOutput.mentionedStaff && Array.isArray(aiOutput.mentionedStaff) && aiOutput.mentionedStaff.length > 0) {
        logSheet.getRange(rowIndex, COL_STAFF).setValue(aiOutput.mentionedStaff.join(", "));
      }

      // Send to Telegram
      const reviewData = {
        reviewId: reviewId,
        shortId: shortId,
        locationName: locationName,
        reviewerName: reviewerName,
        rating: numericRating,
        comment: comment,
        hasMedia: false 
      };
      
      const rawOptions = [
        { tone: aiOutput.options[0]?.tone || "Option 1", replyText: extractCleanReply(opt1Text), englishTranslation: aiOutput.options[0]?.englishTranslation || "" },
        { tone: aiOutput.options[1]?.tone || "Option 2", replyText: extractCleanReply(opt2Text), englishTranslation: aiOutput.options[1]?.englishTranslation || "" },
        { tone: aiOutput.options[2]?.tone || "Option 3", replyText: extractCleanReply(opt3Text), englishTranslation: aiOutput.options[2]?.englishTranslation || "" }
      ];

      const msgId = sendTelegramReviewNotification(reviewData, rawOptions, targetChatId);
      if (msgId) {
        logSheet.getRange(rowIndex, COL_TELEGRAM_MSG_ID).setValue(msgId);
      }
      SpreadsheetApp.flush(); // Save to the sheet immediately so this customer never gets processed twice
      processedCount++;
      
      if (processedCount >= BATCH_LIMIT) break;
    }
  }
  
  const msg = `Processed the AI and sent Telegram for ${processedCount} review(s).`;
  Logger.log(msg);
  if (processedCount > 0) {
    sendLogToIT(`Queue scan complete! Processed and pushed ${processedCount} review(s) to the approval group.`, "SUCCESS");
  }
}

/**
 * WEBHOOK ENDPOINT: receives two-way callbacks from the Telegram bot.
 * 
 * @param {Object} e The POST request data sent by Telegram
 */
function doPost(e) {
  try {
    let postData = {};
    if (e.postData && e.postData.contents) {
      postData = JSON.parse(e.postData.contents);
    }
    
    // De-duplicate Telegram webhooks to avoid spam/timeout retries
    if (postData.update_id) {
      const cache = CacheService.getScriptCache();
      const cacheKey = "update_" + postData.update_id;
      if (cache.get(cacheKey)) {
        return HtmlService.createHtmlOutput("OK"); // Already handled, skip
      }
      cache.put(cacheKey, "processed", 21600); // Cache for 6 hours
    }
    
    // If this is a dashboard API call (has postData.action), skip the Telegram token check
    if (postData.action) {
      let result = { success: false, error: 'Unknown action' };
      if (postData.action === 'getSettings') {
        result = getSettingsAPI();
      } else if (postData.action === 'saveSettings') {
        result = saveSettingsAPI(postData.settings);
      } else if (postData.action === 'runAction') {
        result = executeActionAPI(postData.functionName, postData);
      } else if (postData.action === 'getTriggerRegistry') {
        result = getTriggerRegistryAPI();
      } else if (postData.action === 'updateTriggerStatus') {
        result = updateTriggerStatusAPI(postData);
      } else if (postData.action === 'getReviews') {
        result = getReviewsAPI(postData);
      } else if (postData.action === 'claimReview') {
        result = claimReviewAPI(postData);
      } else if (postData.action === 'approveClaim') {
        result = approveClaimAPI(postData);
      } else if (postData.action === 'rejectClaim') {
        result = rejectClaimAPI(postData);
      } else if (postData.action === 'getReviewStats') {
        result = getReviewStatsAPI(postData);
      } else {
        result = { success: false, error: `Invalid action: ${postData.action}` };
      }
      return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
    }

    // 1. Verify the secret token (Telegram webhook only)
    const secretToken = PropertiesService.getScriptProperties().getProperty("TELEGRAM_SECRET");
    if (secretToken && e.parameter.token !== secretToken) {
      return HtmlService.createHtmlOutput("Unauthorized");
    }
    
    // CASE 1: handle an approval button tap (callback query)
    if (postData.callback_query) {
      // Turn off the Telegram loading spinner immediately
      try {
        const config = getSystemConfig();
        UrlFetchApp.fetch(`https://api.telegram.org/bot${config.telegramToken}/answerCallbackQuery`, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify({ callback_query_id: postData.callback_query.id }),
          muteHttpExceptions: true
        });
      } catch(ignore) {}

      handleTelegramCallback(postData.callback_query);
    } 
    // CASE 2: handle a user typing a custom reply
    else if (postData.message && postData.message.text) {
      handleTelegramMessage(postData.message);
    }
  } catch (error) {
    Logger.log("Error handling the doPost webhook: " + error.toString());
    // Send the error straight to the IT Telegram group to catch the culprit
    sendLogToIT(`SILENT SYSTEM CRASH (doPost)!\n\nError: ${error.message}\nStack: ${error.stack}`, "ERROR");
  }
  
  // ALWAYS return 200 via HtmlService to avoid Google's 302 redirect (which confuses Telegram into retrying endlessly)
  return HtmlService.createHtmlOutput("OK");
}

/**
 * Handle the user tapping an option-approval button on Telegram
 */
function handleTelegramCallback(callbackQuery) {
  const data = callbackQuery.data; // "opt1_[shortId]"
  const messageId = callbackQuery.message.message_id;
  const sourceChatId = callbackQuery.message.chat.id;
  
  const cache = CacheService.getScriptCache();
  const lockKey = `cb_lock_${sourceChatId}_${messageId}`;
  
  if (cache.get(lockKey)) {
    try {
      const configResult = getSettingsAPI();
      const token = configResult.success ? configResult.settings.telegramToken : null;
      if (token) {
        UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: "Your request is being processed, please wait...",
            show_alert: false
          })
        });
      }
    } catch(e) {}
    return;
  }
  
  cache.put(lockKey, 'processing', 15);
  
  if (data === "test_webhook") {
    try {
      const configResult = getSettingsAPI();
      const token = configResult.success ? configResult.settings.telegramToken : null;
      if (token) {
        UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify({
            callback_query_id: callbackQuery.id,
            text: "✅ BINGO! The two-way communication is working perfectly!",
            show_alert: true
          })
        });
        
        UrlFetchApp.fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify({
            chat_id: callbackQuery.message.chat.id,
            message_id: messageId,
            text: "✅ <b>TEST SUCCESSFUL</b>\n\nGreat! Your webhook responded correctly. The bot is ready to receive commands from Telegram.",
            parse_mode: "HTML"
          })
        });
      }
    } catch(e) {
      Logger.log("Error test_webhook: " + e.message);
    }
    return;
  }

  const separatorIndex = data.indexOf("_");
  const action = separatorIndex !== -1 ? data.substring(0, separatorIndex) : data;
  const shortId = separatorIndex !== -1 ? data.substring(separatorIndex + 1) : "";

  const ss = getSafeSpreadsheet();
  const logSheet = ss.getSheetByName(SHEET_LOG_NAME);
  
  // Find the row matching this shortId (scan column 13)
  const rowIndex = findRowIndexByShortId(logSheet, shortId);
  
  if (rowIndex === -1) {
    sendSimpleTelegramMessage("⚠️ This button's data is too old or was deleted. Please handle it manually in Google Sheets.", sourceChatId);
    return;
  }
  
  // Once the row is found, get the original review ID from column A (1)
  const reviewId = logSheet.getRange(rowIndex, 1).getValue().toString();

  // Read the current row data from the sheet
  const rowValues = logSheet.getRange(rowIndex, 1, 1, 10).getValues()[0];
  const reviewerName = rowValues[1]; // Column B
  const rating = rowValues[2]; // Column C
  const status = rowValues[5]; // Column F
  const locationName = rowValues[6]; // Column G

  if (status === "replied" || status === "publishing") {
    sendSimpleTelegramMessage(`⚠️ This review ${status === "publishing" ? "is currently being published" : "was already replied to"}!`, sourceChatId);
    const review = {
      locationName: locationName,
      reviewerName: reviewerName,
      rating: translateStarRating(rating),
      comment: rowValues[3]
    };
    const selectionVal = logSheet.getRange(rowIndex, COL_SELECTION).getValue().toString() || rowValues[10]; // Column K (COL_SELECTION)
    collapseTelegramMessage(messageId, review, selectionVal, callbackQuery.from.first_name || "Manager", sourceChatId);
    return;
  }
  
  if (action === "retryai") {
    logSheet.getRange(rowIndex, COL_STATUS).setValue("waiting_ai");
    logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
    editTelegramMessageText(messageId, `⏳ Queued <b>${escapeHTML(reviewerName)}</b> for the AI to retry on the next scan (5 min).`, sourceChatId);
    return;
  }
  
  if (action === "cancel_custom") {
    const userCache = CacheService.getScriptCache();
    userCache.remove(`waiting_reply_for_${callbackQuery.from.id}`);
    userCache.remove(`waiting_msg_for_${callbackQuery.from.id}`);
    const helperMsgId = userCache.get(`waiting_helper_msg_for_${callbackQuery.from.id}`);
    if (helperMsgId) {
      deleteTelegramMessage(Number(helperMsgId), sourceChatId);
      userCache.remove(`waiting_helper_msg_for_${callbackQuery.from.id}`);
    } else {
      editTelegramMessageText(messageId, `❌ Cancelled the manual-typing session for <b>${escapeHTML(reviewerName)}</b>.`, sourceChatId);
    }
    return;
  }

  // ACTION 1: pick one of the 3 generated options
  if (action === "opt1" || action === "opt2" || action === "opt3") {
    let optionText = "";
    let optionLabel = "";
    
    if (action === "opt1") {
      optionText = extractCleanReply(rowValues[7]); // Column H
      optionLabel = "Option 1";
    } else if (action === "opt2") {
      optionText = extractCleanReply(rowValues[8]); // Column I
      optionLabel = "Option 2";
    } else if (action === "opt3") {
      optionText = extractCleanReply(rowValues[9]); // Column J
      optionLabel = "Option 3";
    }

    // Set status to 'publishing' and save the chosen reply text
    logSheet.getRange(rowIndex, COL_STATUS).setValue("publishing");
    logSheet.getRange(rowIndex, COL_SELECTION).setValue(optionText);
    logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
    logSheet.getRange(rowIndex, COL_RETRY_COUNT).setValue(0);
    logSheet.getRange(rowIndex, COL_ERROR_MESSAGE).setValue("");
    logSheet.getRange(rowIndex, COL_TELEGRAM_MSG_ID).setValue(messageId);
    SpreadsheetApp.flush();

    // Update the Telegram UI so the user knows it's processing
    editTelegramMessageText(messageId, `⏳ Sending <b>${escapeHTML(reviewerName)}</b>'s reply (choice: ${optionLabel}) to Google Maps via Make.com...`, sourceChatId);

    // GỌI MAKE.COM WEBHOOK THAY VÌ GỌI GOOGLE MAPS API
    let isSuccess = false;
    try {
      const config = getSystemConfig();
      const scriptUrl = ScriptApp.getService().getUrl();
      UrlFetchApp.fetch(config.makeWebhookUrl, {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify({ 
          reviewId: reviewId, 
          replyText: optionText, 
          locationName: locationName,
          scriptUrl: scriptUrl
        })
      });
      isSuccess = true;
    } catch(e) {
      Logger.log("Error sending webhook: " + e.toString());
      isSuccess = false;
    }
    
    if (isSuccess) {
      sendLogToIT(`Sent the reply webhook for ${reviewerName} successfully. Waiting for Make.com to confirm publishing...`, "INFO");
    } else {
      // Set status to connection_error to trigger the auto-retry mechanism
      logSheet.getRange(rowIndex, COL_STATUS).setValue("connection_error");
      logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
      SpreadsheetApp.flush();
      
      editTelegramMessageText(messageId, `❌ Webhook connection error while sending the reply for <b>${escapeHTML(reviewerName)}</b>. The system will retry automatically.`, sourceChatId);
      sendLogToIT(`Make webhook connection error for review ID ${reviewId} (customer ${reviewerName}). Queued for auto-retry.`, "ERROR");
    }
  } 
  // ACTION 2: the user chooses to write a custom reply
  else if (action === "custom") {
    const userCache = CacheService.getScriptCache();
    userCache.put(`waiting_reply_for_${callbackQuery.from.id}`, reviewId, 600);
    userCache.put(`waiting_msg_for_${callbackQuery.from.id}`, messageId.toString(), 600);
    
    const inlineKeyboard = {
      inline_keyboard: [[{ text: "❌ Cancel typing", callback_data: `cancel_custom_${shortId}` }]]
    };
    const config = getSystemConfig();
    const helperResponse = UrlFetchApp.fetch(`https://api.telegram.org/bot${config.telegramToken}/sendMessage`, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ 
        chat_id: sourceChatId, 
        text: `✍️ <b>Type your next message</b> to write a custom reply for <b>${escapeHTML(reviewerName)}</b>.\n\n<i>Or tap Cancel if you change your mind.</i>`,
        parse_mode: "HTML",
        reply_markup: JSON.stringify(inlineKeyboard)
      }),
      muteHttpExceptions: true
    });
    
    try {
      const helperResult = JSON.parse(helperResponse.getContentText());
      if (helperResult.ok) {
        userCache.put(`waiting_helper_msg_for_${callbackQuery.from.id}`, helperResult.result.message_id.toString(), 600);
      }
    } catch (e) {
      Logger.log(`Error saving the helper message ID: ${e.toString()}`);
    }
  }
  
  // Release the lock for non-final actions (custom typing, cancel, retryai)
  if (action === "retryai" || action === "custom" || action.startsWith("cancel_custom")) {
    cache.remove(lockKey);
  }
}

/**
 * Handle a custom text message you send to the Telegram bot
 */
function handleTelegramMessage(message) {
  const userId = message.from.id;
  const sourceChatId = message.chat.id;
  const userText = message.text.trim();
  const config = getSystemConfig();
  const userCache = CacheService.getScriptCache();

  const reviewId = userCache.get(`waiting_reply_for_${userId}`);

  // SECURITY: only admins may use commands (/report, /status...) or chat freely.
  // Identify admins by their personal Telegram User ID:
  // 1. Telegram User ID matches config.telegramITChatId (if a personal chat is set in B20)
  // 2. Telegram User ID matches a staff member whose code is the configured owner ID in the staff list
  const isAdmin = userId.toString() === config.telegramITChatId.toString() ||
                  config.staffList.some(s => s.telegram && s.telegram.toString() === userId.toString() && 
                  (s.id === config.ownerStaffId)); // <-- set your owner staff code in the Dashboard tab (e.g. "LL005")

  // Managers may ONLY send a message if they just tapped "Write my own reply" (i.e. a reviewId exists).
  if (!reviewId && !isAdmin) {
    return; // Ignore managers/strangers who chat randomly
  }

  // Strip the command so it works even when Telegram appends the bot's @username in a group
  const cmd = userText.split(' ')[0].split('@')[0].toLowerCase();

  // Match commands
  if (cmd === "/status") {
    const ss = getSafeSpreadsheet();
    const logSheet = ss.getSheetByName(SHEET_LOG_NAME);
    if (!logSheet) {
      sendSimpleTelegramMessage("Sheet not found.", sourceChatId);
      return;
    }
    
    const lastRow = logSheet.getLastRow();
    let waitingAI = 0;
    let waitingReview = 0;
    
    if (lastRow > 1) {
      const data = logSheet.getRange(2, COL_STATUS, lastRow - 1, 1).getValues();
      for(let r of data) {
        const s = r[0]?.toString().trim().toLowerCase() || "";
        if (s === "waiting_ai" || s === "waiting_ai" || s === "") waitingAI++;
        if (s === "pending") waitingReview++;
      }
    }
    
    sendSimpleTelegramMessage(`📊 <b>Current Status:</b>\n\n🤖 Waiting for AI: <b>${waitingAI}</b>\n🧑‍💻 Waiting for your approval: <b>${waitingReview}</b>`, sourceChatId);
    return;
  } else if (cmd === "/process") {
    sendSimpleTelegramMessage("⏳ Triggered an immediate AI queue scan...", sourceChatId);
    processAIQueue(sourceChatId);
    return;
  } else if (cmd === "/report") {
    sendSimpleTelegramMessage("⏳ Preparing the weekly report. Please wait...", sourceChatId);
    generateWeeklyReport(true, sourceChatId);
    return;
  } else if (cmd === "/report_month") {
    sendSimpleTelegramMessage("⏳ Calculating this month's staff honor roll. Please wait...", sourceChatId);
    generateMonthlyReport(0, sourceChatId);
    return;
  } else if (cmd === "/report_year") {
    sendSimpleTelegramMessage("⏳ Calculating the staff honor roll and yearly summary. Please wait...", sourceChatId);
    generateYearlyReport(0, sourceChatId);
    return;
  } else if (cmd === "/cancel") {
    userCache.remove(`waiting_reply_for_${userId}`);
    userCache.remove(`waiting_msg_for_${userId}`);
    const helperMsgId = userCache.get(`waiting_helper_msg_for_${userId}`);
    if (helperMsgId) {
      deleteTelegramMessage(Number(helperMsgId), sourceChatId);
      userCache.remove(`waiting_helper_msg_for_${userId}`);
    }
    sendSimpleTelegramMessage("✅ Cancelled the manual-typing state.", sourceChatId);
    return;
  }

  if (!reviewId) {
    // Avoid the bot spamming the group during normal chatter
    if (message.chat.type === "private" || userText.startsWith("/")) {
      sendSimpleTelegramMessage("🧁 Hi! This is the La Lapine Bot.\n\n<b>System commands:</b>\n/status - View review status\n/process - Run an AI scan now\n/report - Weekly report\n/report_month - Monthly rewards report\n/report_year - Year-end report\n/cancel - Cancel manual typing", sourceChatId);
    }
    return;
  }

  const ss = getSafeSpreadsheet();
  const logSheet = ss.getSheetByName(SHEET_LOG_NAME);
  
  // Since there's no reference code in the text step, scan IDs directly (from row 1)
  const lastRow = logSheet.getLastRow();
  if (lastRow < 1) return;
  
  let rowIndex = -1;
  const ids = logSheet.getRange(1, COL_REVIEW_ID, lastRow, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0].toString() === reviewId) {
      rowIndex = i + 1; break; // +1 because the ids array starts at 0, sheet rows start at 1
    }
  }
  
  if (rowIndex === -1) {
    sendSimpleTelegramMessage("⚠️ Error: the matching review row was no longer found in the sheet.", sourceChatId);
    userCache.remove(`waiting_reply_for_${userId}`);
    return;
  }

  const rowValues = logSheet.getRange(rowIndex, 1, 1, 10).getValues()[0];
  const locationName = logSheet.getRange(rowIndex, COL_LOCATION).getValue().toString(); 
  
  // Check the status to prevent duplicates
  const status = logSheet.getRange(rowIndex, COL_STATUS).getValue().toString().trim();
  if (status === "replied" || status === "publishing") {
    sendSimpleTelegramMessage(`⚠️ This review ${status === "publishing" ? "is currently being published" : "was already replied to"}!`, sourceChatId);
    userCache.remove(`waiting_reply_for_${userId}`);
    userCache.remove(`waiting_msg_for_${userId}`);
    userCache.remove(`waiting_helper_msg_for_${userId}`);
    return;
  }

  // Read the message IDs from cache before cleanup
  const origMessageId = userCache.get(`waiting_msg_for_${userId}`);
  const helperMsgId = userCache.get(`waiting_helper_msg_for_${userId}`);

  // Set status to 'publishing' to lock the row
  logSheet.getRange(rowIndex, COL_STATUS).setValue("publishing");
  logSheet.getRange(rowIndex, COL_SELECTION).setValue(userText); 
  logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
  logSheet.getRange(rowIndex, COL_RETRY_COUNT).setValue(0);
  logSheet.getRange(rowIndex, COL_ERROR_MESSAGE).setValue("");
  SpreadsheetApp.flush();

  // Clear cache keys immediately to avoid resending messages
  userCache.remove(`waiting_reply_for_${userId}`);
  userCache.remove(`waiting_msg_for_${userId}`);
  userCache.remove(`waiting_helper_msg_for_${userId}`);
  
  // Delete the helper instruction message to keep the group clean
  if (helperMsgId) {
    deleteTelegramMessage(Number(helperMsgId), sourceChatId);
  }
  
  // Update the progress message for the user
  if (origMessageId) {
    editTelegramMessageText(Number(origMessageId), `⏳ Sending <b>${escapeHTML(message.from.first_name)}</b>'s custom reply to Google Maps via Make.com...`, sourceChatId);
  } else {
    sendSimpleTelegramMessage(`⏳ Sending the custom reply to Google Maps via Make.com...`, sourceChatId);
  }
  
  // GỌI MAKE.COM WEBHOOK
  let isSuccess = false;
  try {
    const scriptUrl = ScriptApp.getService().getUrl();
    UrlFetchApp.fetch(config.makeWebhookUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify({ 
        reviewId: reviewId, 
        replyText: userText, 
        locationName: locationName,
        scriptUrl: scriptUrl
      })
    });
    isSuccess = true;
  } catch(e) {
    Logger.log("Error sending the custom webhook: " + e.toString());
    isSuccess = false;
  }
  
  if (isSuccess) {
    sendLogToIT(`Sent the custom reply webhook for ${rowValues[1]} successfully. Waiting for Make.com to confirm...`, "INFO");
  } else {
    // Set status to connection_error for later auto-retry
    logSheet.getRange(rowIndex, COL_STATUS).setValue("connection_error");
    logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
    SpreadsheetApp.flush();

    if (origMessageId) {
      editTelegramMessageText(Number(origMessageId), `❌ Webhook connection error while posting <b>${escapeHTML(message.from.first_name)}</b>'s custom reply. The system will retry automatically.`, sourceChatId);
    } else {
      sendSimpleTelegramMessage(`❌ Failed to send <b>${escapeHTML(message.from.first_name)}</b>'s custom reply due to a webhook connection error. The system will retry automatically.`, sourceChatId);
    }
    sendLogToIT(`Make webhook connection error (custom reply) for review ID ${reviewId} (customer ${rowValues[1]}). Queued for auto-retry.`, "ERROR");
  }
}

/**
 * Helper to find a sheet row index by its short reference code (Short ID - column 13)
 */
function findRowIndexByShortId(sheet, shortId) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return -1;
  
  // Scan from row 1 to the last row in column 13 (M)
  const ids = sheet.getRange(1, COL_SHORT_ID, lastRow, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] && ids[i][0].toString().trim() === shortId.trim()) {
      return i + 1; // Return the sheet row number
    }
  }
  return -1;
}

/**
 * Format the content shown in an Option cell (reply text plus an English translation for reference)
 */
function formatOptionText(option) {
  if (!option) return "";
  const reply = option.replyText || "";
  const eng = option.englishTranslation || "";
  
  if (eng && eng !== "Same as customer-facing reply (English)." && eng !== "API Error") {
    return `${reply}\n\n--- [ENG TRANSLATION] ---\n${eng}`;
  }
  return reply;
}

/**
 * Extract only the original (native-language) reply, dropping the English translation before posting to Google Maps.
 */
function extractCleanReply(cellText) {
  if (!cellText) return "";
  const parts = cellText.split("\n\n--- [ENG TRANSLATION] ---");
  return parts[0].trim();
}

/**
 * Auto-create and format the "Dashboard & Config" sheet with the standard structure.
 */
function autoCreateConfigSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  let configSheet = ss.getSheetByName(SHEET_CONFIG_NAME);
  
  if (configSheet) {
    const response = ui.alert("Confirm Setup", `Sheet "${SHEET_CONFIG_NAME}" already exists. Reformat it? (Existing data in columns B/C is preserved)`, ui.ButtonSet.YES_NO);
    if (response !== ui.Button.YES) return;
  } else {
    configSheet = ss.insertSheet(SHEET_CONFIG_NAME);
  }

  configSheet.clearFormats();
  const structure = [
    ["🔑 AI CONFIG (Priority: Gemini > Claude > ChatGPT)", "API Key", "Model Name", "Status"],  
    ["1. Gemini API Key", configSheet.getRange("B2").getValue() || "", configSheet.getRange("C2").getValue() || "gemini-3.5-flash", configSheet.getRange("D2").getValue() || "ON"], 
    ["2. Claude API Key", configSheet.getRange("B3").getValue() || "", configSheet.getRange("C3").getValue() || "claude-3-5-sonnet-20241022", configSheet.getRange("D3").getValue() || "OFF"], 
    ["3. ChatGPT API Key", configSheet.getRange("B4").getValue() || "", configSheet.getRange("C4").getValue() || "gpt-4o-mini", configSheet.getRange("D4").getValue() || "OFF"], 
    ["", "", "", ""],                                             
    ["📍 LOCATION 1: MAIN STORE", "", "", ""],                
    ["Location 1 Name", configSheet.getRange("B7").getValue() || "La Lapine - Bakery & Coffee", "", ""], 
    ["Account ID 1", configSheet.getRange("B8").getValue() || "", "", ""],   
    ["Location ID 1", configSheet.getRange("B9").getValue() || "", "", ""],  
    ["", "", "", ""],                                             
    ["📍 LOCATION 2: BRANCH (IF ANY)", "", "", ""],            
    ["Location 2 Name", configSheet.getRange("B12").getValue() || "", "", ""], 
    ["Account ID 2", configSheet.getRange("B13").getValue() || "", "", ""],   
    ["Location ID 2", configSheet.getRange("B14").getValue() || "", "", ""],  
    ["", "", "", ""],                                             
    ["💬 CẤU HÌNH TÍCH HỢP", "", "", ""],                     
    ["Telegram Bot Token", configSheet.getRange("B17").getValue() || "", "", ""], 
    ["Telegram Chat ID (Approval Group)", configSheet.getRange("B18").getValue() || "", "", ""],
    ["Approver (staff code to tag)", configSheet.getRange("B19").getValue() || "", "", ""],
    ["Telegram Chat ID (Group IT Log)", configSheet.getRange("B20").getValue() || "", "", ""],
    ["Make.com Webhook URL", configSheet.getRange("B21").getValue() || "", "", ""],
    ["HR Web App URL", configSheet.getRange("B22").getValue() || "", "", ""]
  ];

  configSheet.getRange(1, 1, structure.length, 4).setValues(structure);
  configSheet.getRange(1, 1, structure.length, 4).setFontFamily("Outfit").setFontSize(10);
  
  const headerRows = [1, 6, 11, 16];
  headerRows.forEach(row => {
    configSheet.getRange(row, 1, 1, 4).merge().setFontWeight("bold").setFontSize(11).setBackground("#efebe9").setFontColor("#5d4037").setHorizontalAlignment("left");
  });

  const labelRows = [2, 3, 4, 7, 8, 9, 12, 13, 14, 17, 18, 19, 20, 21, 22];
  labelRows.forEach(row => {
    configSheet.getRange(row, 1).setFontWeight("bold").setFontColor("#424242");
    configSheet.getRange(row, 2, 1, 3).setBackground("#fafafa"); 
  });

  configSheet.autoResizeColumn(1);
  configSheet.setColumnWidth(2, 450); 
  configSheet.setColumnWidth(3, 200);
  configSheet.setColumnWidth(4, 150); // Column D (ON/OFF)
  
  // Format data validation for column D
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(["ON", "OFF"], true).build();
  configSheet.getRange("D2:D4").setDataValidation(rule);
  configSheet.getRange("D2:D4").setHorizontalAlignment("center").setFontWeight("bold");

  configSheet.getRange(1, 1, structure.length, 4).setBorder(true, true, true, true, null, null, "#e0e0e0", SpreadsheetApp.BorderStyle.SOLID);
  
  // Set headers for columns F and G (staff list)
  configSheet.getRange("F1").setValue("👤 ENGLISH NAME (Nickname)").setFontWeight("bold").setBackground("#efebe9").setFontColor("#5d4037");
  configSheet.getRange("G1").setValue("👤 FULL NAME (Official)").setFontWeight("bold").setBackground("#efebe9").setFontColor("#5d4037");
  configSheet.setColumnWidth(6, 250);
  configSheet.setColumnWidth(7, 250);

  ui.alert("Success", `Config sheet layout set up successfully!`, ui.ButtonSet.OK);
}

/**
 * Convert Google API's star-rating enum to a normal number.
 */
function translateStarRating(starEnum) {
  switch (starEnum) {
    case "FIVE": return 5;
    case "FOUR": return 4;
    case "THREE": return 3;
    case "TWO": return 2;
    case "ONE": return 1;
    default: return typeof starEnum === "number" ? starEnum : 5;
  }
}

/**
 * Get config for the Web App
 */
function getSettingsAPI() {
  try {
    const config = getSystemConfig();
    return { success: true, settings: config };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

/**
 * Save config from the Web App
 */
function saveSettingsAPI(newSettings) {
  try {
    const ss = getSafeSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_CONFIG_NAME);
    if (!sheet) throw new Error("Sheet not found " + SHEET_CONFIG_NAME);

    if (newSettings.geminiApiKey !== undefined) sheet.getRange("B2").setValue(newSettings.geminiApiKey);
    if (newSettings.geminiModel !== undefined) sheet.getRange("C2").setValue(newSettings.geminiModel);
    if (newSettings.geminiStatus !== undefined) sheet.getRange("D2").setValue(newSettings.geminiStatus);
    
    if (newSettings.claudeApiKey !== undefined) sheet.getRange("B3").setValue(newSettings.claudeApiKey);
    if (newSettings.claudeModel !== undefined) sheet.getRange("C3").setValue(newSettings.claudeModel);
    if (newSettings.claudeStatus !== undefined) sheet.getRange("D3").setValue(newSettings.claudeStatus);

    if (newSettings.chatgptApiKey !== undefined) sheet.getRange("B4").setValue(newSettings.chatgptApiKey);
    if (newSettings.chatgptModel !== undefined) sheet.getRange("C4").setValue(newSettings.chatgptModel);
    if (newSettings.chatgptStatus !== undefined) sheet.getRange("D4").setValue(newSettings.chatgptStatus);

    if (newSettings.location1) {
      if (newSettings.location1.name !== undefined) sheet.getRange("B7").setValue(newSettings.location1.name);
      if (newSettings.location1.accountId !== undefined) sheet.getRange("B8").setValue(newSettings.location1.accountId);
      if (newSettings.location1.locationId !== undefined) sheet.getRange("B9").setValue(newSettings.location1.locationId);
    }
    
    if (newSettings.location2) {
      if (newSettings.location2.name !== undefined) sheet.getRange("B12").setValue(newSettings.location2.name);
      if (newSettings.location2.accountId !== undefined) sheet.getRange("B13").setValue(newSettings.location2.accountId);
      if (newSettings.location2.locationId !== undefined) sheet.getRange("B14").setValue(newSettings.location2.locationId);
    }

    if (newSettings.telegramToken !== undefined) sheet.getRange("B17").setValue(newSettings.telegramToken);
    if (newSettings.telegramChatId !== undefined) sheet.getRange("B18").setValue(newSettings.telegramChatId);
    if (newSettings.telegramReviewerTag !== undefined) sheet.getRange("B19").setValue(newSettings.telegramReviewerTag);
    if (newSettings.telegramITChatId !== undefined) sheet.getRange("B20").setValue(newSettings.telegramITChatId);
    if (newSettings.makeWebhookUrl !== undefined) sheet.getRange("B21").setValue(newSettings.makeWebhookUrl);
    if (newSettings.hrApiUrl !== undefined) sheet.getRange("B22").setValue(newSettings.hrApiUrl);

    // Update the staff list
    if (newSettings.staffList && Array.isArray(newSettings.staffList)) {
      sheet.getRange("E2:H50").clearContent();
      const staffValues = newSettings.staffList.map(s => [s.id || "", s.en || "", s.vn || "", s.telegram || ""]);
      if (staffValues.length > 0) {
        sheet.getRange(2, 5, staffValues.length, 4).setValues(staffValues);
      }
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

function buildTelegramReviewerMention(config) {
  if (!config) return "";

  const reviewerTag = (config.telegramReviewerTag || "").toString().trim();
  if (!reviewerTag) return "";

  if (reviewerTag.startsWith("LL")) {
    const foundStaff = (config.staffList || []).find(s => s.id === reviewerTag);
    if (foundStaff && foundStaff.telegram) {
      return `<a href="tg://user?id=${foundStaff.telegram}">${escapeHTML(foundStaff.vn || foundStaff.en || foundStaff.id)}</a>`;
    }
    return escapeHTML(reviewerTag);
  }

  return reviewerTag.includes("<a href=") ? reviewerTag : escapeHTML(reviewerTag);
}

function sendLogToIT(message, level = "INFO", context = {}) {
  try {
    const configResult = getSettingsAPI();
    if (!configResult.success) return;
    
    const config = configResult.settings;
    const token = config.telegramToken;
    const itChatId = config.telegramITChatId;
    if (!token || !itChatId) return;

    const severity = (level || "INFO").toString().toUpperCase();
    const severityMeta = {
      ERROR: { emoji: "🚨", label: "ERROR" },
      WARNING: { emoji: "⚠️", label: "WARNING" },
      SUCCESS: { emoji: "✅", label: "SUCCESS" },
      INFO: { emoji: "ℹ️", label: "INFO" }
    }[severity] || { emoji: "ℹ️", label: severity };

    const mentionPanda = severity === "ERROR" || severity === "WARNING";
    const pandaMention = mentionPanda ? buildTelegramReviewerMention(config) : "";
    const contextEntries = Object.keys(context || {})
      .filter(key => context[key] !== undefined && context[key] !== null && context[key] !== "")
      .map(key => `- <b>${escapeHTML(key)}:</b> ${escapeHTML(String(context[key]))}`);

    let text = `${severityMeta.emoji} <b>SYSTEM LOG ${severityMeta.label}</b>`;
    if (pandaMention) {
      text += `\n👋 ${pandaMention}`;
    }
    text += `\n\n${message}`;
    if (contextEntries.length > 0) {
      text += `\n\n<b>Debug context:</b>\n${contextEntries.join("\n")}`;
    }

    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    const payload = {
      chat_id: itChatId,
      text: text,
      parse_mode: "HTML"
    };
    UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch(e) {
    Logger.log("Failed to send log to IT: " + e.message);
  }
}

function setupWebhook(providedUrl, providedToken) {
  const config = getSettingsAPI();
  // Use the token passed from the Web App; otherwise read it from the Google Sheet config
  const token = providedToken || (config.success ? config.settings.telegramToken : null);
  if (!token) throw new Error("Telegram Token is not configured");
  
  let secretToken = PropertiesService.getScriptProperties().getProperty("TELEGRAM_SECRET");
  if (!secretToken) {
    secretToken = Utilities.getUuid();
    PropertiesService.getScriptProperties().setProperty("TELEGRAM_SECRET", secretToken);
  }

  // Use the URL passed from the Web App front-end; fall back to getUrl() (which can be wrong with multiple deployments)
  const scriptUrl = providedUrl || ScriptApp.getService().getUrl();
  if (!scriptUrl || !scriptUrl.endsWith("/exec")) {
     throw new Error("Invalid Web App URL. Make sure you entered the correct URL ending in /exec");
  }

  const webhookUrl = scriptUrl + "?token=" + secretToken;
  
  const url = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(webhookUrl)}`;
  const response = UrlFetchApp.fetch(url);
  const result = JSON.parse(response.getContentText());
  
  if (result.ok) {
     sendLogToIT(`✅ Webhook set up successfully!\nURL: ${scriptUrl}`);
  }
  return result;
}

function sendTwoWayTestMessage(providedToken, providedChatId) {
  const configResult = getSettingsAPI();
  const token = providedToken || (configResult.success ? configResult.settings.telegramToken : null);
  const itChatId = providedChatId || (configResult.success ? configResult.settings.telegramITChatId : null);
  
  if (!token) throw new Error("Telegram Token is not configured");
  if (!itChatId) throw new Error("Telegram IT Chat ID is not configured");

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const payload = {
    chat_id: itChatId,
    text: "🧪 <b>TWO-WAY COMMUNICATION TEST</b>\n\nTap the button below. If the bot replies, the webhook is fully working!",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[
        { text: "🚀 Tap here to test!", callback_data: "test_webhook" }
      ]]
    }
  };
  
  const response = UrlFetchApp.fetch(url, {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  });
  
  return JSON.parse(response.getContentText());
}

function getWebhookStatus(providedToken) {
  const config = getSettingsAPI();
  const token = providedToken || (config.success ? config.settings.telegramToken : null);
  if (!token) throw new Error("Telegram Token is not configured. Make sure you entered the token and clicked 'Save Review Bot Config'.");
  
  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  const response = UrlFetchApp.fetch(url);
  return JSON.parse(response.getContentText());
}

/**
 * Execute commands from the Web App (replaces the Google Sheet menu UI)
 */
function validateActionPayload(actionName, postData) {
  const payload = postData || {};

  if (!actionName) {
    throw new Error("Missing actionName when calling executeActionAPI.");
  }

  if (actionName === "runSetupWebhook") {
    if (!payload.scriptUrl || !String(payload.scriptUrl).trim()) {
      throw new Error("Missing scriptUrl when running runSetupWebhook.");
    }
  }

  return payload;
}

function executeActionAPI(actionName, postData = {}) {
  try {
    const payload = validateActionPayload(actionName, postData);

    switch (actionName) {
      case 'processAIQueue':
        processAIQueue();
        return { success: true, message: "AI auto-processing activated successfully." };
      case 'runSetupWebhook': {
        const result = setupWebhook(payload.scriptUrl, payload.telegramToken);
        return { success: true, message: "Telegram webhook set up successfully.", details: result };
      }
      case 'checkWebhookStatus': {
        const webhookInfo = getWebhookStatus(payload.telegramToken);
        const statusMsg = webhookInfo.ok ? (webhookInfo.result.url ? `Active!\nURL: ${webhookInfo.result.url}` : "Not set up (empty URL)") : "Config error";
        return { success: true, message: "Webhook status: " + statusMsg, details: webhookInfo };
      }
      case 'testTwoWayWebhook':
        sendTwoWayTestMessage(payload.telegramToken, payload.telegramITChatId);
        return { success: true, message: "Sent the two-way test message to the IT group. Open Telegram and try tapping the button!" };
      case 'autoCreateConfigSheet':
        autoCreateConfigSheet();
        return { success: true, message: "Created/checked the sheet config." };
      case 'setupAutoRunTrigger': {
        const triggersAuto = ScriptApp.getProjectTriggers();
        for (let i = 0; i < triggersAuto.length; i++) {
          if (triggersAuto[i].getHandlerFunction() === "processAIQueue") {
            ScriptApp.deleteTrigger(triggersAuto[i]);
          }
        }
        ScriptApp.newTrigger("processAIQueue").timeBased().everyMinutes(5).create();
        return { success: true, message: "Enabled AI auto-run every 5 minutes." };
      }
      case 'setupWeeklyReportTrigger': {
        createWeeklyReportTrigger();
        return { success: true, message: "Enabled the weekly auto-report at 9am Monday (Asia/Ho_Chi_Minh)." };
      }
      case 'setupMonthlyTrigger': {
        const triggersMonth = ScriptApp.getProjectTriggers();
        for (let i = 0; i < triggersMonth.length; i++) {
          if (triggersMonth[i].getHandlerFunction() === "generateMonthlyReport_Silent" || triggersMonth[i].getHandlerFunction() === "generateMonthlyReport") {
            ScriptApp.deleteTrigger(triggersMonth[i]);
          }
        }
        ScriptApp.newTrigger("generateMonthlyReport_Silent").timeBased().onMonthDay(1).atHour(8).create();
        return { success: true, message: "Enabled the monthly auto-report (1st of month morning)." };
      }
      case 'generateWeeklyReport':
        generateWeeklyReport(true);
        return { success: true, message: "Started building and sending the weekly report." };
      case 'runGeminiTest': {
        const status = testGeminiConnection();
        return { success: true, message: "AI test result: " + status };
      }
      case 'confirmPublish': {
        return confirmPublishAPI(payload);
      }
      default:
        return { success: false, error: "Action not supported via API: " + actionName };
    }
  } catch (e) {
    Logger.log("Error executeActionAPI: " + e.message);
    sendLogToIT(`Error executeActionAPI (${actionName}): ${e.message}`, "ERROR", {
      actionName: actionName,
      functionName: postData && postData.functionName ? postData.functionName : "",
      scriptUrl: postData && postData.scriptUrl ? postData.scriptUrl : ""
    });
    return { success: false, error: e.message };
  }
}

/**
 * Confirm the publish status of a review reply, sent back from Make.com.
 * 
 * @param {Object} payload Data received from the Make.com callback
 * @return {Object} The result as JSON
 */
function confirmPublishAPI(payload) {
  const reviewId = payload.reviewId;
  const success = payload.success === true || payload.success === "true";
  const errorMessage = payload.errorMessage || "";
  const managerName = payload.managerName || "Manager";
  let messageId = payload.messageId;

  if (!reviewId) {
    return { success: false, error: "Missing reviewId when confirming publish." };
  }

  const ss = getSafeSpreadsheet();
  const logSheet = ss.getSheetByName("Reviews");
  if (!logSheet) {
    return { success: false, error: "Reviews sheet not found." };
  }

  const lastRow = logSheet.getLastRow();
  if (lastRow < 1) {
    return { success: false, error: "The sheet has no data." };
  }

  // Find the row matching this reviewId
  let rowIndex = -1;
  const ids = logSheet.getRange(1, COL_REVIEW_ID, lastRow, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] && ids[i][0].toString().trim() === reviewId.toString().trim()) {
      rowIndex = i + 1;
      break;
    }
  }

  if (rowIndex === -1) {
    return { success: false, error: "No review found for reviewId: " + reviewId };
  }

  const rowValues = logSheet.getRange(rowIndex, 1, 1, COL_TELEGRAM_MSG_ID).getValues()[0];
  const reviewerName = rowValues[COL_CUSTOMER - 1];
  const rating = rowValues[COL_RATING - 1];
  const locationName = rowValues[COL_LOCATION - 1];
  const comment = rowValues[COL_CONTENT - 1];
  const selectionVal = rowValues[COL_SELECTION - 1] || "";
  
  if (!messageId) {
    messageId = rowValues[COL_TELEGRAM_MSG_ID - 1];
  }

  if (success) {
    // Set status to "replied"
    logSheet.getRange(rowIndex, COL_STATUS).setValue("replied");
    logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
    logSheet.getRange(rowIndex, COL_RETRY_COUNT).setValue(0);
    logSheet.getRange(rowIndex, COL_ERROR_MESSAGE).setValue("");
    SpreadsheetApp.flush();

    // Collapse the Telegram message if a messageId exists
    if (messageId) {
      try {
        const review = {
          locationName: locationName,
          reviewerName: reviewerName,
          rating: translateStarRating(rating),
          comment: comment
        };
        const config = getSystemConfig();
        const targetChatId = config.telegramChatId;
        collapseTelegramMessage(Number(messageId), review, selectionVal, managerName, targetChatId);
      } catch (e) {
        Logger.log("Error collapsing the Telegram message: " + e.toString());
      }
    }
    
    sendLogToIT(`Successfully posted ${reviewerName}'s reply to Google Maps.`, "SUCCESS");
    return { success: true, message: `Confirmed successful publish for review ID: ${reviewId}` };
  } else {
    // Set status to "publish_failed"
    logSheet.getRange(rowIndex, COL_STATUS).setValue("publish_failed");
    logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
    logSheet.getRange(rowIndex, COL_ERROR_MESSAGE).setValue(errorMessage);
    SpreadsheetApp.flush();

    // Notify the IT group of the GBP error
    sendLogToIT(`Error publishing to Google Business Profile for ${reviewerName}'s review.\nDetails: ${errorMessage}`, "ERROR");
    
    // If a messageId exists, update the Telegram message to report the error
    if (messageId) {
      try {
        const config = getSystemConfig();
        const targetChatId = config.telegramChatId;
        editTelegramMessageText(Number(messageId), `❌ Error publishing to Google Maps for <b>${escapeHTML(reviewerName)}</b>'s review.\nDetails: <code>${escapeHTML(errorMessage)}</code>\n\nAuto-retry will kick in, or you can retry manually.`, targetChatId);
      } catch(e) {}
    }
    
    return { success: true, message: `Confirmed failed publish for review ID: ${reviewId}. Error: ${errorMessage}` };
  }
}

/**
 * Find reviews stuck in "publishing" for over 15 minutes and reset them to an error status, ready to retry.
 */
function checkAndResetStuckPublishing() {
  const ss = getSafeSpreadsheet();
  const logSheet = ss.getSheetByName("Reviews");
  if (!logSheet) return;

  const lastRow = logSheet.getLastRow();
  if (lastRow <= 1) return;

  const data = logSheet.getDataRange().getValues();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = String(row[COL_STATUS - 1] || "").trim();
    if (status === "publishing") {
      const updatedAt = row[COL_UPDATED_AT - 1];
      let isStuck = false;
      if (updatedAt) {
        try {
          const diffMins = (now - new Date(updatedAt)) / (1000 * 60);
          if (diffMins >= 15) {
            isStuck = true;
          }
        } catch(e) {}
      } else {
        isStuck = true; // No update timestamp -> treat as stuck
      }

      if (isStuck) {
        const rowIndex = i + 1;
        const reviewerName = row[COL_CUSTOMER - 1];
        
        logSheet.getRange(rowIndex, COL_STATUS).setValue("publish_failed");
        logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(now);
        logSheet.getRange(rowIndex, COL_ERROR_MESSAGE).setValue("Error: publish timed out (15-minute timeout).");
        SpreadsheetApp.flush();
        
        sendLogToIT(`Detected ${reviewerName}'s review stuck in "publishing" for over 15 minutes. Reset to publish_failed to queue a retry.`, "WARNING");
      }
    }
  }
}

/**
 * Auto-scan and resend the webhook for replies with connection or publish errors (up to 3 retries).
 */
function retryPublishQueue() {
  const ss = getSafeSpreadsheet();
  const logSheet = ss.getSheetByName("Reviews");
  if (!logSheet) return;

  const lastRow = logSheet.getLastRow();
  if (lastRow <= 1) return;

  const data = logSheet.getDataRange().getValues();
  const config = getSystemConfig();
  const now = new Date();

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const reviewId = row[COL_REVIEW_ID - 1];
    const reviewerName = row[COL_CUSTOMER - 1];
    const locationName = row[COL_LOCATION - 1];
    const status = String(row[COL_STATUS - 1] || "").trim();
    const replyText = row[COL_SELECTION - 1] || "";
    
    if ((status === "connection_error" || status === "publish_failed") && replyText) {
      const retryCount = Number(row[COL_RETRY_COUNT - 1] || 0);
      const rowIndex = i + 1;

      if (retryCount < 3) {
        const nextRetry = retryCount + 1;
        
        // Update status before sending to avoid duplicate parallel calls
        logSheet.getRange(rowIndex, COL_STATUS).setValue("publishing");
        logSheet.getRange(rowIndex, COL_RETRY_COUNT).setValue(nextRetry);
        logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(now);
        SpreadsheetApp.flush();
        
        sendLogToIT(`Auto-retrying attempt ${nextRetry}/3 for ${reviewerName}'s review...`, "INFO");

        let isSuccess = false;
        try {
          const scriptUrl = ScriptApp.getService().getUrl();
          UrlFetchApp.fetch(config.makeWebhookUrl, {
            method: "post",
            contentType: "application/json",
            payload: JSON.stringify({ 
              reviewId: reviewId, 
              replyText: replyText, 
              locationName: locationName,
              scriptUrl: scriptUrl
            })
          });
          isSuccess = true;
        } catch(e) {
          Logger.log("Error auto-resending the webhook: " + e.toString());
          isSuccess = false;
        }

        if (isSuccess) {
          sendLogToIT(`Auto-resent the webhook successfully for ${reviewerName}. Waiting for Make.com to confirm.`, "SUCCESS");
        } else {
          // Set back to connection_error and record the time
          logSheet.getRange(rowIndex, COL_STATUS).setValue("connection_error");
          logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date());
          SpreadsheetApp.flush();
          sendLogToIT(`Auto-retry ${nextRetry}/3 failed due to a webhook connection error (customer: ${reviewerName}).`, "ERROR");
        }
      } else {
        // More than 3 failed retries
        logSheet.getRange(rowIndex, COL_ERROR_MESSAGE).setValue("Auto-retried 3 times and failed. Please handle manually.");
        logSheet.getRange(rowIndex, COL_STATUS).setValue("failed_permanently");
        SpreadsheetApp.flush();
        
        sendLogToIT(`🚨 ALERT: the reply for ${reviewerName} failed all 3 auto-retries. Please check manually in Google Sheets!`, "ERROR");
      }
    }
  }
}

function getTriggerRegistryAPI() {
  try {
    const registry = loadTriggerRegistryFromSheet();
    return { success: true, triggers: registry };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function updateTriggerStatusAPI(data) {
  try {
    const { functionName, status } = data;
    if (!functionName || !status) {
      return { success: false, error: 'Missing trigger info or status' };
    }
    saveTriggerStatusToSheet(functionName, status);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.toString() };
  }
}

function loadTriggerRegistryFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeSpreadsheet();
  let sheet = ss.getSheetByName('TriggerRegistry');
  
  const defaultTriggers = [
    { system: 'Review', functionName: 'processAIQueue', description: 'Auto-scan & process reviews (every 5 min)', status: 'ENABLED' },
    { system: 'Review', functionName: 'generateWeeklyReport_Silent', description: 'Weekly auto-report (Monday morning)', status: 'ENABLED' },
    { system: 'Review', functionName: 'generateMonthlyReport_Silent', description: 'Monthly auto-report (1st of month)', status: 'ENABLED' }
  ];
  
  if (!sheet) {
    sheet = ss.insertSheet('TriggerRegistry');
    sheet.appendRow(['System', 'Function Name', 'Description', 'Status', 'Last Run']);
    
    sheet.getRange('A1:E1').setFontWeight('bold').setBackground('#f3f4f6').setHorizontalAlignment('center');
    
    defaultTriggers.forEach(t => {
      sheet.appendRow([t.system, t.functionName, t.description, t.status, '']);
    });
    
    const rule = SpreadsheetApp.newDataValidation().requireValueInList(['ENABLED', 'DISABLED'], true).build();
    sheet.getRange('D2:D100').setDataValidation(rule);
    sheet.autoResizeColumns(1, 5);
  }
  
  const records = sheet.getDataRange().getDisplayValues();
  const list = [];
  for (let i = 1; i < records.length; i++) {
    const system = String(records[i][0]).trim();
    const functionName = String(records[i][1]).trim();
    const description = String(records[i][2]).trim();
    const status = String(records[i][3]).trim().toUpperCase();
    const lastRun = String(records[i][4]).trim();
    
    if (functionName) {
      list.push({ system, functionName, description, status, lastRun });
    }
  }
  return list;
}

function saveTriggerStatusToSheet(functionName, status) {
  const ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeSpreadsheet();
  let sheet = ss.getSheetByName('TriggerRegistry');
  if (!sheet) {
    loadTriggerRegistryFromSheet();
    sheet = ss.getSheetByName('TriggerRegistry');
  }
  
  const records = sheet.getDataRange().getDisplayValues();
  for (let i = 1; i < records.length; i++) {
    if (String(records[i][1]).trim() === String(functionName).trim()) {
      sheet.getRange(i + 1, 4).setValue(String(status).trim().toUpperCase());
      return;
    }
  }
  sheet.appendRow(['Review', functionName, 'Trigger added automatically', status, '']);
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(['ENABLED', 'DISABLED'], true).build();
  sheet.getRange('D2:D100').setDataValidation(rule);
}

function isTriggerEnabled(functionName) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet() || getSafeSpreadsheet();
    let sheet = ss.getSheetByName('TriggerRegistry');
    if (!sheet) {
      loadTriggerRegistryFromSheet();
      sheet = ss.getSheetByName('TriggerRegistry');
    }

    const records = sheet.getDataRange().getDisplayValues();
    for (let i = 1; i < records.length; i++) {
      if (String(records[i][1]).trim() === String(functionName).trim()) {
        const isEnabled = String(records[i][3]).trim().toUpperCase() === 'ENABLED';
        if (isEnabled) {
          sheet.getRange(i + 1, 5).setValue(Utilities.formatDate(new Date(), "Asia/Ho_Chi_Minh", "dd/MM/yyyy HH:mm:ss"));
        }
        return isEnabled;
      }
    }
  } catch (e) {
    Logger.log('Error check isTriggerEnabled cho ' + functionName + ': ' + e.toString());
  }
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// GOOGLE REVIEWS WEBAPP API — Phase 1
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse column S (photoThumbnails) — handles both comma-separated and JSON array.
 * @param {string} raw Raw value from the sheet cell
 * @return {string[]} Array of image URLs
 */
function parsePhotoUrls(raw) {
  if (!raw) return [];
  const str = raw.toString().trim();
  if (!str) return [];
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [str];
  } catch (e) {
    return str.split(',').map(function(u) { return u.trim(); }).filter(Boolean);
  }
}

/**
 * getReviewsAPI — read the "Reviews" sheet and return a filtered list of reviews.
 * Params: { dateFrom, dateTo, location, status }
 * - dateFrom / dateTo: ISO string or blank
 * - location: branch name or "all"
 * - status: "replied" | "pending" | "all"
 */
function getReviewsAPI(params) {
  try {
    const ss = getSafeSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_LOG_NAME);
    if (!sheet) return { success: false, error: 'Sheet not found ' + SHEET_LOG_NAME };

    const data = sheet.getDataRange().getValues();
    const dateFrom = params.dateFrom ? new Date(params.dateFrom) : null;
    const dateTo   = params.dateTo   ? new Date(params.dateTo)   : null;
    const location = (params.location || 'all').toString().trim();
    const status   = (params.status   || 'all').toString().trim();

    const results = [];

    // The Reviews sheet has no header row — start at i = 0
    for (let i = 0; i < data.length; i++) {
      const row = data[i];

      // Skip rows without a reviewId (in case of blank rows)
      if (!row[COL_REVIEW_ID - 1]) continue;

      const reviewDate = parseReviewDate(row[COL_DATE - 1]);
      if (!reviewDate) continue; // skip rows without a valid date

      // Date filter
      if (dateFrom && reviewDate < dateFrom) continue;
      if (dateTo) {
        // Compare through the end of the dateTo day
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        if (reviewDate > endOfDay) continue;
      }

      // Branch filter
      const rowLocation = (row[COL_LOCATION - 1] || '').toString().trim();
      if (location !== 'all' && rowLocation !== location) continue;

      // Reply-status filter
      const rowStatus = (row[COL_STATUS - 1] || '').toString().trim();
      if (status === 'replied' && rowStatus !== 'replied') continue;
      if (status === 'pending' && rowStatus === 'replied') continue;

      // Parse thumbnails (column S) — handle comma-separated or JSON array
      const photoThumbnails = parsePhotoUrls(row[COL_PHOTO_THUMBNAILS - 1]);

      results.push({
        reviewId:        row[COL_REVIEW_ID - 1],
        customer:        row[COL_CUSTOMER - 1],
        rating:          row[COL_RATING - 1],
        content:         row[COL_CONTENT - 1],
        date:            row[COL_DATE - 1],
        status:          rowStatus,
        location:        rowLocation,
        shortId:         row[COL_SHORT_ID - 1],
        aiStaff:         row[COL_STAFF - 1],           // Column O: AI text detection
        photoThumbnails: photoThumbnails,               // Column S: parsed into an array
        staffClaims:      row[COL_STAFF_CLAIMS - 1],     // Column U: pending claims
        staffTags:        row[COL_STAFF_TAGS - 1],       // Column V: manager confirmed
        googleMapsUri:    row[COL_GOOGLE_MAPS_URI - 1] || '', // Column W: direct review link
        rejectedClaims:   row[COL_REJECTED_CLAIMS - 1] || '', // Column X: rejected history
      });
    }

    return { success: true, reviews: results };
  } catch (e) {
    Logger.log('Error getReviewsAPI: ' + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * getReviewStatsAPI — count reviews for one staff member over a date range (used for payroll).
 * action: 'getReviewStats'
 * Params: { staffId, fromDate, toDate }  // YYYY-MM-DD, filtered by col E
 * Read the "Reviews" sheet, scan col V (COL_STAFF_TAGS):
 *   - personalCount: rows where col V contains staffId (split on comma + includes)
 *   - totalConfirmedCount: rows with non-empty col V in range (used for shared bonus split)
 * 2 staff approving 1 review → each gets +1 personal, the review counts 1 toward the total
 * Returns: { success: true, personalCount: N, totalConfirmedCount: M, reviewIds: [...] }
 */
function getReviewStatsAPI(params) {
  try {
    const { staffId, fromDate, toDate } = params;
    if (!staffId) return { success: false, error: 'Missing staffId.' };

    const ss = getSafeSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_LOG_NAME);
    if (!sheet) return { success: false, error: 'Sheet not found ' + SHEET_LOG_NAME };

    const data = sheet.getDataRange().getValues();
    const dateFrom = fromDate ? new Date(fromDate) : null;
    const dateTo   = toDate   ? new Date(toDate)   : null;

    let personalCount = 0;
    let totalConfirmedCount = 0;
    const reviewIds = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row[COL_REVIEW_ID - 1]) continue;

      const reviewDate = parseReviewDate(row[COL_DATE - 1]);
      if (!reviewDate) continue;

      // Date filter
      if (dateFrom && reviewDate < dateFrom) continue;
      if (dateTo) {
        const endOfDay = new Date(dateTo);
        endOfDay.setHours(23, 59, 59, 999);
        if (reviewDate > endOfDay) continue;
      }

      // Read col V (staffTags) — manager-confirmed, ground truth for payroll
      const staffTagsRaw = (row[COL_STAFF_TAGS - 1] || '').toString().trim();
      if (!staffTagsRaw) continue; // not confirmed → skip

      // Total reviews with at least 1 staffTag in the range
      totalConfirmedCount++;

      // Personal: staffId is in the tag list
      const tags = staffTagsRaw.split(',').map(function(s) { return s.trim(); }).filter(Boolean);
      if (tags.indexOf(String(staffId).trim()) !== -1) {
        personalCount++;
        reviewIds.push(String(row[COL_REVIEW_ID - 1]));
      }
    }

    return { success: true, personalCount: personalCount, totalConfirmedCount: totalConfirmedCount, reviewIds: reviewIds };
  } catch (e) {
    Logger.log('Error getReviewStatsAPI: ' + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * claimReviewAPI — staff claims a review, appends staffId to column U (COL_STAFF_CLAIMS).
 * Params: { reviewId, staffId }
 * No duplicate claims; never overwrite someone else's claim.
 */
function claimReviewAPI(params) {
  try {
    const { reviewId, staffId } = params;
    if (!reviewId || !staffId) return { success: false, error: 'Missing reviewId or staffId.' };

    const ss = getSafeSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_LOG_NAME);
    if (!sheet) return { success: false, error: 'Sheet not found ' + SHEET_LOG_NAME };

    const data = sheet.getDataRange().getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][COL_REVIEW_ID - 1]).trim() === String(reviewId).trim()) {
        const rowIndex = i + 1; // 1-indexed cho Apps Script
        const existing = (data[i][COL_STAFF_CLAIMS - 1] || '').toString().trim();
        const claims = existing ? existing.split(',').map(function(s) { return s.trim(); }).filter(Boolean) : [];

        if (claims.indexOf(String(staffId).trim()) !== -1) {
          return { success: true, alreadyClaimed: true, message: 'You already claimed this review.' };
        }

        claims.push(String(staffId).trim());
        sheet.getRange(rowIndex, COL_STAFF_CLAIMS).setValue(claims.join(','));
        sheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date().toISOString());
        SpreadsheetApp.flush();
        return { success: true };
      }
    }

    return { success: false, error: 'No review found with ID: ' + reviewId };
  } catch (e) {
    Logger.log('Error claimReviewAPI: ' + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * approveClaimAPI — manager approves, copies the chosen staffIds into column V (COL_STAFF_TAGS) and clears column U.
 * Params: { reviewId, staffIds }  (staffIds: array of IDs the manager approved)
 */
function approveClaimAPI(params) {
  try {
    const { reviewId, staffIds, remainingClaims } = params;
    if (!reviewId) return { success: false, error: 'Missing reviewId.' };

    const approvedIds = Array.isArray(staffIds) ? staffIds.map(String).filter(Boolean) : [];
    // remainingClaims: claims left after approval — if not provided, clear all of col U
    const pendingIds = Array.isArray(remainingClaims) ? remainingClaims.map(String).filter(Boolean) : [];

    const ss = getSafeSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_LOG_NAME);
    if (!sheet) return { success: false, error: 'Sheet not found ' + SHEET_LOG_NAME };

    const data = sheet.getDataRange().getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][COL_REVIEW_ID - 1]).trim() === String(reviewId).trim()) {
        const rowIndex = i + 1;
        sheet.getRange(rowIndex, COL_STAFF_TAGS).setValue(approvedIds.join(','));
        sheet.getRange(rowIndex, COL_STAFF_CLAIMS).setValue(pendingIds.join(','));
        sheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date().toISOString());
        SpreadsheetApp.flush();
        return { success: true };
      }
    }

    return { success: false, error: 'No review found with ID: ' + reviewId };
  } catch (e) {
    Logger.log('Error approveClaimAPI: ' + e.toString());
    return { success: false, error: e.message };
  }
}

/**
 * rejectClaimAPI — manager rejects one staff member's claim.
 * Remove staffId from col U (pending), write to col X (rejected history), save the reason in col Y.
 * Params: { reviewId, staffId, reason? }
 */
function rejectClaimAPI(params) {
  try {
    const { reviewId, staffId, reason } = params;
    if (!reviewId || !staffId) return { success: false, error: 'Missing reviewId or staffId.' };

    const ss = getSafeSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_LOG_NAME);
    if (!sheet) return { success: false, error: 'Sheet not found ' + SHEET_LOG_NAME };

    const data = sheet.getDataRange().getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][COL_REVIEW_ID - 1]).trim() === String(reviewId).trim()) {
        const rowIndex = i + 1;

        // Remove from col U (pending)
        const existing = (data[i][COL_STAFF_CLAIMS - 1] || '').toString().trim();
        const claims = existing
          ? existing.split(',').map(function(s) { return s.trim(); }).filter(function(id) {
              return id && id !== String(staffId).trim();
            })
          : [];
        sheet.getRange(rowIndex, COL_STAFF_CLAIMS).setValue(claims.join(','));

        // Write to col X (rejected history) — append, don't delete the old entries
        const existingRejected = (data[i][COL_REJECTED_CLAIMS - 1] || '').toString().trim();
        const rejectedList = existingRejected
          ? existingRejected.split(',').map(function(s) { return s.trim(); }).filter(Boolean)
          : [];
        if (!rejectedList.includes(String(staffId).trim())) {
          rejectedList.push(String(staffId).trim());
        }
        sheet.getRange(rowIndex, COL_REJECTED_CLAIMS).setValue(rejectedList.join(','));

        // Save the reason in col Y (JSON map: staffId → reason)
        if (reason) {
          var existingReasonsRaw = (data[i][COL_REJECT_REASONS - 1] || '').toString().trim();
          var reasonsMap = {};
          try { reasonsMap = existingReasonsRaw ? JSON.parse(existingReasonsRaw) : {}; } catch(e) {}
          reasonsMap[String(staffId).trim()] = reason;
          sheet.getRange(rowIndex, COL_REJECT_REASONS).setValue(JSON.stringify(reasonsMap));
        }

        sheet.getRange(rowIndex, COL_UPDATED_AT).setValue(new Date().toISOString());
        SpreadsheetApp.flush();
        return { success: true };
      }
    }

    return { success: false, error: 'No review found with ID: ' + reviewId };
  } catch (e) {
    Logger.log('Error rejectClaimAPI: ' + e.toString());
    return { success: false, error: e.message };
  }
}
