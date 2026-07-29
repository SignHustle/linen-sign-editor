# Sign Hustle Co — Editor Website Launch Process

**Customer journey, pricing strategy and build requirements for the in-built template editor**

Prepared July 2026. Working document.

---

## The one-line version

Let them design before they decide anything. Take the email when they want their
design saved, not when they want to pay. Sell the suite by showing it only after
they have fallen for one piece. Credit every digital download against a future
print order so downloading is never a lost print sale.

---

## 1. What the market is actually doing

Worth knowing what you are up against, because the gap is bigger than it looks.

| Brand | Edit before login? | Digital download? | Real suite discount? | Specs before or after design? |
|---|---|---|---|---|
| Minted (US) | Customiser open, wall unclear | No | **No.** 2,237 "suite" items, all priced per piece | After, live price |
| Zola (US) | Customiser open | **No.** Explicitly none | No | After, live price |
| Papier (UK/AU) | Yes, "Personalise & add to basket" | No | No | After, live price |
| Paperlust (AU) | Yes, then human proof | No | No | **Before.** Print method first, which sets the minimum order |
| Vistaprint (AU) | Yes to design, account to **save** | No | No | Before |
| Basic Invite (US) | Yes | Yes but **deliberately not editable** | Not visible | After |
| Canva | Account to open editor | Yes, free | n/a | Print is a separate upsell |
| Etsy + Corjl/Templett | **No. Buy first, edit after** | Yes | No | n/a |

Three things fall out of that table.

**Nobody in the premium tier discounts a suite.** Minted, Zola and Papier all sell
"matching suites" as a coordination promise at per-piece prices. Their discounting
happens through sitewide promo codes, a US$35/yr membership, or email-gated new
customer codes. There is no "buy the suite, save 15%" price anywhere in the premium
tier. Your instinct that a low enough suite price flips people from one piece to the
whole set is correct, and it is genuinely unoccupied ground.

**The digital and print split is unserved.** The premium brands are print only.
Basic Invite offers downloads but cripples them so they cannot be customised. Canva
gives the file away and upsells print. Etsy sellers own instant-download-with-editing
and do it through a documented mess: buy on Etsy, wait for an email, create a second
account on Corjl or Templett, then edit. Corjl's own help centre has articles for
"I never received the email", Apple Pay Hide My Email breaking the order match, and
Safari not working properly. Templett is desktop only and has help articles for
"I've exceeded my download limit". Two account creations and an email round trip
before a bride can type her own name into a design.

**You can be the only one who does all of it.** Free unauthenticated editing, one
account, instant digital file **and** print from the same edited design, with a real
suite discount. That combination does not exist right now.

---

## 2. The structural problem with the current build

The editor at `linen-sign-editor` currently expects a Shopify `variant` ID in the URL.
Press Add to Cart without one and it says *"Missing variant, please return to the
product page and click Customise Your Sign."* It posts the design up to the Shopify
parent frame.

That is **specs first, design second**. The customer picks a product, a size and a
material on a Shopify product page, and only then gets to see their own names on it.

The journey you described is the opposite: see a design, edit it immediately, choose
the specifications once they are already attached to it. Those two models cannot both
be true, and the current one is the wrong way round for ad traffic.

This is the single biggest change to make before launch. Everything below assumes
you flip it.

---

## 3. The journey

### Entry: one design, one URL

Every design gets its own URL that opens the editor directly.

```
signhustle.com.au/design/sw12
```

An ad, a Pin, a Reel link in bio, a Google result all land on the design itself,
already loaded, with a sensible default specification pre-selected (most popular
size, most popular card). Not on a product page. Not on a collection grid.

The default matters. Never open with an empty dropdown. Pre-select and let them
change it. An unmade choice is friction, a made choice they can change is a preview.

### Step 01: Edit, with nothing in the way

No account. No email. No modal. No "sign up to continue".

