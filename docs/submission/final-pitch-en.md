# DocDo final pitch (8 min + 2 min Q&A) — read-aloud

Judges asked us to anchor the story in Gyeongbuk's problems, especially aging, and to show how this works in the public sector.
12 slides. Live demo after slide 4. Sources at the bottom.

| # | Time | Cum. |
|---|---|---|
| 1 Cover | 0:15 | 0:15 |
| 2 Gyeongbuk's problem | 1:00 | 1:15 |
| 3 A judgment problem | 0:30 | 1:45 |
| 4 How it works | 0:30 | 2:15 |
| Live demo | 2:00 | 4:15 |
| 5 Upstage | 0:45 | 5:00 |
| 6 Safety principles | 0:30 | 5:30 |
| 7 Verification layer | 0:40 | 6:10 |
| 8 Measured | 0:25 | 6:35 |
| 9 Public sector (Gyeongbuk) | 1:00 | 7:35 |
| 10 Limits and next | 0:15 | 7:50 |
| 11 Close | 0:10 | 8:00 |

---

**[1 Cover]**

Hi, we're team Jeongsyeon-eopseum, and this is DocDo. The name means two things: Dokdo, the island, and "doc do", a document that acts on its own. A senior photographs a letter and hears what it says. Their child sees it checked against official records and approves. An agent does the rest. A person handles the authentication.

