/**
 * ============================================================================
 * health_check.js  —  SETUP SELF-TEST / DIAGNOSTIC
 * ============================================================================
 *
 * WHAT THIS IS
 *   A single button that checks every part of your setup and tells you, in
 *   plain language, exactly what's working and what isn't. Run it whenever
 *   something doesn't behave and you don't know why.
 *
 * HOW TO RUN
 *   1. Make sure you've pasted ALL the kit files into your Apps Script project
 *      (app.js, config.js, gemini.js, telegram.js, and this file).
 *   2. In the Apps Script editor, open the function dropdown at the top,
 *      choose  runHealthCheck  and press Run.
 *   3. The first time, Google will ask for permissions — allow them.
 *   4. Open  View → Logs  (or press Ctrl/Cmd + Enter) to read the report.
 *
 * HOW TO READ IT
 *   ✅ PASS   = this part is working.
 *   ⚠️ WARN   = not broken, but probably not what you want yet.
 *   ❌ FAIL   = this is broken. The line under it tells you how to fix it.
 *
 * If you get stuck on a FAIL you don't understand: copy the whole log, paste
 * it into an AI (Claude / ChatGPT / Gemini) with the relevant file, and ask
 * "help me fix this failing check." That's the intended way to use this.
 *
 * Nothing here changes your live reviews. The only side effect is one test
 * message sent to your own Telegram (so you can confirm Telegram works).
 * ============================================================================
 */

// ─── tiny logging helpers ────────────────────────────────────────────────────
var _HC = { pass: 0, warn: 0, fail: 0 };

function _hcSection(title) { Logger.log('\n══════════════════════════════════════════\n  ' + title + '\n══════════════════════════════════════════'); }
function _hcPass(msg)      { _HC.pass++; Logger.log('  ✅ PASS  — ' + msg); }
function _hcWarn(msg, fix) { _HC.warn++; Logger.log('  ⚠️ WARN  — ' + msg + (fix ? '\n          → ' + fix : '')); }
function _hcFail(msg, fix) { _HC.fail++; Logger.log('  ❌ FAIL  — ' + msg + (fix ? '\n          → FIX: ' + fix : '')); }

/**
 * ▶ RUN THIS ONE.
 */
function runHealthCheck() {
  _HC = { pass: 0, warn: 0, fail: 0 };
  Logger.log('🩺  REVIEW-AGENT HEALTH CHECK  —  ' + new Date());

  var config = _hcCheckConfig();        // T1 — settings load at all?
  if (!config) { _hcSummary(); return; } // can't continue without config

  _hcCheckSheetStructure();             // T2 — Reviews tab + columns
  _hcCheckAiKeys(config);               // T3 — at least one AI key + status
  _hcCheckAiResponds(config);           // T4 — AI actually answers
  _hcCheckTelegramToken(config);        // T5 — bot token valid
  _hcCheckTelegramMessage(config);      // T6 — can reach your chat (sends 1 msg)
  _hcCheckMakeWebhook(config);          // T7 — Make webhook reachable
  _hcCheckLocations(config);            // T8 — Google location IDs present
  _hcCheckTriggers();                   // T9 — 5-minute trigger installed
  _hcCheckWebhookRegistration(config);  // T10 — Telegram webhook wired up

  _hcSummary();
}

function _hcSummary() {
  _hcSection('SUMMARY');
  Logger.log('  ✅ ' + _HC.pass + ' passed   ⚠️ ' + _HC.warn + ' warnings   ❌ ' + _HC.fail + ' failed');
  if (_HC.fail === 0 && _HC.warn === 0) Logger.log('\n  🎉 Everything looks good. Go test with a real review.');
  else if (_HC.fail === 0)              Logger.log('\n  👍 No hard failures. Review the warnings above — they may be intentional.');
  else                                  Logger.log('\n  🔧 Fix the ❌ items top to bottom, then run this again. Each FAIL has a → FIX line.');
}

// ─── T1: Config loads ────────────────────────────────────────────────────────
function _hcCheckConfig() {
  _hcSection('T1 — Settings (Dashboard & Config tab)');
  try {
    var config = getSystemConfig();
    _hcPass('Found the "' + SHEET_CONFIG_NAME + '" tab and read your settings.');
    return config;
  } catch (e) {
    _hcFail('Could not read your settings: ' + e.message,
            'Make sure your Sheet has a tab named exactly "' + SHEET_CONFIG_NAME +
            '" and that you pasted config.js into this project.');
    return null;
  }
}