They type their names, their date, their venue. This is where the sale is actually
made, and the mechanism is ownership, not persuasion. The moment a bride sees
"Ruby & Tom, 14 March 2027" in Mozart on a Swan Lake layout, it stops being your
design and starts being her invitation. Everything after that point is her defending
something she already owns.

Autosave to browser storage from the first keystroke, silently, no prompt. If she
closes the tab and comes back, it is still there. This costs you nothing and removes
the most common reason a saved-design feature gets used at all.

### Step 02: Specify, with the price moving as she goes

A panel that is always visible, showing a running total. Not a step she clicks into.

The options split into three kinds, and they behave differently:

**Options that change the design.** Size and aspect ratio, double sided, add an
envelope, add a liner. These must reflow the canvas so she sees the change, not just
a number. Adding an envelope adds a page to her design that she can edit. Turning on
double sided gives her a back she can put a map or a poem on. Sold as design
opportunities, not as line items.

**Options that only change the price.** Card stock, envelope colour, quantity. Show a
swatch, show the price difference, do not touch the canvas.

**Options that change what is in the set.** Add an RSVP card, a details card, a
wishing well card. Adds a page, adds price, and critically **inherits the names, date
and venue she already typed.** She should never enter her details twice.

Two hard rules for this panel:

1. **A spec change must never destroy her work.** Changing from A5 to 120x180 has to
   re-fit her text, not reset the template. This is a real build risk because your
   templates carry `availableSizes` per design. Plan the re-fit logic properly or
   people will lose their work and leave.
2. **Show the total and the per-piece price at the same time, including a shipping
   estimate.** Unexpected extra costs at checkout is the single largest cause of
   cart abandonment in the Baymard data at 39%, well ahead of anything to do with
   accounts. Nothing should appear at checkout that was not visible in this panel.

### Step 03: The suite moment

This is the highest leverage screen on the site and its placement is the whole game.

Do not show the suite up front. A bride arriving from an ad does not yet want a suite,
she wants to see if that design suits her wedding. Ask her to buy a set before she
has fallen for a single piece and it reads as a price, not a saving.

Show it **after she has finished editing one piece and seen the price of it.** At that
moment she has an anchor, she has ownership, and she can see the maths.

The screen shows her actual design, with her actual names, applied across the whole
suite. Not stock previews. Her invitation, her RSVP, her details card, her envelope,
her place cards. Built automatically from the details she already typed.

> Your details are already on all of them.
> The full suite, **$X**. Buying the invitation alone, $Y.

One button applies it. One button declines it and continues with the single piece.
Never make declining hard.

### Step 04: The fork, and why it is not really a fork

One screen, two paths, both from the same edited design.

**Download it now.** Instant, print it yourself or take it to a printer.
**We print it.** Linen, card, envelopes, delivered.

The mechanic that makes this work: **the digital unlock is credited against a print
order.** She pays for the download today, and if she orders printing within twelve
months the download price comes off it.

This is the most important pricing decision in the document, because it removes the
either/or entirely. She is not choosing download *instead of* print, she is choosing
download *now* and print *maybe*. A download stops being a lost print sale and starts
being a deposit on one. It also gives you a legitimate, non-pushy reason to email her
again: *"Your $29 credit is still sitting there."*

### Step 05: The account, at the right moment

Your original plan was an account at checkout. That is the worst of the three possible
placements, for three reasons.

- At checkout the account is pure tax. She has already decided to buy. You are adding
  a documented 18 to 19% abandonment risk (Baymard 2025) at the single most valuable
  moment, in exchange for nothing she can perceive as a benefit.
- The benefit of an account, "save your design", is obvious *before* checkout and
  invisible *at* it. Put the ask where the benefit is.
- The people you most want to capture are the ones who do not buy. A checkout gate
  never sees them.

**Recommended instead: soft email capture at the save moment, guest checkout always.**

Ask for the email at three natural points, and nowhere else:

1. She clicks "Save my design"
2. Exit intent, or ninety seconds idle after she has made real edits
3. She clicks Download or Add to Cart

Ask for **email only.** Magic link, no password. Frame it as sending, not signing up:

