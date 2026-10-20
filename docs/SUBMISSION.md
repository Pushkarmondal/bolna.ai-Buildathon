# Submission kit

Deadline: Sat 31 Oct 2026. Plan to submit on Fri 30 Oct.

## Description (200 characters max)

Recommended (185): Bhaav phones your suppliers in Hindi or English, gets real quotes and bargains only with offers it truly has. A live lie-catcher checks every number before it is spoken. Built on Bolna.

## Link field

- Live app: `https://bhaav.<you>.workers.dev` (passcode in the description or the form's notes)
- Code: the GitHub repo, made public, with no keys in it

## For judges (put this on the first slide and in the form)

1. Open the link and enter the passcode.
2. Go to **Be the supplier**, pick a supplier, and press **Take Bhaav's call** (allow the microphone).
3. Bargain, and try to make Bhaav say a price it hasn't heard. Watch the lie-catcher afterwards.
4. **Test bench** shows 50 simulated chats and how many numbers were stopped.

## Deck (8 slides)

1. The problem: a restaurant owner phoning five suppliers every Monday.
2. Bhaav in one line, with a screenshot of the results page.
3. How it works: tell, confirm, ask, bargain, report, approve.
4. The lie-catcher: a blocked sentence, before and after.
5. Proof: real calls, rupees saved, 0 unbacked numbers in the bench, read-back accuracy.
6. Built on Bolna: custom LLM, custom functions, prompt variables, webhooks, Web Call SDK, outbound calls.
7. Market: 8.84 crore Udyam-registered businesses; a monthly plan per shop (a guess to test).
8. Next: price memory for every shop, then buyer agents talking to supplier agents.

## 3-minute video

| Time | Show | Say |
| --- | --- | --- |
| 0:00 | A list of supplier numbers | Shop owners phone five suppliers for today's rate. Bhaav does it for them, and it cannot lie. |
| 0:15 | The buyer talking to Desk; the order card fills | (let it play) |
| 0:45 | Real calls, sped up; round 2 with the real offer | Every price is read back and saved with the recording. |
| 1:45 | Be the supplier: the judge pushes for a fake price; the red block | Bhaav can't bluff. |
| 2:15 | Results: ranking, rupees saved, Approve | Only the buyer can say yes. |
| 2:40 | Architecture and market | Try it yourself: be the supplier. |

## Before pressing submit

- [ ] The app opens on a phone and on another network
- [ ] The passcode works; practice calls stop at 2 minutes
- [ ] Bolna has credit for at least 40 judge minutes
- [ ] `SUPPLIER_ALLOWLIST` is set to the partner suppliers only
- [ ] The repo is public, has this README, and has no keys
- [ ] The deck and video open in a private window
