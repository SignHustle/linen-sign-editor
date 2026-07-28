# Handoff: Editor launch customer flow (2026-07-28, seq 1)

## Goal
Design and prove the customer journey for the new website where the template editor is built in:
see a design, edit it instantly, then choose download or print. Strategy is written and a working
demo runs against the real editor. Next job is turning Phase 0 into real code.

## Current state
- Strategy doc written: `docs/editor-launch-process.md`. Journey, buyer psychology, pricing, ranked
  friction audit, build and hosting recommendation, three phase plan. Read it before building anything.
- Deep linking added to the editor: `?template=sw12` opens that design straight into the editor, no
  gallery. Backwards compatible with the existing `type` / `size` / `collection` / `variant` params.
- `getUrlParams` also now reads `group`. It was referenced at the gallery stage but never parsed, so
  `urlParams.group` was always undefined. Latent bug, fixed in passing.
- New `loading` stage renders while a deep link resolves, so the browse grid does not flash.
- Working demo at `public/demo/index.html`, served at `/demo/`. Wraps the real editor in an iframe on
  the same origin. Mock ad, live spec panel, suite moment, download/print fork, email gate, cart summary.
- Demo is verified end to end headlessly: deep link loads sw12, size switch swaps to sw20, envelope
  toggle previews sw32, prices update live, and the editor's real `linenSignAddToCart` postMessage is
  caught by the demo and shown on the final screen.
- Prices in the demo are placeholders. All of them live in one `PRICING` object at the top of
  `public/demo/index.html`. Single edit to swap.
- **Nothing is committed.** Branch `flow-demo` exists, all changes sit in the working tree.
- **`src/App.jsx` has ~3,500 uncommitted lines predating this session** (Swan Lake splice, font
  alternates, mozart-light, multi-page, glyph picker). Not backed up anywhere. Commit it.
- Backup of the pre-deeplink file at `src/App.jsx.backup-before-deeplink`. Delete once happy.
- Nothing deployed. `linen-sign-editor.pages.dev` is untouched.

## What we tried
- **Benchmarked the market first.** Minted, Zola, Papier, Paperlust, Vistaprint, Basic Invite, Canva,
  Corjl, Templett. Kept. Two findings drove the whole design: nobody in the premium tier discounts a
  suite, and the Etsy/Corjl model forces two account creations plus an email round trip before a bride
  can type her own name. Sources are listed at the bottom of the strategy doc.
- **Checked whether the editor could deep link as-is.** It could not. Only `type` / `size` /
  `collection` / `variant`, all of which land on a filtered gallery. Led to the `?template=` patch.
- **Tried to iframe the live pages.dev deploy** so the demo needed no local server. Abandoned:
  403 from the sandbox, could not verify. Serving the demo from `public/` inside the editor itself is
  better anyway. Same origin, no CORS, no X-Frame-Options, ships with the app on deploy.
- **Tried building on the device VM to compile-check.** Failed. `node_modules` holds macOS arm64
  binaries and the VM is Linux, so the rolldown native binding will not load. Also no esbuild in
  Vite 8, so the old `npx esbuild` compile check from the template-builder skill no longer applies.
  Worked around by staging `App.jsx` plus a minimal asset set into a Linux sandbox and building there.
  Verification was real, not assumed.
- **First suite screen compared totals.** $463.75 for the invitation against $700.47 for the suite.
  Killed the offer, the suite just read as more expensive. Rebuilt to lead with per guest ($4.64 vs
  $7.00 for five pieces), buy-separately price struck through, saving called out. Kept.
- **Suite thumbnails from border SVGs.** Half the pieces have no border file. Added a fallback chain:
  border SVG, then raster art, then a styled ghost card.
- **Looked for `SignHustleCo_Pricing_Master_v4_9.xlsx`.** Not in `signhustle-marketing`, not in the
  editor repo. Never found. Placeholders used instead.

## Key decisions
- **Design first, not specs first.** The editor currently needs a Shopify `variant` in the URL, which
  forces a product page before personalisation. That is backwards for ad traffic. Flip it. This is the
  single biggest pre-launch change.