> **Send this design to your inbox**
> Come back to it any time. Send it to your fiancé, or your mum.

Same data, completely different perceived cost. It also turns the saved design into a
shareable link, which means her partner, her mother and her bridesmaids see your work
without you paying for the impression. That link is free distribution and should be
built as a first-class feature, not an afterthought.

At checkout, guest checkout is the visually dominant option, not a small link under a
login box. Baymard found 62% of sites get this specific thing wrong. Offer the account
*after* the purchase, prefilled, one click, framed as "keep your designs".

### Step 06: The wedding profile, and why she comes back

Here is the part that compounds.

She has already typed her names, her wedding date and her venue into a design. Harvest
those fields. Never ask for them separately.

Now every subsequent design she opens is pre-filled. And more importantly, you know
her wedding date, which tells you exactly when she needs on-the-day pieces.

The two entry stages behave completely differently and should be treated as two
different businesses that share a customer:

| | **Invitation stage** | **On-the-day stage** |
|---|---|---|
| When | 9 to 12 months out | 2 to 8 weeks out |
| Mood | Exploring, comparing, unhurried | Deciding fast, list-driven, stressed |
| Basket | Invitation, RSVP, details, envelope | Signs, menus, place cards, table numbers |
| What wins | Beauty, samples, reassurance | Speed, "it matches", one delivery date |
| Follow up | Nurture over months | Urgent, dated, practical |

The invitation buyer is your most valuable customer not because of that order but
because her wedding date is a scheduled second sale. A dated email at eight weeks out,
with her own design already applied to a welcome sign and a menu, converting in two
clicks because nothing needs re-entering, is the highest margin marketing you will
ever run.

The on-the-day buyer arriving cold is a different job. She wants to know it will
arrive in time. Lead with the delivery date, not the design.

---

## 4. Pricing strategy

**Numbers here are ratios and structures, not prices.** Real figures come from
`SignHustleCo_Pricing_Master_v4_9.xlsx`.

### The three-tier ladder

Present exactly three options at the fork, in this order:

1. **Single piece, digital** — the entry price, deliberately low enough to feel like
   nothing. This is the anchor everything else is judged against.
2. **Full suite, digital** — priced at roughly **2.2 to 2.5 times a single piece**
   when the suite contains five or more pieces. It has to read as "three pieces free".
   Always show the per-piece equivalent next to it.
3. **Printed** — per unit, with a quantity ladder, and the digital unlock credited.

The middle option is the one you want chosen, and the single-piece price exists mainly
to make it look obvious. Do not price the suite at a modest saving. A 15% suite
discount reads as a discount. A "three pieces free" suite reads as a different
decision.

### Why the digital price should be low

Your margin is in print, linen and hardcovers. The digital file is the acquisition
mechanism, and it does three jobs a paid ad cannot:

- It converts a browser into a customer, which is the hardest transition in the funnel
- It captures the wedding date, which schedules the second sale
- It is credited back, so it functions as a deposit on print

Price it as a customer acquisition cost you get paid for, not as a product line.

### Free, but watermarked

Before the paywall, offer a free watermarked preview in exchange for the email. Low
resolution, visible mark, cannot be printed. Templett already proves this model works.

This is the bribe for the email, and it is also the artefact she sends to her partner.
Make sure the watermark is tasteful and the design still looks beautiful, because that
image is doing your marketing.

### Charge for the sample, then credit it

Zola, Shutterfly and Basic Invite give free samples. Paperlust, in Australia, charges
A$5 to A$15. Follow Paperlust.

Sell a printed sample **of her own edited design**, credited against her order. A paid
sample is a far stronger buying signal than a free one, it filters out browsers, and
for linen it is close to essential because texture is the whole product. Your own
audience insight says brides respond to the physical object over the interface.

### Quantity ladder

Per-piece cost should visibly fall as quantity rises, and the panel should show the
next break: *"Add 10 more and each one drops to $X."* Paperlust's own published
research puts the real drop from 25 to 100 cards at 30 to 50%. Make it visible rather
than silent.

