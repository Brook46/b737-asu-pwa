# Social notes sync — the iPhone / iPad way (no Mac needed)

Apple **Shortcuts** can read the Notes app directly and POST to a URL, and iOS
can run a Shortcut on a **weekly automation**. So the whole Mac→worker script
has an iOS equivalent that needs no computer at all.

The Shortcut sends **one note per request**. That's the whole trick: there's no
Combine Text, no custom separator and no dictionary to build — those are the
parts of the Shortcuts editor that are easy to mis-wire. (An empty separator
silently glues every note into one block, so only the first airport survives; a
stray variable pill posts the literal word `false` as the note body. Both were
hit in practice.) The worker takes each note on its own and reads the airport
code off its first line.

---

## 1. Build the Shortcut (once, 4 actions)

Open **Shortcuts** → **+** → name it **Sync airport notes**.

| # | Action | Settings |
|---|--------|----------|
| 1 | **Find Notes** | Filter: **Folder** `is` **AIRPORTS B**. Limit off. |
| 2 | **Repeat with each item in** | Input: the **Notes** variable from step 1. |
| 3 | ↳ *(inside the repeat)* **Get Contents of URL** | URL: `https://b737-asu-pwa.alonbrookstein.workers.dev/social/<YOUR-TOKEN>/add` <br> Method: **POST** <br> Request Body: **Text** → put the **Repeat Item** variable in it, alone. No headers needed. |
| 4 | **End Repeat** | (appears automatically with the repeat) |

Optionally add **Show Result** after End Repeat — it prints the last reply,
e.g. `{"ok":true,"saved":["TLV"]}`.

Run it once with ▶︎. iOS asks permission to read Notes — allow.

> **Note the `/add` on the end of the URL.** Without it each request *replaces*
> the whole feed instead of adding to it, so you'd be left with only the last
> note.

### Checking it worked

Every reply names the note it just stored (`"saved":["TLV"]`). To see the whole
set, open the feed URL in Safari:

```
https://b737-asu-pwa.alonbrookstein.workers.dev/social/<YOUR-TOKEN>.json
```

Give it ~20 seconds after the run. The store's index lags its writes by a few
seconds, so a note can be saved but not yet listed. That lag is exactly why the
reply no longer prints a running count — mid-loop it reads low and looks like a
failure when nothing is wrong.

---

## 2. Make it run weekly (automation)

**Shortcuts → Automation tab → +**

1. **Time of Day** → e.g. **Monday 08:00**, Repeat: **Weekly**.
2. Action: **Run Shortcut** → *Sync airport notes*.
3. **Turn OFF "Ask Before Running"** — this is what makes it truly automatic.

---

## 3. Point the app at the feed

In **Flight Card → Settings → Social notes**, paste (same token, note the
`.json`):

```
https://b737-asu-pwa.alonbrookstein.workers.dev/social/<YOUR-TOKEN>.json
```

Tap **Sync now** to pull immediately. The header ↻ refreshes it too.

---

## Notes convention

One note per airport in the **AIRPORTS B** folder, titled with the code:

```
TLV          LLBG          TLV / LLBG          CDG - Paris
```

The worker keeps the leading 3–4-letter code and drops any note whose title
isn't one (so "Shopping list" is ignored). IATA or ICAO both work — the app
stores each note under both, so it matches whichever code your flights use.
**A note with an empty body is skipped**, so if an airport never appears, check
there's actually text under the title.

## Removing a note

Deleting a note in Apple Notes doesn't remove it from the feed — nothing tells
the worker it's gone. To wipe the slate and re-upload, POST an empty object to
the URL **without** `/add`:

```bash
curl -X POST -H 'content-type: application/json' --data '{}' \
  https://b737-asu-pwa.alonbrookstein.workers.dev/social/<YOUR-TOKEN>
```

Then run the Shortcut again.

## Privacy

The Shortcut only **reads** the AIRPORTS B folder and only sends those notes.
Nothing else in Notes is touched or transmitted. The feed URL is protected by
the random token — treat it like a password.
