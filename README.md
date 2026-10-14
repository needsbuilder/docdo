# DocDo

**English** · [한국어](README.ko.md)

**A document agent for older adults: they photograph a paper letter or bill, hear what it is in plain words, and their adult child gets a card showing how it compares with official records, so the child can decide what to do next.**

The name carries two things: **Dokdo**, the Korean island, and **doc do**, a document that acts.

- **Live demo:** https://docdo.vercel.app
- **[Upstage] Track Winner**, JunctionX Korea 2026 (Upstage Studio track), team 정션없음
- **Credits:** concept, all code and the pitch by [Yongbeom Gwon](https://github.com/needsbuilder). The logo, mascot, line icons and visual style come from the team designer (see [Assets and license](#assets-and-license)).

---

## The problem

For an older adult with limited literacy, a letter is **not a reading problem but a judgment problem**: what arrived, is it real, and what am I supposed to do?
So DocDo gives the older adult **understanding, reassurance and danger warnings only**, and moves **every action to the child's screen**.

### What the older adult's screen does not have

No account numbers, no pay buttons, no payment links, no apply buttons.
The only number that can be tapped is **the issuer's official number from our registry**.
Numbers and links read from the document may be shown, but they **cannot be tapped**.

---

## How it works

```
photo → [Upstage Studio agent] → [our verification layer] → plain-language reading + child's card
```

### 1. Upstage Studio (document processing)

- **Nodes:** `Document Parse → Classify (pay / apply / info / ad) → two Information Extract branches`
  - one Extract branch for payment documents (9 fields), one for application documents (7 fields)
  - `ad` is **deliberately left unmapped**, so the Extract stage drops out of the response entirely.
- Called with `include: ["all"]`. With `["last"]`, the Extract fields, confidence and coordinates disappear.
- Stages are found by **matching `output[].model` with a regex**. Branching skips stages, so indexing the array by position is wrong.

> On the Studio canvas we saw six node types (Parse, Classify, Extract, Instruct, Validate, Merge).
> **This pipeline uses three of them: Parse, Classify and Extract.**

### 2. Verification layer (`lib/verify.ts`)

What the Studio output says the document claims is one question. Whether that matches **official information outside the document** is another, and that one is ours.
Every rule lives in code, not in a model.

| Rule | What it checks |
|---|---|
| **R1** issuer consistency | Issuer name, phone number and URL against `data/issuer_registry.json` |
| **R3** confidence gate | If a key field is `low`, missing or malformed, **the number is never read aloud** |
| **R4** personal mobile | A `010-…` personal mobile number as the contact on a public-agency bill is a hard warning |
| **R5** classification confidence | If the document type itself is uncertain, a person decides |
| **R6** account holder | A virtual account's holder must **exactly match** the issuer |
| **R7** suspected impersonation | Uses a public-agency or utility name, isn't a registered issuer, and either carries a private-company marker or closely resembles a registered issuer's name: raised as orange (child review), not red |

R2 (internal consistency) belongs to Studio's Validate node, which this pipeline does not use.

There are 8 verdicts: `clear` `review` `mismatch` `unknown_issuer` `not_checkable` `no_extract` `needs_human` `failed`

---

## How to read the result: what it does not say

- **`clear` means "no verified mismatch."** It does not mean the document is genuine. Never read it as "normal", "real" or "safe".
- **A fake letter that copies the official contact details word for word cannot be caught this way**, because every value we compare is genuine. That is a design limit, not a bug.
- **The registry is an 8-issuer pilot**: National Health Insurance Service, Ministry of Health and Welfare, National Pension Service, KEPCO, Pohang City, Busan District Court, Seoul Arisu (water), plus one synthetic demo entry for Busan water (`demo: true`, not official values).
  It does not cover all public agencies, and **private companies (telecoms, banks) are not checked.**
- **Sub-organization names that don't exactly match a registered issuer never get `clear`.**
  A real branch office and a fake "refund center" using the agency's name **cannot be told apart by structure alone**, so both go to the child. We accept false alarms to reduce misses.
- **We do not look up who actually owns an account.** We have no access to that, and the screen says "not checked".
- Processing time of **9.6–26.2 s** is the **observed range over the team's 12 fixtures** ([evidence](docs/evidence/2026-08-23-team-fixtures-12.md)), not a P95.

---

## After approval: the browser agent

When the child taps **[Approve payment]** on the card, the document is `queued`, and a separate worker process (`scripts/agent-worker.ts`) drives a real Chromium browser through the payment portal.

- **The brain is Solar Pro 4** (`scripts/agent-brain.ts`, function calling). It reads a list of the page's interactive elements (button, input and link text plus reference ids) and a 2,500-character excerpt of the page text, and picks **one action per step**: `click / type / press / scroll / wait_human / done / abort`. It never receives images; this is not pixel-based computer use.
- **Guardrails live in code:**
  - If password, certificate or identity-verification wording appears, the model is not called and control goes to the child (`waiting`). After the child continues, that check is skipped for one step so the page can move on.
  - It never types into a `password` field.
  - Pay, payment and transfer buttons are clicked only when the document's amount is visible on screen.
  - If the page leaves the allowed domains, the run stops.
  - It stops if the same screen repeats 3 times in a row, or after 25 steps.
  - `done` is rejected unless a pay click has happened.
- **The child's turn:** the worker streams 430×760 JPEG frames every 0.7 s to the child's card. The child **taps that live screen on their phone** (touch position and text are relayed) to finish authentication, then taps [Continue]. Relayed input is held only in a short queue on the document row until the worker consumes it, is never logged, and the queue is emptied when the run ends.
- **Documents that cannot be approved at all:** `mismatch`, a suspected-impersonation (R7) result, or an e-payment number or amount that is not Extract `high` (the button doesn't appear, and one line says why).
- **Target portal:** Korea's real bill-payment portal (giro.or.kr) puts even a lookup behind a financial certificate, even for guests. So payments run on a **demo portal `/demo/giro`** with the same flow (permanently labelled "demo, not a real payment"; ledger in `lib/demoBills.ts`). The [real portal] mode shows the agent stopping at giro.or.kr's certificate wall and handing over to the child. Connecting a real institution means swapping the ledger for that institution's API, not changing the agent.

```bash
# Worker (needs the same AGENT_SECRET and UPSTAGE_API_KEY as the server)
DOCDO_URL=https://docdo.vercel.app npm run agent          # headless
DOCDO_URL=https://docdo.vercel.app npm run agent:demo     # visible browser
AGENT_MODE=script …                                       # fixed-procedure fallback (no model)
AGENT_MODE=script AGENT_ADAPTER=giro …                    # fixed procedure on the real portal; in the default mode the child picks [real portal] at approval
```

During the event the worker ran on Railway (`Dockerfile.agent`, official Playwright image). **The hosted worker is currently offline**; start it with the commands above to run the after-approval flow. The worker reads `.env` (not `.env.local`) or exported variables.

---

## Run it

```bash
git clone https://github.com/needsbuilder/docdo.git
cd docdo
npm install
cp .env.example .env.local   # fill in the values
npm run dev                  # http://localhost:3000
```

### Environment variables

| Name | Required | Notes |
|---|---|---|
| `UPSTAGE_API_KEY` | yes | **Server only.** Never prefix with `NEXT_PUBLIC_` |
| `UPSTAGE_AGENT_ID` | yes | Your Upstage Studio agent id. Extract schemas to recreate it: `studio/extract-schema-*.json` |
| `SUPABASE_URL` | no | Without it, storage falls back to `.data/` files (local development only) |
| `SUPABASE_ANON_KEY` | no | Same as above |
| `AUTH_SECRET` | yes | Signing key for the child's session (random, 16+ chars). Without it the child's screens won't open |
| `ELEVENLABS_API_KEY` | no | Voice for the older adult. Falls back to the device's built-in TTS. **Server only** |
| `AGENT_SECRET` | agent | Shared secret the worker uses to prove itself to the server. Same value on both |
| `VAPID_PUBLIC_KEY` `VAPID_PRIVATE_KEY` `VAPID_SUBJECT` | no | Web push for the child. `npx web-push generate-vapid-keys` |

The whole flow runs locally without Supabase; a deployment needs it. Schema: `supabase/schema.sql`.

### Tests

```bash
npm test    # 296 tests
```

`tests/verify.test.ts` covers 19 kinds of adversarial and missing-field input.
`tests/hardening.test.ts` pins bypasses that code review **actually reproduced by running them**: account-holder substring, concatenated phone numbers, fake branch names, ReDoS, and a fail-open in the classification contract.

These are regression tests, not an accuracy benchmark.
DocDo needs a real photographed letter to run; there is no replay mode with saved results.

---

## Scope and operating assumptions

- **Supported:** iPhone Safari and desktop web. **Android has not been tested.**
- **iOS voice:** with the silent switch on, there is no sound. That is hardware and can't be fixed in code. The first utterance unlocks audio inside a user gesture (`lib/speak.ts`).
- **The child signs up with email and password.** Sign-up creates one household and an **invite link for the older adult**. Passwords are scrypt-hashed; sessions are HMAC-signed HttpOnly cookies. No email verification or password reset (demo scope).
- **The older adult has no account.** Opening the child's link (`/elder?h=token`) once stores the token on the phone and removes it from the address bar. We don't make someone who can't read a notice sign up for anything.
- **Documents are isolated per household.** The child sees only their own household; the older adult's requests must match the token's household. Anyone else's document answers as non-existent (404).
- The older adult's responses **contain no raw document fields** (wording, verdict and official contacts only). Per-IP and global rate limits.
- **The demo Supabase has RLS disabled and is not a production setup.** The anon key is used only on the server and never ships in the browser bundle.
- **Original photos are deleted from Upstage once reading is done.** We don't store the document photo in our database (the payment agent's step screenshots are kept in the run trace).
- **Fields outside an allowlist are never stored.** `account_number`, `recipient_name` and similar are discarded.
- Every document in `fixtures/` is a **synthetic sample made by the team**, with no real personal or account data. They are not a model benchmark but **controlled experiments**: change two fields and check whether the rule result changes.

## Screen design

The visual language follows the team's Figma design (white app bar, `#3182f6`, borderless white cards on light grey, pill chips, 56px CTA). **The typeface (KoddiUD) and a 20px minimum text size for older adults override the design.** Things in the design we left out on purpose (bottom tab bar, search, notification center, OTP, account-number cards, "confidence %", "safe/normal" wording) were dropped for safety and wording rules. Older adults open the link in Safari and **add it to the home screen**; that icon opens already connected (`/manifest.json?h=token`).

## Open source used

| Package | License | Use |
|---|---|---|
| [Next.js](https://github.com/vercel/next.js) 16 | MIT | App Router, API routes |
| [React](https://github.com/facebook/react) 19 | MIT | UI |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) 4 | MIT | Styling |
| [@supabase/supabase-js](https://github.com/supabase/supabase-js) | MIT | Postgres client |
| [server-only](https://github.com/vercel/next.js) | MIT | Server-only module guard |
| [Vitest](https://github.com/vitest-dev/vitest) | MIT | Tests |
| [TypeScript](https://github.com/microsoft/TypeScript) | Apache-2.0 | Types |
| [ESLint](https://github.com/eslint/eslint) | MIT | Linting |
| [Playwright](https://github.com/microsoft/playwright) | Apache-2.0 | Agent worker's browser (Chromium) |
| [tsx](https://github.com/privatenumber/tsx) | MIT | Running the worker |
| [web-push](https://github.com/web-push-libs/web-push) | MIT | Web push for the child (VAPID) |
| [Phosphor Icons](https://github.com/phosphor-icons/core) | MIT | Icons: path data only, copied into `components/icons.tsx` (no npm dependency) |
| [KoddiUD OnGothic](https://www.koddi.or.kr/) | CC BY-SA 4.0 | Typeface (`public/fonts/`), Korea Disabled People's Development Institute × Yoon Design |

Browser APIs: Web Speech API (`speechSynthesis`, fallback voice), Canvas (photo compression), File/FormData, Web App Manifest.
Voice uses the [ElevenLabs](https://elevenlabs.io) commercial API first (`/api/speech`, server-only key) and falls back to the device's TTS for the same sentence.

Upstage Document AI (Parse, Classify, Information Extract) and Solar Pro 4 are commercial APIs, not open source.

## Assets and license

- **Code:** MIT, see [LICENSE](LICENSE).
- **Not covered by the MIT license:**
  - the logo mascot and wordmark (`public/brand/`) and the line icons exported from the Figma design (lower part of `components/icons.tsx`): the team designer's work, all rights reserved
  - the KoddiUD typeface (`public/fonts/`): CC BY-SA 4.0, see `public/fonts/LICENSE-KoddiUD.md`
  - the team's synthetic sample documents (`fixtures/team/`): included for testing only
  - Phosphor icon paths: MIT, © Phosphor Icons (notice in [LICENSE](LICENSE))
