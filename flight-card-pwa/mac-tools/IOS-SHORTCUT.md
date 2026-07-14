# Social notes sync — the iPhone / iPad way (no Mac needed)

Apple **Shortcuts** can read the Notes app directly and POST to a URL, and iOS
can run a Shortcut on a **weekly automation**. So the whole Mac→worker script
has an iOS equivalent that needs no computer at all.

The worker cleans up the note titles for you (it extracts the airport code and
throws away anything that isn't one), so the Shortcut can stay very simple —
it just ships `{ "<note title>": "<note body>" }` straight up.

---

## 1. Build the Shortcut (once, ~2 minutes)

Open **Shortcuts** → **+** → *New Shortcut*. Name it **Sync Airport Notes**.
Add these actions in order:

| # | Action | Settings |
|---|--------|----------|
| 1 | **Find Notes** | Filter: **Folder** `is` **Airports**. (Add the filter with "Add Filter".) Leave the limit off so it gets all of them. |
| 2 | **Dictionary** | Leave it **empty**. Rename its output variable to `Notes JSON` (tap the variable → Rename). |
| 3 | **Repeat with Each** | Input: **Find Notes** result from step 1. |
| 4 | ↳ *(inside the repeat)* **Set Dictionary Value** | Dictionary: `Notes JSON` · Key: **Repeat Item → Name** · Value: **Repeat Item → Body** |
| 5 | *(after the repeat)* **Get Contents of URL** | URL: `https://b737-asu-pwa.alonbrookstein.workers.dev/social/<YOUR-TOKEN>` <br> Method: **POST** <br> Headers: `Content-Type` = `application/json` <br> Request Body: **JSON** → set it to the `Notes JSON` variable |
| 6 | **Show Result** *(optional)* | Shows the worker's reply, e.g. `{"ok":true,"airports":7}` |

> **Getting Name / Body inside the repeat:** tap the value field, pick the
> **Repeat Item** magic variable, then tap it again and choose the property
> (**Name** for the title, **Body** for the text).

Run it once with the ▶︎ button. iOS asks permission to access Notes — allow.
You should see `{"ok":true,"airports":N}`.

---

## 2. Make it run weekly (automation)

**Shortcuts → Automation tab → +**

1. **Time of Day** → pick a time (e.g. **Monday 08:00**), Repeat: **Weekly**.
2. Action: **Run Shortcut** → *Sync Airport Notes*.
3. **Turn OFF "Ask Before Running"** (and "Notify When Run" if you want it
   silent). This is what makes it truly automatic.

Done — every Monday your Airports notes are pushed up, and the Flight Card app
pulls them into each airport's **Social** tab on its own weekly check.

---

## 3. Point the app at the feed

In **Flight Card → Settings → Social notes**, paste (same token as the Shortcut):

```
https://b737-asu-pwa.alonbrookstein.workers.dev/social/<YOUR-TOKEN>.json
```

Tap **Sync now** to pull immediately instead of waiting for the weekly check.

---

## Notes convention

One note per airport in the **Airports** folder, titled with the code:

```
TLV          LLBG          TLV / LLBG          CDG - Paris
```

The worker keeps the leading 3–4-letter code and drops any note whose title
isn't a code. IATA or ICAO both work — the app stores each note under both, so
it matches whichever code your flights use.

## Privacy

The Shortcut only **reads** the Airports folder and only sends those notes.
Nothing else in Notes is touched or transmitted. The feed URL is protected by
the random token — treat it like a password.