// ─── T2: Sheet structure ─────────────────────────────────────────────────────
function _hcCheckSheetStructure() {
  _hcSection('T2 — Reviews tab & columns');
  try {
    var ss = getSafeSpreadsheet();
    var sheet = ss.getSheetByName(SHEET_LOG_NAME);
    if (!sheet) {
      _hcFail('No tab named "' + SHEET_LOG_NAME + '".',
              'Rename your data tab to "' + SHEET_LOG_NAME + '" (use the included Excel template).');
      return;
    }
    _hcPass('Found the "' + SHEET_LOG_NAME + '" tab.');

    var lastCol = sheet.getLastColumn();
    if (lastCol < COL_TELEGRAM_MSG_ID) {
      _hcWarn('Your Reviews tab has only ' + lastCol + ' columns; the system uses up to ' + COL_REJECT_REASONS + '.',
              'Add the missing columns (see README). The first ' + COL_TELEGRAM_MSG_ID + ' are the important ones.');
    } else {
      _hcPass('Column count looks right (' + lastCol + ' columns).');
    }
  } catch (e) {
    _hcFail('Could not inspect the Reviews tab: ' + e.message, 'Check that getSafeSpreadsheet() / config.js is present.');
  }
}

// ─── T3: AI keys present + at least one ON ────────────────────────────────────
function _hcCheckAiKeys(config) {
  _hcSection('T3 — AI keys & status');
  var providers = [
    { name: 'Gemini',  key: config.geminiApiKey,  status: config.geminiStatus },
    { name: 'Claude',  key: config.claudeApiKey,  status: config.claudeStatus },
    { name: 'ChatGPT', key: config.chatgptApiKey, status: config.chatgptStatus }
  ];
  var anyOn = false;
  providers.forEach(function (p) {
    var hasKey = p.key && p.key.indexOf('PASTE_') !== 0 && p.key.length > 10;
    if (hasKey && p.status === 'ON') { _hcPass(p.name + ' has a key and is ON.'); anyOn = true; }
    else if (hasKey)                 { _hcWarn(p.name + ' has a key but status is "' + p.status + '".', 'Set its status cell to ON in the Dashboard tab if you want to use it.'); }
    else                             { Logger.log('  ·  ' + p.name + ': no key (skipped).'); }
  });
  if (!anyOn) _hcFail('No AI provider is both configured and ON.',
                      'Paste at least one API key into the Dashboard tab (Gemini free tier is easiest) and set its status to ON.');
}

// ─── T4: AI actually responds ─────────────────────────────────────────────────
function _hcCheckAiResponds(config) {
  _hcSection('T4 — AI responds to a sample review');
  try {
    var result = generateRepliesWithAI('Test Customer', 5, 'Lovely place, great coffee and service!', config.location1.name || 'Test Location');
    var options = result && (result.options || (result.data && result.data.options));
    if (options && options.length >= 1) {
      _hcPass('AI returned ' + options.length + ' reply option(s). Example: "' + String(options[0].replyText || options[0]).slice(0, 60) + '..."');
    } else {
      _hcWarn('AI was called but returned no usable options.', 'Check the raw response in the logs; your prompt or model name may need adjusting.');
    }
  } catch (e) {
    _hcFail('The AI call failed: ' + e.message,
            'Usually a bad/expired API key, a wrong model name in the Dashboard tab, or no billing/free-tier on the key. Paste this error into an AI to pinpoint it.');
  }
}

// ─── T5: Telegram bot token valid ─────────────────────────────────────────────
function _hcCheckTelegramToken(config) {
  _hcSection('T5 — Telegram bot token');
  if (!config.telegramToken || config.telegramToken.indexOf('PASTE_') === 0) {
    _hcFail('No Telegram bot token set.', 'Create a bot with @BotFather and paste its token into the Dashboard tab (B17).');
    return;
  }
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + config.telegramToken + '/getMe', { muteHttpExceptions: true });
    var body = JSON.parse(res.getContentText());
    if (body.ok) _hcPass('Bot token is valid. Bot name: @' + body.result.username);
    else         _hcFail('Telegram rejected the token: ' + (body.description || 'unknown'), 'Re-copy the token from @BotFather — no spaces, the whole thing.');
  } catch (e) {
    _hcFail('Could not reach Telegram: ' + e.message, 'Check the token format (looks like 1234567890:AAxxxxxxxx).');
  }
}

// ─── T6: Telegram message reaches your chat (sends one test message) ──────────
function _hcCheckTelegramMessage(config) {
  _hcSection('T6 — Send a test message to your Telegram');
  if (!config.telegramChatId || config.telegramChatId.indexOf('PASTE_') === 0) {
    _hcFail('No approval chat ID set (Dashboard B18).',
            'Add your bot to a group, send any message, then get the group chat ID (negative number) and paste it in. An AI can show you how in 1 minute.');
    return;
  }
  try {
    sendSimpleTelegramMessage('🩺 Health check: if you can read this, your Telegram wiring works. ✅');
    _hcPass('Test message sent. CHECK YOUR TELEGRAM — did it arrive in the right chat?');
  } catch (e) {
    _hcFail('Sending failed: ' + e.message,
            'The bot must be a member of that chat, and the chat ID must match (group IDs are negative). Paste this error into an AI.');
  }
}

