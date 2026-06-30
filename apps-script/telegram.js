/**
 * FILE: telegram.js
 * Handles communication with the Telegram Bot API.
 * Sends interactive messages, builds approval buttons, and handles two-way callbacks.
 */

function escapeHTML(str) {
  if (!str) return "";
  return str.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Send a Telegram notification for a new review with 3 reply options and approval buttons.
 * Two-message strategy:
 *   - Message 1: full content (review + options + translation), NO buttons, auto-chunked if long.
 *   - Message 2: buttons only (always short, never exceeds 4096 chars).
 * The saved message_id is Message 2's, used to collapse/update after approval.
 *
 * @param {Object} review Review object {reviewId, locationName, reviewerName, rating, comment, hasMedia}
 * @param {Array} aiOptions Array of the 3 AI-generated options
 * @returns {number} The button message (Message 2) ID, for updating status later
 */
function sendTelegramReviewNotification(review, aiOptions, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const config = getSystemConfig();
  const token = config.telegramToken;
  const chatId = targetChatId || config.telegramChatId;

  const stars = "⭐".repeat(review.rating);
  const mediaIcon = review.hasMedia ? " 📸 (has attached photos)" : "";

  // ── MESSAGE 1: full content (no buttons) ──
  let contentMessage = "";

  let reviewerTagText = buildTelegramReviewerMention(config);
  if (reviewerTagText) {
    if (reviewerTagText.includes('<a href=')) {
      contentMessage += `🔔 Please reply to this review, <b>${reviewerTagText}</b>:\n\n`;
    } else {
      contentMessage += `🔔 Please reply to this review, <b>${escapeHTML(reviewerTagText)}</b>:\n\n`;
    }
  }

  if (review.rating <= 2) {
    contentMessage += `🚨 <b>RED ALERT: ${review.rating}-STAR REVIEW!</b> 🚨\n`;
    contentMessage += `⚠️ <i>Please handle this urgently to avoid a PR problem!</i>\n\n`;
    contentMessage += `📍 <b>Location:</b> ${escapeHTML(review.locationName)}\n`;
  } else {
    contentMessage += `🧁 <b>CÓ REVIEW MỚI!</b> (${escapeHTML(review.locationName)})\n`;
  }

  contentMessage += `👤 <b>Customer:</b> ${escapeHTML(review.reviewerName)}\n`;
  contentMessage += `⭐ <b>Rating:</b> ${stars}${mediaIcon}\n`;
  if (review.comment) {
    contentMessage += `💬 <b>Review:</b> <i>"${escapeHTML(review.comment)}"</i>\n`;
  } else {
    contentMessage += `💬 <b>Review:</b> <i>(No text, star rating only)</i>\n`;
  }
  contentMessage += `\n------------------------------------------\n`;
  contentMessage += `👉 <b>3 reply options:</b>\n\n`;

  const numEmojis = ["1️⃣", "2️⃣", "3️⃣"];
  aiOptions.forEach((opt, index) => {
    const num = index + 1;
    const emoji = numEmojis[index] || "🔹";
    contentMessage += `${emoji} <b>Option ${num} (${escapeHTML(opt.tone)}):</b>\n`;
    contentMessage += `<i>"${escapeHTML(opt.replyText || "")}"</i>\n`;
    if (opt.englishTranslation && opt.englishTranslation !== "API Error" && opt.englishTranslation !== "Same as customer-facing reply (English).") {
      contentMessage += `🇬🇧 <i>[Translation]: ${escapeHTML(opt.englishTranslation)}</i>\n`;
    }
    contentMessage += `\n`;
  });

  // Send Message 1 (auto-chunked if long)
  sendSimpleTelegramMessage(contentMessage, chatId);

  // ── MESSAGE 2: buttons only (always short) ──
  const shortId = review.shortId;
  const inlineKeyboard = {
    inline_keyboard: [
      [
        { text: "1️⃣ Pick Option 1", callback_data: `opt1_${shortId}` },
        { text: "2️⃣ Pick Option 2", callback_data: `opt2_${shortId}` }
      ],
      [
        { text: "3️⃣ Pick Option 3", callback_data: `opt3_${shortId}` },
        { text: "✍️ Write my own reply", callback_data: `custom_${shortId}` }
      ]
    ]
  };

  const buttonMessage = `━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n👆 <b>${escapeHTML(review.reviewerName)}</b> — tap to pick an option:`;

  const payload = {
    chat_id: chatId,
    text: buttonMessage,
    parse_mode: "HTML",
    reply_markup: JSON.stringify(inlineKeyboard)
  };

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    const result = JSON.parse(response.getContentText());
    if (result.ok) {
      return result.result.message_id; // Message 2 (buttons) ID, to collapse after approval
    } else {
      Logger.log(`Error sending Telegram buttons: ${response.getContentText()}`);
      return null;
    }
  } catch (e) {
    Logger.log(`Telegram API connection error: ${e.toString()}`);
    return null;
  }
}