### Set a minimum order for print

Every serious player has one. Papier is 10 and rising in tens. Vistaprint AU is 10.
Paperlust varies by method, up to 50 for foil stamping. Pick yours per product and
show it in the panel from the start, never at checkout.

---

## 5. Friction audit

Ranked by what it costs you.

| # | Friction | Severity | Fix |
|---|---|---|---|
| 1 | Specs required before the design can be personalised | **Critical** | Design-first URLs, defaults pre-selected |
| 2 | Any price that appears only at checkout | **Critical** | Live total plus shipping estimate in the spec panel |
| 3 | Account required to buy | **High** | Guest checkout dominant, account offered after |
| 4 | Work lost when a spec changes | **High** | Re-fit on size change, never reset |
| 5 | Suite offered before she likes one piece | **High** | Move it after the first price is seen |
| 6 | Re-entering names on each piece | **High** | Wedding profile, inherit across the suite |
| 7 | Editor unusable on phone | **High** | Most ad traffic is mobile. Templett's biggest complaint is desktop-only |
| 8 | Slow first load of the editor | Medium | Preload the template in the ad link, lazy load fonts |
| 9 | Uncertainty about print colour and texture | Medium | Paid sample credited back, plus a proof step |
| 10 | No delivery date shown before checkout | Medium | Date in the spec panel, critical for on-the-day buyers |
| 11 | Email in spam after a magic link | Low but real | This is Corjl's most documented failure. Also show the link on screen |

---

## 6. Build and hosting

### Recommendation: standalone editor site, Shopify keeps checkout

You asked me to recommend one. This is it.

**Keep on Shopify:** checkout, payments, Shop Pay, AU GST, shipping rates, order
management, abandoned cart, existing product catalogue.

**Move into your own app:** browsing, the editor, saved designs, the spec panel,
the suite builder, the wedding profile, digital delivery.

The reasoning is that the checkout is the one thing with the least upside in
rebuilding and the most risk. Everything before the checkout is where your differentiation
lives and where Shopify's page structure actively fights you. You cannot do
`/design/sw12` cleanly inside a Shopify product template, and you cannot do the
download-credit mechanic through Shopify's digital downloads app.

Full standalone with your own Stripe is tempting and I would not do it yet. It adds
GST handling, invoicing, fraud, abandoned cart recovery and loses Shop Pay, in exchange
for control you do not currently need.

### Stack

You are already on Cloudflare Pages. Stay there.

| Piece | Use |
|---|---|
| Cloudflare Pages | The editor app, as now |
| Cloudflare Workers | API, magic links, cart handoff, signed download URLs |
| D1 | Designs, wedding profiles, download credits |
| R2 | Preview images and print-ready PDFs |
| Shopify | Checkout only, via cart permalink or Cart Ajax API |

Hand off to Shopify with line item properties carrying the design ID, the spec summary
and a link to the rendered proof, so the order in Shopify admin is readable and the
design is recoverable.

Deliver digital files through your own Worker with a signed, expiring URL. Not through
Shopify's digital downloads. That is what lets you track and credit the unlock.

### The hard part

**Print-ready PDF generation is the highest technical risk in this project.** The file
you send to print has to match the canvas exactly, at real size, with bleed and correct
colour, using the same font files including the swash alternates your builder applies.

Do not trust a browser-side export. Render server side, from the same template JSON,
with the same fonts. Budget properly for this and build a proof step where she approves
a rendered preview before it goes to print. Paperlust does a human proof with two free
revision rounds and that is not an accident.

### Phasing

**Phase 0, launch.** Design-first URLs. Free editing. Live spec panel with real prices.
Watermarked free preview for the email. Paid digital unlock with credit. Suite offer
after the first piece. Print via Shopify. Guest checkout.

**Phase 1, weeks after.** Magic-link accounts. Saved designs and shareable links. The
wedding profile and pre-fill. The dated on-the-day return email.

**Phase 2.** Paid samples credited back. Proof approval step. Trade portal using the
same editor with trade pricing.