// ─── T7: Make webhook reachable ───────────────────────────────────────────────
function _hcCheckMakeWebhook(config) {
  _hcSection('T7 — Make.com reply webhook');
  if (!config.makeWebhookUrl || config.makeWebhookUrl.indexOf('PASTE_') === 0) {
    _hcFail('No Make webhook URL set (Dashboard B21).',
            'Open your "Reply to Review" scenario in Make, copy the webhook URL from the first module, paste it into the Dashboard tab.');
    return;
  }
  if (config.makeWebhookUrl.indexOf('hook.') === -1) {
    _hcWarn('That doesn\'t look like a Make webhook URL.', 'It should start with https://hook.<region>.make.com/...');
  }
  try {
    var res = UrlFetchApp.fetch(config.makeWebhookUrl, {
      method: 'post', contentType: 'application/json',
      payload: JSON.stringify({ healthCheck: true }), muteHttpExceptions: true
    });
    var code = res.getResponseCode();
    if (code >= 200 && code < 500) _hcPass('Webhook is reachable (HTTP ' + code + '). (A test ping may appear in your Make history — that\'s fine.)');
    else                           _hcWarn('Webhook returned HTTP ' + code + '.', 'Make sure the scenario is turned ON and the URL is current.');
  } catch (e) {
    _hcFail('Could not reach the webhook: ' + e.message, 'Double-check the URL and that the scenario exists and is active.');
  }
}

// ─── T8: Google location IDs ──────────────────────────────────────────────────
function _hcCheckLocations(config) {
  _hcSection('T8 — Google location IDs');
  var l1 = config.location1, ok1 = l1.accountId && l1.accountId.indexOf('PASTE_') !== 0 && l1.locationId && l1.locationId.indexOf('PASTE_') !== 0;
  if (ok1) _hcPass('Location 1 has account + location IDs.');
  else _hcWarn('Location 1 IDs are missing or still placeholders.',
               'If Make.com handles your Google connection, you may not need these. If you call Google directly (or use the verify scenario), fill them in.');
  var l2 = config.location2, has2 = (l2.accountId && l2.accountId.indexOf('PASTE_') !== 0) || (l2.locationId && l2.locationId.indexOf('PASTE_') !== 0);
  if (has2) _hcPass('Location 2 is also configured.');
  else Logger.log('  ·  Location 2: not set (fine if you have one location).');
}

// ─── T9: Time trigger installed ───────────────────────────────────────────────
function _hcCheckTriggers() {
  _hcSection('T9 — The 5-minute trigger');
  try {
    var triggers = ScriptApp.getProjectTriggers();
    var timed = triggers.filter(function (t) { return t.getEventType() === ScriptApp.EventType.CLOCK; });
    if (timed.length > 0) _hcPass('Found ' + timed.length + ' time-based trigger(s). The system will run on its own.');
    else _hcFail('No time-based trigger installed.',
                 'In the editor: Triggers (clock icon) → Add Trigger → pick your main scan function → time-driven → every 5 minutes. Without this, nothing runs automatically.');
  } catch (e) {
    _hcWarn('Could not read triggers: ' + e.message, 'Open the Triggers panel manually to confirm.');
  }
}

// ─── T10: Telegram webhook registered to this script ──────────────────────────
function _hcCheckWebhookRegistration(config) {
  _hcSection('T10 — Telegram webhook (the tap → script link)');
  if (!config.telegramToken || config.telegramToken.indexOf('PASTE_') === 0) { Logger.log('  ·  Skipped (no bot token).'); return; }
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + config.telegramToken + '/getWebhookInfo', { muteHttpExceptions: true });
    var info = JSON.parse(res.getContentText());
    var url = info.ok && info.result ? info.result.url : '';
    if (url) {
      _hcPass('Telegram webhook is set to: ' + url);
      if (url.indexOf('/exec') === -1) _hcWarn('That URL doesn\'t end in /exec.', 'Re-register using your Web App deployment URL (ends in /exec).');
      if (info.result.last_error_message) _hcWarn('Telegram reports a recent delivery error: "' + info.result.last_error_message + '".', 'Your deployment URL may be old. Re-deploy and re-register the webhook.');
    } else {
      _hcFail('No Telegram webhook registered — button taps will go nowhere.',
              'Deploy this script as a Web App (Execute as: Me, Access: Anyone), copy the /exec URL, then call setWebhook once with it. This is the #1 reason buttons "do nothing."');
    }
  } catch (e) {
    _hcWarn('Could not read webhook info: ' + e.message, 'Check the bot token.');
  }
}
