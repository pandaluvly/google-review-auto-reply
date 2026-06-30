# 👉 Start here: copy this prompt into an AI

You don't need to read the code. You need to do three things:

1. Open an AI chat that can read files — **Claude, ChatGPT, or Gemini**.
2. **Attach / upload the files in this kit** (drag in the `apps-script` files, the `make-blueprints`, the Excel template — or just zip the whole folder and attach it).
3. **Copy the prompt below, fill in the blanks `[ ]`, paste it in.**

Then just follow what the AI tells you, one step at a time. When it says "do X," do X. When something errors, paste the error back. That's the whole method — it's how the system was built in the first place.

---

## 📋 THE PROMPT (copy everything in this box)

```
You are my hands-on build coach. I'm setting up an automated Google Maps
review-reply system from a kit I've attached. I am NOT a developer — explain
everything in plain language, one step at a time, and wait for me to finish
each step before giving me the next one. Assume I will get stuck; when I do,
I'll paste the exact error and you'll help me fix it.

ABOUT MY BUSINESS (so you can adapt the AI prompt and settings for me):
- Business name: [your business name]
- What we sell / type of place: [e.g. bakery and coffee shop]
- City / country: [your location]
- Languages my reviews come in: [e.g. English, Vietnamese, Korean]
- Brand voice in one line: [e.g. warm, playful, a little self-aware]
- 2-3 keywords or signature products I'd love to seed into replies:
  [e.g. sourdough, oat milk latte, garden seating]
- Do I reward staff who get named in good reviews? [yes / no]
  (if no, we'll skip the staff-tracking parts)

WHAT I'VE ATTACHED:
- Google Apps Script code (app.js, config.js, gemini.js, telegram.js, etc.)
- 4 Make.com scenario blueprints (.json) to import
- A Google Sheet template (Excel) with the columns already set up

WHAT I WANT YOU TO DO:
1. First, give me the full setup as a numbered checklist so I see the whole map.
2. Then walk me through it ONE step at a time, in this order:
   a. Set up the Google Sheet from the template and fill the Dashboard tab
   b. Get my AI API key (start with Google Gemini's free tier)
   c. Paste the Apps Script code in (including health_check.js) and set the
      5-minute trigger
   d. Import and connect the Make.com blueprints
   e. Create the Telegram bot, deploy the script as a Web App, and connect
      the Telegram webhook (warn me about the common mistakes here)
3. After each major step, tell me to run the built-in self-test by choosing
   the "runHealthCheck" function in the Apps Script editor and pressing Run,
   then opening View > Logs. I'll paste the log back to you. Read it, tell me
   which checks passed/failed, and help me fix every ❌ FAIL before we move on.
4. When all checks pass, walk me through testing it end to end with one review.
5. Rewrite the AI reply prompt inside the code so it matches MY business and
   brand voice above — don't leave it sounding like the original shop.
6. Tell me which fields/columns I can ignore based on my answers above.

Start by reading the attached files and giving me the checklist. Then ask me
for anything you still need before step 1.
```

---

## After you paste it

- The AI will give you a checklist, then take you through each step.
- Keep this kit's files attached in the chat so it can refer to them.
- **Use the built-in self-test as you go.** The kit includes `health_check.js`. In the Apps Script editor, pick **`runHealthCheck`** from the function dropdown, press Run, then open **View → Logs**. It checks every part of your setup (settings, AI key, AI response, Telegram, Make webhook, trigger, webhook link) and prints `✅ PASS` / `⚠️ WARN` / `❌ FAIL` with a fix for each. Paste that log back to the AI and it'll tell you exactly what to fix next.
- Stuck on an error? Paste the **exact** error text + which step you're on. Don't paraphrase it.
- For the Telegram + Web App step specifically (the trickiest part), also paste your deployment `/exec` URL and the result of the `getWebhookInfo` check — or just the health-check log — the AI can usually spot the problem instantly.

That's it. Fill in the blanks, attach the code, and let the AI walk you the rest of the way.

— Panda
