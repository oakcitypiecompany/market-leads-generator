# market-leads-generator

Finds markets, fairs and pop-ups in the public Instagram posts of the accounts Oak City Pie Company
follows or is followed by, then sends them to the **Moderation → Leads** tab of
[Carolina Market Roundup](https://www.carolinamarketroundup.com).

Everything runs on your Mac, by hand, at no cost: no cloud AI and no paid APIs. Reading posts uses
Apple's on-device Vision (OCR) and Foundation Models frameworks.

## Requirements

- A Mac with Apple Intelligence on macOS 26 or later (built and tested on an M4)
- Node 24 or later (runs the `.ts` files directly)
- Swift 6.2 (Xcode 26 command line tools)
- Google Chrome
- Your Instagram followers/following export (`followers_*.json`, `following.json`) in the repo root.
  These hold other people's handles and are gitignored, so never commit them.

## Setup

```bash
npm install
cd extractor && swift build -c release && cd ..
cp .env.example .env        # then set ROUNDUP_URL and LEADS_API_KEY
npm run login               # log in to your *personal* Instagram in the window that opens, then close it
```

`LEADS_API_KEY` must match the roundup's `LEADS_API_KEY`: `.dev.vars` locally, a Cloudflare
secret on staging and production. Each environment has its own key.

## A run

```bash
npm run fetch -- --max 50   # visit up to 50 accounts and save new posts and images (about 20 minutes)
npm run extract             # OCR and read each post on-device
npm run enrich              # look up each lead's website and fill in missing details
npm run leads               # optional: print the leads
npm run send                # post upcoming leads to the roundup (--dry-run to preview)
```

| Step | Options |
|---|---|
| `fetch` | `--handle name` (one account, whatever its status), `--days 60` (look-back for new accounts), `--max N`, `--headless`, `--debug` (save captured JSON to `data/debug/`) |
| `extract` | `--retry` also reruns posts that errored |
| `enrich` | `--all` includes past leads, `--redo` searches again |
| `leads` | `--all` includes past leads |
| `send` | `--dry-run` |

Keep fetches to about 50 accounts per session and space sessions a few hours apart. If Instagram
asks for a login, shows a challenge or rate-limits, the run stops and saves its progress. Run
`npm run login` if needed and fetch again later. Only one fetch can run at a time
(`data/fetch.lock`).

## How it works

1. **Fetch** (`src/fetch.ts`). Playwright opens a dedicated Chrome profile (`data/browser-profile`),
   visits each `watched` account's profile and reads the posts from the JSON the page loads. It keeps
   posts from the last 60 days, or posts since the account's last check. Images download through the
   page itself.
   - Accounts found to be **private**, **personal** (not a business or creator account) or
     **missing** are marked and never visited again. Use `--handle` to recheck one.
   - An account that errors stays `watched` and is retried next run.
2. **Extract** (`src/extract.ts` → `extractor/`). A Swift tool OCRs the images with Vision, and a
   quick pre-filter skips posts with no event-like words. The on-device model then returns each
   event in the post: name, organizer, venue, address, city, dates, times and links.
   - The model only copies dates as written. Swift code turns them into real dates relative to the
     post date ("this Saturday", "Dec 7th", a bare "14" in a schedule graphic).
   - Sampling is greedy, so the same post always gives the same answer.
3. **Group** (`src/group.ts`). Mentions from many posts and accounts are merged into leads. Two
   mentions merge when they have a similar name in a compatible place, or the same date at the same
   street address. A poster's own business isn't counted as a market.
   - Dropped: out-of-area leads (another state), and names that don't look like a market unless 2+
     accounts mention them.
4. **Enrich** (`src/enrich.ts`). Searches DuckDuckGo in a visible Chrome window
   (`data/search-profile`) and checks the top results. A page counts as the market's own when it
   names the market and its place. The page is read by the same extractor.
   - Posts win. The website only fills empty fields, times and future dates.
   - A website that shows another state drops the lead.
5. **Send** (`src/send.ts`). POSTs upcoming leads to `/api/leads` in batches of 25.
   - The roundup updates a lead with the same key and never changes a status a moderator set.
   - A lead whose name or city changes gets a new key and appears again.

All state is in `data/leads.db` (SQLite) and `data/images/`. Both are gitignored.

## Tests

```bash
npm test                                          # Node tests
extractor/.build/release/extract --selftest       # date, time and pre-filter checks
```

## Later

- Switch fetching to the Meta API (Business Discovery) once developer signup works. Only the
  collection step in `fetch.ts` changes; `Post` stays the same.
- Blocklist accounts that never post about markets after several runs.