**[2 Gyeongbuk's problem]**

Let me start with Gyeongbuk. More than one in four residents here is 65 or older, among the highest rates in the country. At the county level it's sharper. In Uiseong, one in two residents is over 65, the highest of all 226 districts in Korea. Nineteen of Gyeongbuk's cities and counties are already super-aged, more than any other province, and four in ten households have an older adult in them.

And for these people, government still arrives on paper. Local tax, water, health insurance, pension notices, welfare applications. All mail. And crime is following the mail. Among voice-phishing victims, the share aged 60 and over went from 16 percent in 2020 to over 30 percent in the first half of last year, and the regulator's new top scam is fake "registered mail delivery" messages. The mailbox has become the closest attack path to a senior.

This project started with a teammate's family. A parent alone in the countryside, the children in the city. A bill arrives, the parent photographs it and sends it over chat, the child explains by phone, and still nobody is sure whether it should be paid.

**[3 A judgment problem]**

Here's what we learned. The text itself is hard, small print full of administrative terms. But even when someone reads it aloud, the real question remains. Is this a bill or an ad? Did it really come from that agency? What am I supposed to do? That decision is the hard part. And "just pay it" is the sentence that moves money.

So we removed judgment and action from the senior's screen entirely. The senior gets explanation, reassurance, and warnings. Every action goes to the child's screen. And, as I'll show later, a public service can sit in that child's seat.

**[4 How it works]**

One photo. The Upstage Studio agent parses, classifies, and extracts. Our verification layer checks the extracted values against a registry of official issuers. The senior's phone gets large text and a voice reading only what the letter says. The child's phone gets the verdict and the evidence. When the child approves, a Solar agent works the payment portal, and the moment an authentication screen appears, it stops and hands over to a human.

Let me show you.

**[Live demo, 2 min]**

(Senior's phone) I'll photograph a National Health Insurance bill. This one is genuine. While it uploads, the photo stays on screen. It's saying: this is the paper I'm reading.

(Result, let the voice play 2 seconds) It reads only the amount and the due date. No account number, no pay button, and any value it isn't sure of, it doesn't read.

(Child's phone) This is what the child sees. "No verified mismatch", the amount, the due date, what to do, and the evidence: three of three official checks passed. One thing matters here. This doesn't mean "genuine". It means nothing we checked disagreed. The National Health Insurance Service, by the way, is in our registry.

(Approve) When I approve, a worker on our server opens a real browser and goes to the payment portal. It looks up the bill, checks the amount against the document, picks a payment method.

(Human turn) Here's the authentication screen. The agent stops. It never types a password. The child taps this live screen on their own phone, finishes the authentication, and presses Continue. (Keypad, Continue.)

(Done) When payment completes, the senior's screen updates itself: "Handled." The loop closes.

Second document. This is a fake water bill we made, "Seoul Water Fee Co., Ltd." The senior's screen doesn't read the amount at all. It says "this letter needs checking, don't call the number printed here." The child gets the suspected-impersonation reasons.

**[5 Upstage]**

Upstage sits at two core points.

First, the Studio agent is the center of document handling. The Classify node splits documents into payment, application, information, and ads, and only payment and application go on to Extract. Ads are intentionally left unmapped. We call it with include-all so we get a confidence per field, and anything marked low is never spoken or shown.

Second, Solar Pro 4 is the brain of the browser agent. It's not pixel-based computer use. It reads the page's accessibility tree, the buttons, inputs, and links, and picks exactly one action: click, type, hand over to a human, done, or abort. The guardrails live in code, not in the model. If an authentication prompt appears, we stop before calling the model. The pay button is only pressed when the document amount is visible. It never leaves the allowed domain.

**[6 Safety principles]**

These five lines override every other decision. No path to money on the senior's screen. Don't read uncertain values. State facts, never instructions. Never tell anyone to throw a letter away. Numbers printed on the letter can't be tapped.

We also fixed our wording. The strongest thing we ever say is "no verified mismatch." We never say genuine or safe. The screen shows what was checked, how many, and what wasn't.

**[7 Verification layer]**

Behind Studio we have five rules of our own. Match issuer, phone, and URL against the registry. If a key field is low, don't read the number. A public-agency bill with a personal mobile number is a hard warning. If classification is uncertain, a person decides. The account holder must exactly equal the issuer.

The experiment on the right is the one I care about most. Same bill, only two fields changed: the phone number and the website. Extract read both copies correctly. The verdicts diverged: control clear, tampered mismatch. What decided it was the registry check, not the model. So we don't claim AI spots fakes. We compare against official records and find what differs. And that registry is the key to the public-sector story.

**[8 Measured]**

We report observed ranges only. Twelve team-made fixtures, twelve expected verdicts. A photo-degradation simulation: twelve of twelve at medium, eleven of twelve at hard, and that one miss wasn't wrong, it dropped to low and was handed to a person. When input degrades, it doesn't fail quietly, it hands over. 296 regression tests. Processing time across twelve runs: four to twenty-six seconds. This morning we photographed three real printed letters: Busan Waterworks, no verified mismatch; our fake Seoul water bill, suspected impersonation; a Busan District Court payment order, needs review.

**[9 Public sector, Gyeongbuk]**

Back to Gyeongbuk. In this architecture, only one thing changes: who sits in the child's seat.

First, the life-support workers in the senior care service. Gyeongbuk has many seniors living alone with children far away or none at all. When a worker visits and photographs the mail, the screen the child sees today becomes the worker's case-management screen. Who got which bill, due when, handled or not, all on record. Today that's a notebook and phone calls.

Second, township offices and senior centers. Some seniors don't have a phone, so the same flow can run on a tablet at the counter or the senior center as a "read my mail" service.

Third, the registry. Today it's a pilot of eight issuers, and Pohang is our Gyeongbuk entry. If the province registers the official numbers and accounts for local tax and water bills across its 23 cities and counties, every public notice sent in Gyeongbuk becomes checkable. That's data entry, not model development. And it works in reverse: the patterns we flag as suspected impersonation can go to local government and police, so new scams like fake registered-mail notices get a regional response.

Fourth, payment. Today we used a demo portal, but when public payment rails like Wetax or Giro open an API, we swap the ledger. The agent stays the same, and a human still authenticates.

So DocDo helps families when there is a family, and lets a public service step into that seat when there isn't. Places where aging arrived first, like Gyeongbuk, are where this is needed first.

**[10 Limits and next]**

Limits first. An impersonation letter that copies official contacts verbatim can't be caught this way. Sub-office names go to review either way; we accept false positives to reduce misses. We don't look up account holders. Next: push notifications for the child, a Gyeongbuk issuer registry, and public payment APIs.

**[11 Close]**

Seniors listen. Children decide. DocDo does the rest. And when there's no child, the public sector can take that seat. Thank you.

---

## Q&A

**What would it take to deploy in Gyeongbuk?**
Three things: registering official contacts and accounts for city and county bills, a guardian-account scheme for care workers, and a public payment API. The first two are data and operations work and fast; the third needs agency agreement.

**What about seniors without a phone?**
A care worker photographs the mail on a visit, or the same flow runs on a tablet at a senior center or township office. The senior side has no account, so any device works.

**Where exactly is Upstage used?**
The Studio agent is the center of the pipeline, and Solar Pro 4 decides the browser agent's actions. What we added is the verification layer against official records.

**Do you catch 100% of fakes?**
No. A letter that copies official contacts verbatim passes. We only say "no verified mismatch," and anything uncertain goes to a person.

**What if the agent pays the wrong amount?**
It presses pay only when the on-screen amount equals the document amount; otherwise it aborts. A human authenticates, so the final confirmation is always in human hands.

**Privacy?**
Originals are deleted from Upstage after processing and we store no images. The senior's responses carry no raw document fields, and remote inputs are never stored. For a public deployment, it can run on the municipality's own servers.

---

Sources: Statistics Korea, "2025 Statistics on the Aged" (Gyeongbuk 65+ share 26.1%, second after Jeonnam 27.4%) · Ministry of the Interior resident registration, Sept 2025 (Gyeongbuk 24.5%, 539k) · 2025 district-level aging rates (Uiseong 49.2%, highest of 226) · Kyongbuk Maeil (19 super-aged districts, most of any province) · households with an older adult 38.7% · Financial Supervisory Service voice-phishing statistics (victims 60+: 16% in 2020 → 30.6% in H1 2025; fake registered-mail delivery scams).
