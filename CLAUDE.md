# CLAUDE.md

See README.md for what this does and how a run works.

## Rules

- **No cloud AI or paid services.** On-device only: Apple Vision and Foundation Models in
  `extractor/`. The whole point is zero cost in exchange for manual runs.
- **Instagram uses the personal account**, never the Oak City Pie Company business account.
- **Don't probe or script Instagram outside `npm run fetch`/`login`**, and don't work around
  rate limits or challenges. Keep sessions around 50 accounts with the existing pauses.
- **Never commit or share** `followers_*.json`, `following.json`, `data/` or `.env`. They hold other
  people's handles, the browser login and API keys. Never print `LEADS_API_KEY`.
- Run `npm run fetch` in the background only once at a time; the lock file enforces it.

## Code

- Node 24 runs `.ts` directly (type stripping): no build step, no TypeScript-only syntax such as
  enums or parameter properties. Uses `node:sqlite`, `node:test` and `parseArgs`.
- The only dependency is `playwright`. Don't add others for small things.
- `extractor/` is a Swift 6.2 package (macOS 26). Rebuild after changes with
  `cd extractor && swift build -c release`, then run `extract --selftest`. Global regexes aren't
  Sendable in Swift 6, so they're wrapped in functions.
- The model copies dates "as written" and Swift resolves them (`Dates.swift`). Keep date logic in
  code, not in the prompt.
- Lead grouping and filters (`src/group.ts`) are heuristics tuned on real posts. When changing them,
  add a test in `test/group.test.ts` and compare `npm run leads` before and after.
- `send.ts`'s payload must match `leadInputSchema` in the roundup repo
  (`../carolina-market-roundup/src/shared/schemas.ts`). Change both together.
- Tests: `npm test` (and `--selftest` for the extractor).

## Environments

`.env` sets `ROUNDUP_URL` and `LEADS_API_KEY`. It currently points at production
(`https://www.carolinamarketroundup.com`), with staging and local values kept as comments. Staging
and production have different keys (Cloudflare secrets in the roundup's Workers).