/**
 * Update the old Telegram message to disable the buttons and mark it as approved.
 * 
 * @param {number} messageId ID of the message to update
 * @param {string} statusText New status text (e.g. "✅ Posted Option 1!")
 */
function updateTelegramMessage(messageId, statusText, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const config = getSystemConfig();
  const token = config.telegramToken;
  const chatId = targetChatId || config.telegramChatId;

  // Update the message's Reply Markup (remove the buttons)
  // and append a success status line at the end
  const url = `https://api.telegram.org/bot${token}/editMessageReplyMarkup`;
  
  const payload = {
    chat_id: chatId,
    message_id: messageId,
    reply_markup: JSON.stringify({ inline_keyboard: [] }) // Send an empty array to remove all buttons
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch(url, options);
    
    // Send a follow-up message confirming approval if statusText is provided
    if (statusText) {
      sendSimpleTelegramMessage(statusText, chatId);
    }
  } catch (e) {
    Logger.log(`Error updating Telegram buttons: ${e.toString()}`);
  }
}

/**
 * Send a simple text message to your Telegram
 */
function sendSimpleTelegramMessage(text, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const config = getSystemConfig();
  const token = config.telegramToken;
  const chatId = targetChatId || config.telegramChatId;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  
  const MAX_LENGTH = 4000;
  
  const sendChunk = (chunkText, parseMode) => {
    const payload = { chat_id: chatId, text: chunkText };
    if (parseMode) payload.parse_mode = parseMode;
    
    const response = UrlFetchApp.fetch(url, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    
    const result = JSON.parse(response.getContentText());
    if (!result.ok) {
      Logger.log("Error sending Telegram message: " + response.getContentText());
      // HTML parse failed -> resend as plain text
      if (parseMode === "HTML" && result.description && result.description.includes("parse")) {
        delete payload.parse_mode;
        payload.text = chunkText.replace(/<[^>]*>?/gm, ''); 
        const fallbackResponse = UrlFetchApp.fetch(url, {
          method: "post",
          contentType: "application/json",
          payload: JSON.stringify(payload),
          muteHttpExceptions: true
        });
        const fallbackResult = JSON.parse(fallbackResponse.getContentText());
        if (!fallbackResult.ok) {
          Logger.log("Error resending Telegram message as plain text: " + fallbackResponse.getContentText());
          return false;
        }
        return true;
      }
      return false;
    }
    return true;
  };

  if (text.length <= MAX_LENGTH) {
    return sendChunk(text, "HTML");
  } else {
    // If the text is too long, split it into chunks by line breaks
    let remaining = text;
    let allChunksSent = true;
    while (remaining.length > 0) {
      if (remaining.length <= MAX_LENGTH) {
        allChunksSent = sendChunk(remaining, "HTML") && allChunksSent;
        break;
      }
      let cutIndex = remaining.lastIndexOf('\n', MAX_LENGTH);
      if (cutIndex === -1 || cutIndex < MAX_LENGTH - 1000) {
        cutIndex = remaining.lastIndexOf(' ', MAX_LENGTH);
        if (cutIndex === -1) cutIndex = MAX_LENGTH;
      }
      const chunk = remaining.substring(0, cutIndex);
      allChunksSent = sendChunk(chunk, "HTML") && allChunksSent;
      remaining = remaining.substring(cutIndex).trim();
    }
    return allChunksSent;
  }
}

/**
 * Register the Google Apps Script Webhook URL with Telegram.
 * Run this once after deploying the Web App.
 */
function setupTelegramWebhook() {
  const config = getSystemConfig();
  const token = config.telegramToken;
  const chatId = config.telegramChatId;
  
  // Save token and chatId to PropertiesService as a fallback for background error alerts (when config can't be read)
  PropertiesService.getScriptProperties().setProperty("TELEGRAM_TOKEN", token);
  PropertiesService.getScriptProperties().setProperty("TELEGRAM_CHAT_ID", chatId);
  
  let webAppUrl = ScriptApp.getService().getUrl();
  
  // Ask the user to confirm the Web App URL to avoid Apps Script grabbing an old link when there are multiple deployments
  const ui = SpreadsheetApp.getUi();
  const promptResponse = ui.prompt(
    "Confirm Web App URL",
    "The system auto-detected your Web App URL below.\nIf you just created a New Deployment and have a new link, DELETE THE OLD ONE AND PASTE THE NEW LINK HERE:\n(The link must end in /exec)",
    ui.ButtonSet.OK_CANCEL
  );

  if (promptResponse.getSelectedButton() !== ui.Button.OK) {
    throw new Error("Webhook setup cancelled.");
  }

  const userInputUrl = promptResponse.getResponseText().trim();
  if (userInputUrl) {
    webAppUrl = userInputUrl;
  }
  
  if (!webAppUrl || webAppUrl.indexOf("exec") === -1) {
    throw new Error("Invalid URL. Deploy the Apps Script project as a 'Web App' first, copy the link ending in /exec, and paste it into the box.");
  }
  
  let secretToken = PropertiesService.getScriptProperties().getProperty("TELEGRAM_SECRET");
  if (!secretToken) {
    secretToken = Utilities.getUuid().replace(/-/g, "");
    PropertiesService.getScriptProperties().setProperty("TELEGRAM_SECRET", secretToken);
  }
  
  // Append the token directly to the Webhook URL instead of using Telegram's secret_token (Apps Script can't read headers)
  const secureUrl = webAppUrl + "?token=" + secretToken;
  const url = `https://api.telegram.org/bot${token}/setWebhook?url=${encodeURIComponent(secureUrl)}`;
  
  const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const result = JSON.parse(response.getContentText());
  
  if (result.ok) {
    return `Webhook activated! Telegram is connected to: ${webAppUrl}\n\nA secret token has been set.`;
  } else {
    return `Webhook activation error: ${response.getContentText()}`;
  }
}

/**
 * Helper to run Webhook setup from the Apps Script menu
 */
function runSetupWebhook() {
  const ui = SpreadsheetApp.getUi();
  try {
    const status = setupTelegramWebhook();
    ui.alert("Set Up Telegram Webhook", status, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("Error", e.message, ui.ButtonSet.OK);
  }
}

/**
 * Check what error Telegram's servers report when sending updates back to us.
 */
function checkWebhookStatus() {
  const ui = SpreadsheetApp.getUi();
  const config = getSystemConfig();
  const token = config.telegramToken;
  
  if (!token) {
    ui.alert("Error", "Telegram Token not found in config.", ui.ButtonSet.OK);
    return;
  }
  
  const url = `https://api.telegram.org/bot${token}/getWebhookInfo`;
  try {
    const response = UrlFetchApp.fetch(url, {muteHttpExceptions: true});
    const result = JSON.parse(response.getContentText());
    
    if (result.ok) {
      const info = result.result;
      let msg = `✅ Connected to URL: \n${info.url}\n\n`;
      msg += `📌 Pending updates (pending_update_count): ${info.pending_update_count}\n`;
      
      if (info.last_error_message) {
        msg += `\n❌ LỖI GẦN NHẤT TỪ TELEGRAM:\n${info.last_error_message}\n`;
        msg += `(Error occurred at: ${new Date(info.last_error_date * 1000).toLocaleString()})`;
      } else {
        msg += `\n🎉 No errors recorded. The webhook is working perfectly!`;
      }
      
      ui.alert("TRẠNG THÁI WEBHOOK TỪ MÁY CHỦ TELEGRAM", msg, ui.ButtonSet.OK);
    } else {
      ui.alert("LỖI API TELEGRAM", response.getContentText(), ui.ButtonSet.OK);
    }
  } catch(e) {
    ui.alert("LỖI THỰC THI", e.message, ui.ButtonSet.OK);
  }
}

/**
 * Collapse the old review message on Telegram to remove buttons and show a short summary.
 * 
 * @param {number} messageId ID of the message to update
 * @param {Object} review Review object {locationName, reviewerName, rating, comment}
 * @param {string} selectedText The chosen reply text
 * @param {string} managerName Name of the approver
 * @param {number} [targetChatId] Chat ID if different from default
 */
function collapseTelegramMessage(messageId, review, selectedText, managerName, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const config = getSystemConfig();
  const token = config.telegramToken;
  const chatId = targetChatId || config.telegramChatId;
  const url = `https://api.telegram.org/bot${token}/editMessageText`;

  const stars = "⭐".repeat(review.rating);
  let message = `✅ <b>REVIEW REPLY APPROVED</b>\n\n`;
  message += `📍 <b>Location:</b> ${escapeHTML(review.locationName)}\n`;
  message += `👤 <b>Customer:</b> ${escapeHTML(review.reviewerName)}\n`;
  message += `⭐ <b>Rating:</b> ${stars}\n`;
  if (review.comment) {
    message += `💬 <b>Review:</b> <i>"${escapeHTML(review.comment)}"</i>\n`;
  }
  message += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
  message += `💬 <b>Chosen reply:</b>\n`;
  message += `<i>"${escapeHTML(selectedText)}"</i>\n\n`;
  message += `👤 <b>Approved by:</b> <b>${escapeHTML(managerName)}</b>`;

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: message,
    parse_mode: "HTML",
    reply_markup: JSON.stringify({ inline_keyboard: [] })
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const result = JSON.parse(response.getContentText());
    if (!result.ok) {
      Logger.log(`Error collapsing Telegram message: ${response.getContentText()}`);
    }
  } catch (e) {
    Logger.log(`Error in collapse message API: ${e.toString()}`);
  }
}

/**
 * Delete a message on Telegram.
 * 
 * @param {number} messageId ID of the message to delete
 * @param {number} [targetChatId] Chat ID if different from default
 */
function deleteTelegramMessage(messageId, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const config = getSystemConfig();
  const token = config.telegramToken;
  const chatId = targetChatId || config.telegramChatId;
  const url = `https://api.telegram.org/bot${token}/deleteMessage`;

  const payload = {
    chat_id: chatId,
    message_id: messageId
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log(`Error deleting Telegram message: ${e.toString()}`);
  }
}

/**
 * Edit a message's text and remove its buttons on Telegram.
 * 
 * @param {number} messageId ID of the message to edit
 * @param {string} newText The new text
 * @param {number} [targetChatId] Chat ID if different from default
 */
function editTelegramMessageText(messageId, newText, targetChatId = null) {
  if (targetChatId && typeof targetChatId === "object") {
    targetChatId = null;
  }
  const config = getSystemConfig();
  const token = config.telegramToken;
  const chatId = targetChatId || config.telegramChatId;
  const url = `https://api.telegram.org/bot${token}/editMessageText`;

  const payload = {
    chat_id: chatId,
    message_id: messageId,
    text: newText,
    parse_mode: "HTML",
    reply_markup: JSON.stringify({ inline_keyboard: [] })
  };

  const options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    UrlFetchApp.fetch(url, options);
  } catch (e) {
    Logger.log(`Error editing Telegram message: ${e.toString()}`);
  }
}
