/**
 * FILE: daily_rescue.js
 * "Daily rescue" for reviews stuck in status `failed_permanently`.
 *
 * Context: retryPublishQueue() auto-retries `publish_failed` / `connection_error`
 * up to 3 times, then sets `failed_permanently` and STOPS (no more auto-retry).
 * This file adds a gentle once-a-day pass that revives those rows so a transient
 * outage (e.g. Apps Script Web App blip, Make/GBP hiccup) doesn't require manual work.
 *
 * Safety design (avoid spamming Google API):
 *  - Only rescues rows OLDER than RESCUE_MIN_AGE_HOURS (skip fresh failures).
 *  - Caps total rescue rounds at MAX_RESCUE_ROUNDS; beyond that it truly stays
 *    manual and just alerts once, so genuinely broken rows don't loop forever.
 *  - Runs once per day via its own time-based trigger.
 */

// ---- Tunables ----
const RESCUE_MIN_AGE_HOURS = 6;   // Only rescue rows failed at least this long ago
const MAX_RESCUE_ROUNDS    = 3;   // Max number of daily-rescue rounds per row
const RESCUE_MARKER        = "AUTO-RESCUE"; // Marker written into the error cell to count rounds

/**
 * Scan the Reviews sheet, find `failed_permanently` rows older than RESCUE_MIN_AGE_HOURS,
 * and reset them to `publish_failed` + retry_count = 0 so retryPublishQueue() picks them up
 * on the next 5-minute cycle. Skips rows that have already been rescued MAX_RESCUE_ROUNDS times.
 */
function dailyRescueFailedPermanently() {
  // Respect the ENABLED/DISABLED switch in the TriggerRegistry sheet (defaults to enabled).
  if (!isTriggerEnabled('dailyRescueFailedPermanently')) {
    Logger.log('🚫 Trigger dailyRescueFailedPermanently is OFF. Skipping.');
    return;
  }

  const ss = getSafeSpreadsheet();
  const logSheet = ss.getSheetByName("Reviews");
  if (!logSheet) return;

  const lastRow = logSheet.getLastRow();
  if (lastRow <= 1) return;

  const data = logSheet.getDataRange().getValues();
  const now = new Date();

  let rescued = 0;
  let skippedTooFresh = 0;
  let exhausted = 0;

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const status = String(row[COL_STATUS - 1] || "").trim();
    if (status !== "failed_permanently") continue;

    const rowIndex = i + 1;
    const reviewerName = row[COL_CUSTOMER - 1];
    const replyText = row[COL_SELECTION - 1] || "";
    const errorMessage = String(row[COL_ERROR_MESSAGE - 1] || "");

    // Need a reply text to resend; if missing, leave for manual handling.
    if (!replyText) continue;

    // Age check — skip rows that failed too recently.
    const updatedAt = row[COL_UPDATED_AT - 1];
    if (updatedAt) {
      try {
        const diffHours = (now - new Date(updatedAt)) / (1000 * 60 * 60);
        if (diffHours < RESCUE_MIN_AGE_HOURS) {
          skippedTooFresh++;
          continue;
        }
      } catch (e) {
        // If timestamp unparseable, allow rescue.
      }
    }

    // Count how many rescue rounds this row already had (from the marker in the error cell).
    const priorRounds = (errorMessage.match(new RegExp(RESCUE_MARKER, "g")) || []).length;
    if (priorRounds >= MAX_RESCUE_ROUNDS) {
      exhausted++;
      continue; // Truly stays manual now.
    }

    const thisRound = priorRounds + 1;

    // Reset back into the auto-retry queue.
    logSheet.getRange(rowIndex, COL_STATUS).setValue("publish_failed");
    logSheet.getRange(rowIndex, COL_RETRY_COUNT).setValue(0);
    logSheet.getRange(rowIndex, COL_UPDATED_AT).setValue(now);
    logSheet.getRange(rowIndex, COL_ERROR_MESSAGE)
      .setValue(`[${RESCUE_MARKER} ${thisRound}/${MAX_RESCUE_ROUNDS}] Reset from failed_permanently to retry.`);
    SpreadsheetApp.flush();

    rescued++;
    sendLogToIT(`♻️ Daily rescue (${thisRound}/${MAX_RESCUE_ROUNDS}): ${reviewerName}'s review reset from failed_permanently → publish_failed to auto-retry.`, "INFO");
  }

  // One summary line so the log isn't noisy.
  if (rescued > 0 || exhausted > 0) {
    sendLogToIT(
      `♻️ Daily rescue done. Rescued: ${rescued}, still-fresh-skipped: ${skippedTooFresh}, exhausted (needs manual): ${exhausted}.`,
      exhausted > 0 ? "WARNING" : "INFO"
    );
  }
}

/**
 * Menu helper: create/refresh the once-a-day trigger for dailyRescueFailedPermanently.
 * Runs daily at 08:00 Asia/Ho_Chi_Minh (before the 9am morning reports).
 */
function setupDailyRescueTrigger() {
  const ui = SpreadsheetApp.getUi();
  try {
    const ss = getSafeSpreadsheet();
    PropertiesService.getScriptProperties().setProperty("SPREADSHEET_ID", ss.getId());

    // Remove old copies to avoid duplicates.
    const triggers = ScriptApp.getProjectTriggers();
    for (let i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === "dailyRescueFailedPermanently") {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }

    ScriptApp.newTrigger("dailyRescueFailedPermanently")
      .timeBased()
      .atHour(8)
      .everyDays(1)
      .inTimezone("Asia/Ho_Chi_Minh")
      .create();

    ui.alert("✅ Success", "Daily rescue enabled! Every day at 8am the system revives failed_permanently reviews (older than " + RESCUE_MIN_AGE_HOURS + "h) to auto-retry, up to " + MAX_RESCUE_ROUNDS + " rounds.", ui.ButtonSet.OK);
  } catch (e) {
    ui.alert("❌ Error", "Could not create the trigger. Details: " + e.message, ui.ButtonSet.OK);
  }
}

/**
 * Menu helper: run the rescue immediately (manual, no UI prompts inside).
 */
function runDailyRescueFromMenu() {
  const ui = SpreadsheetApp.getUi();
  dailyRescueFailedPermanently();
  ui.alert("Done", "Daily rescue ran once. Check the Telegram IT log for details.", ui.ButtonSet.OK);
}
