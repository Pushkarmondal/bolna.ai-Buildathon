# Submission kit

Deadline: Sat 31 Oct 2026. Plan to submit on Fri 30 Oct.

## Description (200 characters max)

Recommended (194): Bhaav phones your suppliers in Hindi, Kannada or English, gets real quotes and bargains only with offers it truly has. A live lie-catcher checks every number before it is spoken. Built on Bolna.

## Link field

- Live app: `https://bhaav.<you>.workers.dev` (passcode in the description or the form's notes)
- Code: the GitHub repo, made public, with no keys in it

## For judges (put this on the first slide and in the form)

1. Open the link and enter the passcode.
2. Press **Watch a full order**: four pretend suppliers, the real AI and lie-catcher, about two minutes. Watch the conversation fill in, a callback being kept, and a planted price stopped in red.
3. Go to **Be the supplier**, pick a supplier, and press **Take Bhaav's call** (allow the microphone). Try to make Bhaav say a price it hasn't heard. Your try lands on the **Break Bhaav** scoreboard.
4. **Proof** shows what Bhaav did, from the database: rupees saved on real orders, every number checked, possible slips, answer time, and the test bench.
5. **Price memory** shows the best price on every past order; each result also says how today compares with last time.

## Deck (8 slides)

1. The problem: a restaurant owner phoning five suppliers every Monday.
2. Bhaav in one line, with a screenshot of the results page.
3. How it works: tell, confirm, ask, bargain, report, approve, and (optionally) Bhaav tells the chosen supplier; the results go to WhatsApp in one tap. The owner line: Bhaav phones the owner to take the order and again for a spoken "haan", with no app needed.
4. The lie-catcher: the live conversation with numbers marked green, blue and red, and the Break Bhaav scoreboard.
5. Proof: real calls, rupees saved, 0 unbacked numbers in the bench, read-back accuracy.
6. Built on Bolna: custom LLM, custom functions, prompt variables, webhooks, Web Call SDK, outbound calls, multilingual (Hindi, Kannada, English), and the Caller as a graph agent.
7. Market: 8.84 crore Udyam-registered businesses; a monthly plan per shop (a guess to test).
8. Next: price memory shared across shops in one market, then buyer agents talking to supplier agents.

## 3-minute video

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | A list of supplier numbers | Shop owners phone five suppliers for today's rate. Bhaav does it for them, and it cannot lie. |
| 0:15 | The buyer talking to Desk; the order card fills | (let it play) |
| 0:45 | Real calls, sped up; round 2 with the real offer | Every price is read back and saved with the recording. |
| 1:45 | Be the supplier: the judge pushes for a fake price; the red block | Bhaav can't bluff. |
| 2:15 | Results: ranking, rupees saved, Approve, the confirmation call, WhatsApp | Only the buyer can say yes. |
| 2:40 | Architecture and market | Try it yourself: be the supplier. |

## Before pressing submit

- [ ] The app opens on a phone and on another network
- [ ] `npm test`, `npm run lint`, `npm run typecheck` and `npm run e2e` all pass on the commit you submit
- [ ] The passcode works; practice calls stop at 2 minutes (`BOLNA_PRACTICE_AGENT_ID` is set)
- [ ] Bolna has credit for at least 40 judge minutes
- [ ] `SUPPLIER_ALLOWLIST` is set to the partner suppliers only
- [ ] Real supplier calls are recorded between 10:00 and 19:00 India time (`CALL_HOURS`)
- [ ] The bench was run for real (`npm run bench`) and its unbacked count is the number on the proof slide
- [ ] The repo is public, has this README, and has no keys
- [ ] The deck and video open in a private window
