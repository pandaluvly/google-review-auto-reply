# Google Maps Auto-Reply — Open Kit

This is the full source kit from my blog post **"Google Maps Auto-Reply: How to Actually Build It (Step by Step)"** at [[https://khangpanda.substack.com/p/google-maps-auto-reply-how-to-actually)]).

It auto-generates AI reply options for your Google Maps reviews, sends them to Telegram for one-tap approval, and publishes the chosen reply back to Google — with reliability checks so you can stop babysitting it.

**I'm not an engineer.** I built this by getting stuck and asking AI. You can too.

### 🚀 The fastest way to use this kit

Open **`START-HERE-copy-this-prompt.md`**. It has a ready-made prompt: copy it, fill in a few blanks about your business, attach these files to an AI chat (Claude, ChatGPT, or Gemini), and the AI will walk you through the entire setup step by step — and rewrite the reply prompt to match *your* brand. You genuinely don't have to read the code. That file is the shortcut; everything below is reference.

---

## What's in here

```
apps-script/        The Google Apps Script code (the "brain")
  app.js              Main logic: scan reviews, call AI, Telegram, publish
  config.js           Reads all settings from your Sheet's Dashboard tab
  gemini.js           The AI hub (Gemini / Claude / ChatGPT with fallback)
  telegram.js         Telegram messages, buttons, webhook helpers
  health_check.js     ⭐ SELF-TEST: run runHealthCheck() to see what's
                      working and what's broken, in plain language
  appsscript.json     Apps Script manifest
  .clasp.json.example Rename to .clasp.json and add your own script ID

make-blueprints/    The 4 Make.com scenarios — import these into Make.com
  01_watch_reviews_location_A   Watch one location's reviews → Sheet
  02_watch_reviews_location_B   Same, for a 2nd location (skip if you have one)
  03_reply_to_review            Webhook → publish the reply to Google Maps
  04_verify_replies             Scheduled check that replies really went live

sheet-template/
  Review-Agent-TEMPLATE.xlsx    Upload to Google Sheets — columns already set up
```

### Importing the Make.com scenarios

In Make, create a scenario, then **⋯ (top bar) → Import Blueprint** and select the `.json` file. Repeat for each of the four. Every scenario ships with no credentials — you connect your own Google / Sheets / Telegram.

**One thing to set yourself:** the error-alert HTTP modules send to Telegram, so paste your own bot token into those module URLs (they're left as `<YOUR_TELEGRAM_BOT_TOKEN>` placeholders). Never put a real bot token in anything you share publicly — it's the password to your bot.

---

## ⚠️ Before you do anything: the keys are NOT in here

I stripped every API key, token, ID, webhook URL, and all staff/customer data. Everywhere you see `PASTE_YOUR_...` or `123456789`, that's a placeholder — put your own value there. **Nothing in this kit will work until you add your own credentials.** That's on purpose.

All settings live in **one place**: the **Dashboard & Config** tab of the Sheet. The code reads from there, so you almost never edit code to change a setting.

**You probably don't need all of it.** Several parts are specific to how I run La Lapine and are safe to ignore or delete. The biggest one: the whole **staff list / staff-detection** feature (the `aiStaff`, `staffClaims`, `staffTags` columns and the staff rows in the Dashboard) only exists because I have a policy of rewarding employees who get named in good reviews. If you don't reward staff that way, just leave those fields empty — nothing else breaks. Same for the second location, the HR Web App URL, and the IT-log Telegram group. Start with the minimum: one AI key, one location, a Telegram bot. Add the rest only if you actually want it.

---

## Setup order (follow the blog post alongside this)

1. **Google access** — make sure your Google account can use the Business Profile / My Business v4.9 reviews API (or just let Make.com handle the Google connection — see the post).
2. **The Sheet** — upload `Review-Agent-TEMPLATE.xlsx` to Google Drive, open as a Google Sheet. Fill in the **Dashboard & Config** tab: your AI API key(s), location IDs, Telegram token, staff list, Make webhook URL.
3. **Apps Script** — in your Sheet: Extensions → Apps Script. Paste in the files from `apps-script/`. Set the time trigger (clock icon → every 5 minutes).
4. **Make.com** — import the 4 blueprints. Reconnect each module to *your* Google / Sheets / webhook (the connections are blanked out). Turn the scenarios on.
5. **Telegram** — create a bot with @BotFather, deploy the Apps Script as a Web App ("Execute as: Me", "Anyone" access), and register the `/exec` URL as your Telegram webhook. *(This step is the fiddly one — read the warning in the blog post.)*

## 🩺 Stuck? Run the self-test first

Before you ask anyone (human or AI) what's wrong, run the built-in diagnostic. In the Apps Script editor, pick **`runHealthCheck`** from the function dropdown and press Run, then open **View → Logs**.

It checks every piece of your setup — settings, AI key, AI response, Telegram bot, Telegram delivery, Make webhook, location IDs, the trigger, and the Telegram webhook link — and prints `✅ PASS`, `⚠️ WARN`, or `❌ FAIL` for each, with a one-line fix under every failure. It tells you *exactly which part* is broken so you're not guessing.

If a fix still doesn't make sense, copy the whole log into an AI with the matching file and ask "help me fix this failing check." That's the intended workflow.

---

When something breaks — and it will — copy the exact error + the relevant file into an AI and ask what's wrong. Works every time.

---

## License & honesty

Use it, change it, ship it, charge for it — I don't mind. No warranty: this is my real working system, shared as-is, not a polished product. If it eats your reviews, that's on you (it won't, but I have to say it).

Built with a lot of help from Claude, Antigravity, ChatGPT, Codex, Gemini — and a few too many americanos.

— Panda (An Khang, Đà Lạt)