Do not build accounts before launch. Browser autosave plus emailed design links covers
almost all of the benefit at a fraction of the work, and it lets you launch.

---

## 6b. Saved designs, watermark staging, and the process bar
*(added 29 Jul after Kate's review of the flow demo)*

**Saved designs are server-side, not browser-side.** The email gate in the demo
stores nothing; the real build persists every design as JSON in a small
Worker + KV/D1 store on the existing Cloudflare stack.

- Autosave silently under an anonymous design id from the first edit.
- The email gate attaches her email to that id; the magic link is just
  `/design/<id>`. No password, no account form — unchanged.
- She can return and edit any time. We get an admin view of every saved
  design; when a print order lands, the same record is the artwork source.
- The saved design id is what the follow-up email sequence hangs off
  (abandoned design, eight-weeks-out on-the-day suite).

**Watermark staging — the watermark gates the FILE, not the print path.**
Decided against requiring a template purchase before printing.

1. Designing is free. The canvas and all previews carry a visible watermark.
2. Fork, unchanged: **buy the digital download** — watermark comes off, files
   delivered, price credited against printing for 12 months — or **order
   printing directly** with no separate template fee. We print from the master
   files, so the customer never needs the unwatermarked file for print.
3. Rationale: forcing the template purchase first double-charges print
   customers (or, if fully credited, adds a checkout for nothing), and no
   premium competitor charges separately for the design on a print order.
   The credit mechanic already makes every download a printing deposit.

**The process bar stays in production.** The demo's bottom bar becomes a
customer-facing progress bar: Design → Options → Suite → Download or Print →
Order, with the watermark/"free until you buy" note visible during Design.


1. The three prices: single digital, suite digital, print per unit. Pull them from the
   pricing master and check the suite lands near 2.2 to 2.5x.
2. Which pieces constitute a suite, per collection. It needs to be the same set every
   time so the price is comparable.
3. The credit window. Twelve months is the suggestion, it matches wedding lead times.
4. Minimum order quantity per print product.
5. Whether the sample is A$5 or A$15, and whether it is credited fully or partially.
6. Who builds the server-side PDF renderer, because that is the long pole.
7. Saved-design store (Worker + KV/D1): confirm schema and retention. Small
   build, big unlock — it powers return-to-edit, the admin view, print
   artwork records and the email sequence (see 6b).

---

## Sources

- [Baymard, Current State of Checkout UX 2025](https://baymard.com/blog/current-state-of-checkout-ux)
- [Baymard, Reduce Cart Abandonment](https://baymard.com/learn/reduce-cart-abandonment)
- [Minted wedding invitation cost guide](https://www.minted.com/wedding-ideas/wedding-invitations-cost)
- [Minted wedding invitation suites](https://www.minted.com/wedding-invitation-suites)
- [Zola, do you offer digital invitations](https://www.zola.com/faq/do-you-offer-digital-invitations)
- [Papier minimum order quantities](https://papier.zendesk.com/hc/en-us/articles/360000759825)
- [Papier samples](https://www.papier.com/wedding/samples/)
- [Paperlust wedding invitations](https://paperlust.co/browse/wedding-invitations/)
- [Paperlust, cost to print wedding invitations](https://paperlust.co/blog/cost-to-print-wedding-invitations/)
- [Vistaprint AU wedding invitations](https://www.vistaprint.com.au/stationery/wedding-invitations)
- [Basic Invite printables](https://www.basicinvite.com/help/printables/how-it-works)
- [Corjl, how customers access purchased items](https://help.corjl.com/article/60-how-do-customers-access-their-items-to-personalize-after-purchasing)
- [Corjl, missing access email](https://help.corjl.com/article/505-i-never-received-the-email-from-corjl-to-access-my-order-what-do-i-do)
- [Templett demo templates](https://help.templett.com/hc/en-us/articles/360020959872)
- [Etsy guest checkout limitations](https://help.etsy.com/hc/en-us/articles/115015663607)
