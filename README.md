# Rolodeal

Scan a business card, file it, hand it off. Installable PWA, Vercel serverless
extraction, cards stored on the device in IndexedDB.

---

## Deploy in five minutes

```bash
# 1. from this folder
npm install

# 2. connect the project (creates .vercel, does not deploy yet)
npx vercel link

# 3. add the key. Paste it when prompted, once per environment.
npx vercel env add ANTHROPIC_API_KEY production
npx vercel env add ANTHROPIC_API_KEY preview
npx vercel env add ANTHROPIC_API_KEY development

# 4. ship
npx vercel --prod
```

Then point `cards.randybabi.com` at it: Vercel dashboard, Settings, Domains,
add the subdomain, and add the CNAME it gives you at your registrar.

### Local development

```bash
npx vercel dev      # runs the app and the API route together on :3000
```

`npm run dev` alone runs Vite only and proxies `/api` to port 3000, so use
`vercel dev` unless you are just doing UI work.

---

## The key

`ANTHROPIC_API_KEY` is read only inside `api/extract.js`, which runs on
Vercel's server. The browser never sees it. It posts base64 images to
`/api/extract` and gets structured JSON back.

`.gitignore` blocks `.env` and `.env.local`. `.env.example` is the only env
file that gets committed and it contains a placeholder. If a real key ever
lands in a commit, rotate it in the Anthropic console immediately. Deleting
the commit is not enough.

---

## What lives where

```
api/extract.js          serverless route, holds the key, calls Claude
src/Rolodeal.jsx        the whole app
src/lib/storage.js      IndexedDB wrapper (get/set/delete/list)
public/sw.js            service worker, offline shell
public/manifest.webmanifest
```

**Data model.** Two key patterns in IndexedDB:

- `rolodeal:index` is the full array of card records, no images
- `rolodeal:img:<id>` holds `{ front, back }` as base64 thumbnails

Images are kept out of the index so the deck loads fast, and pulled in only
when you open a card. Roughly 300 cards before you should think about
pagination.

**Storage is per-device and per-browser.** There is no server-side database.
Clearing site data wipes the deck. `persistStorage()` in `main.jsx` asks the
browser not to evict it, which matters most on Safari.

---

## Installing it on your phone

- **iOS:** open in Safari, Share, Add to Home Screen. It launches full screen
  with no browser chrome. Chrome on iOS will not install it.
- **Android:** Chrome prompts to install, or use the menu, Add to Home screen.

---

## Known limits

- **NFC send is Android Chrome only.** Web NFC does not exist on iOS. The
  button hides itself when unsupported. On iPhone the share sheet is the real
  handoff path, and a `.vcf` attachment drops straight into Contacts on the
  other end.
- **`navigator.share` with files needs HTTPS.** Fine on Vercel, broken on
  `localhost` in some browsers.
- **Vercel request body cap is 4.5MB.** Two 1500px JPEGs come in around 1MB
  total, so there is plenty of room, but that is the ceiling if you ever raise
  capture resolution.

---

## Cost

One scan is roughly 3,800 input tokens and 250 output on Sonnet. Around a
penny a card with both sides. A 60-card conference weekend is under a dollar.
Watch actual spend in the Anthropic console, not in guesses. The route also
returns Anthropic's `usage` object, so you can log it if you want per-scan
numbers.

---

## Backup, when you get around to it

Everything is on the device today. Two options later:

1. **Export button.** Serialize the index to a single `.vcf` or JSON file and
   share it. Small change, no infrastructure, works this week.
2. **Sync.** Postgres or Supabase behind the same serverless pattern. Real
   multi-device support, real ongoing maintenance.

Start with the export. It covers the failure you actually fear, which is
losing the deck, without signing you up for a backend to babysit.