- **Login moves off checkout.** Kate's original plan was an account at checkout. Rejected. At checkout
  the account is pure tax on someone who has already decided to buy, and it never sees the people who
  do not buy. Chosen instead: silent browser autosave, then an email-only magic link asked at save,
  exit intent, or download. Guest checkout stays visually dominant.
- **Digital download is credited against printing for twelve months.** Removes the either/or. A
  download becomes a deposit on a print order, not a lost sale, and earns a follow-up email that does
  not feel like selling. This is the strongest single mechanic in the plan.
- **Suite priced so it reads as "three pieces free", not as a percentage off.** Around 2.2 to 2.5x a
  single piece for digital. For print, compare per guest, never total against total.
- **Standalone editor app, Shopify keeps checkout.** Rejected fully-in-Shopify (cannot do design-first
  URLs or the download credit) and rejected full standalone with own Stripe (adds GST, invoicing,
  fraud, abandoned cart, loses Shop Pay for control not currently needed).
- **Suite offer sits after the first piece is priced, never before.** Before ownership it reads as a
  price. After it reads as a saving.
- **Did not commit anything.** Kate's ~3,500 lines of unrelated WIP share the same file, and folding
  them into a commit under an invented message would misrepresent them.

## Files touched this session
- `src/App.jsx` — branch `flow-demo`. Four small additions: `template` and `group` in `getUrlParams`,
  `loading` in the initial stage, a mount effect that opens the deep-linked template, and a `loading`
  stage render. Everything else in the diff is Kate's pre-existing WIP.
- `public/demo/index.html` — new. The whole demo, self-contained, placeholder `PRICING` at the top.
- `docs/editor-launch-process.md` — new. The strategy document.
- `src/App.jsx.backup-before-deeplink` — safety copy, delete when happy.

## Skills / context to load next session
- `sign-hustle-template-builder` — editor architecture, template pipeline, override workflow, QA method.
  Note two corrections: Vite 8 has no esbuild so the `npx esbuild` compile check is dead, and the
  mounted `node_modules` is macOS-only so builds must run on Kate's machine or in a fresh sandbox.
- `sign-hustle-cmo` — for any pricing, positioning or copy decision in the flow.

## Promote to a skill/CLAUDE.md
- The Swan Lake suite map belongs in the template-builder skill. Each *size* is a separate template,
  not a re-fit, so a size selector swaps template ids: invitation Option 1 is `sw12` (A5), `sw16`
  (5x7in), `sw20` (square). Backs, details, RSVP, envelope and liner follow the same pattern. The full
  map is in the `DESIGNS` object in `public/demo/index.html`.
- Compile check for Vite 8: `npm run build`, not `npx esbuild`.
- Mounted `node_modules` cannot be executed from a Linux session. Stage and build elsewhere.

## Next steps
1. Commit the WIP in `src/App.jsx` on `flow-demo`. It is not backed up. Do this first.
2. Review the deep link diff, then merge to main and deploy so `/design/<id>` links work in ads.
3. Wire real prices into the `PRICING` object once the pricing master is found.
4. Decide the five pieces that make a suite, per collection, so the price is comparable every time.
5. Fix friction #4: a size change must re-fit text onto the new template, not reload and lose it.
   Currently the demo warns about this instead of solving it.
6. Scope the server-side print-ready PDF renderer. Highest technical risk in the whole project. Same
   fonts including swash alternates, real size, bleed, correct colour. Do not trust a browser export.
7. Build Phase 0 properly: design-first routes, live spec panel, watermarked free preview, paid digital
   unlock with credit, suite offer after the first price, print via Shopify, guest checkout.

## Quick start
```bash
cd ~/linen-sign-editor
rm -f .git/index.lock .git/index.lock.stale-safe-to-delete   # stale lock, blocks all git writes
git branch --show-current                                    # expect flow-demo
git status --short
npm run dev
```
Then open http://localhost:5173/demo/ for the flow demo, or
http://localhost:5173/?template=sw12 for the deep link on its own.
