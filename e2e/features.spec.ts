// The features around the core loop, in the browser against the fake Bolna and its scripted
// Bhaav: watching a full order, the owner line, order again and every week, the proof page, the
// Break Bhaav scoreboard and the Desk's live transcript.

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { signIn, stamp } from './helpers';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let phoneSeq = 0;
/** A 10-digit Indian mobile number no other test in this run uses. */
const phone = () => `8${String(Date.now()).slice(-6)}${String(++phoneSeq).padStart(3, '0')}`;

type View = {
  order: { status: string; item: string | null; approvedQuoteId: string | null };
  suppliers: Array<{ name: string }>;
};
const view = async (api: APIRequestContext, id: string): Promise<View> =>
  (await api.get(`/api/requests/${id}`)).json();

/** A draft order with its item and suppliers filled in, through the API the screens use. */
async function draft(page: Page, item: string, suppliers: number): Promise<string> {
  const api = page.request;
  const { id } = await (
    await api.post('/api/requests', { data: { buyerName: 'Feature Test Kitchen' } })
  ).json();
  await api.patch(`/api/requests/${id}`, {
    data: { item, quantity: 10, unit: 'kg', deliverBy: inDays(5) },
  });
  for (let n = 1; n <= suppliers; n++) {
    const res = await api.post(`/api/requests/${id}/suppliers`, {
      data: { name: `Feature Supplier ${n}`, phone: phone(), consentNote: 'said yes on WhatsApp' },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  return id;
}

test.describe.configure({ timeout: 180_000 });

test('a judge watches a whole order: callback kept, planted price stopped', async ({ page }) => {
  await signIn(page);
  await page.goto('/');
  await page.getByRole('button', { name: /Watch a full order/ }).click();
  await expect(page).toHaveURL(/\/r\/req_/);
  await expect(
    page.getByText('Pretend suppliers, the real AI and the real lie-catcher.'),
  ).toBeVisible();
  // The conversation fills in as each call plays.
  await expect(page.getByRole('heading', { name: 'Conversation' })).toBeVisible({
    timeout: 30_000,
  });

  await expect(page.getByText('All calls done', { exact: true })).toBeVisible({ timeout: 150_000 });
  await expect(page.getByText(/real lie-catcher\. Finished\.$/)).toBeVisible();
  // The last call is the trickster's: the planted ₹28 never reached the phone.
  await expect(page.getByText('Stopped before it was spoken').first()).toBeVisible();
  await expect(page.getByText('1 stopped')).toBeVisible();
  // The callback: Ramesh's first call ended with a promise, his second with a quote.
  await page.getByRole('button', { name: /Ramesh & Sons · Ask 2/ }).click();
  await expect(page.getByText('Haan ji, ab boliye.')).toBeVisible();

  await page.getByRole('link', { name: 'See results and choose' }).click();
  // The best price (Gupta's ₹32, quoted first) heads the results.
  await expect(page.getByText('Gupta Traders').first()).toBeVisible();
  // A simulation is never repeated or remembered as a real price.
  await expect(page.getByRole('heading', { name: 'Next time' })).toHaveCount(0);
});

test('Bhaav phones the owner, who starts the calls and approves by voice', async ({ page }) => {
  await signIn(page);
  const id = await draft(page, `owner line ${stamp()}`, 2);
  await page.goto(`/r/${id}`);
  await page.getByLabel('Your phone number').fill(phone());
  await page.getByLabel(/Call me with the result/).click();
  await expect(page.getByLabel(/Call me with the result/)).toBeChecked();
  await page.getByRole('button', { name: 'Call me to take the order' }).click();
  await expect(page.getByText('Bhaav is calling you now.')).toBeVisible();

  // On the phone the owner says "haan, shuru karo": the calls start, run, and finish; then Bhaav
  // phones back with the result, and "A, pakka" approves the best quote.
  await expect
    .poll(async () => (await view(page.request, id)).order.status, {
      timeout: 150_000,
      intervals: [2000],
    })
    .toBe('approved');
  await page.goto(`/r/${id}`);
  await expect(page.getByText('You have chosen a supplier.')).toBeVisible();
  await expect(page.getByText('Bhaav called you with the result.')).toBeVisible();
});

test('a finished order can be ordered again, and set to repeat every week', async ({ page }) => {
  await signIn(page);
  const item = `weekly ${stamp()}`;
  const id = await draft(page, item, 1);
  expect((await page.request.post(`/api/requests/${id}/start`)).status()).toBe(200);
  await expect
    .poll(async () => (await view(page.request, id)).order.status, {
      timeout: 100_000,
      intervals: [1500],
    })
    .toBe('done');

  await page.goto(`/r/${id}/result`);
  await page.getByLabel('Day').selectOption('1');
  await page.getByLabel('Start calls at').selectOption('11');
  await page.getByRole('button', { name: 'Repeat every week' }).click();
  await expect(page.getByText(/^Repeats every Monday at 11:00/)).toBeVisible();
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(page.getByText('Paused.')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect(page.getByText(/^Repeats every Monday at 11:00/)).toBeVisible();
  // "Phone me first" needs the owner's number, and says so.
  await page.getByLabel(/Phone me first/).check();
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Add your mobile number on the order first')).toBeVisible();

  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Your weekly orders' })).toBeVisible();
  await expect(page.getByText(item)).toBeVisible();

  await page.goto(`/r/${id}/result`);
  await page.getByRole('button', { name: 'Order this again' }).click();
  await expect(page).not.toHaveURL(new RegExp(`/r/${id}`));
  await expect(page.getByRole('heading', { name: /Order for Feature Test Kitchen/ })).toBeVisible();
  await expect(page.getByText('Feature Supplier 1', { exact: true })).toBeVisible();
  await expect(page.getByText('1 added')).toBeVisible();
});

test('the proof page and the Break Bhaav scoreboard show what happened', async ({ page }) => {
  await signIn(page);
  await page.goto('/proof');
  await expect(page.getByRole('heading', { name: 'What Bhaav did, in numbers' })).toBeVisible();
  await expect(page.getByText('Saved on real orders')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'The lie-catcher, on every call' })).toBeVisible();
  await expect(page.getByText('Numbers checked')).toBeVisible();
  await page.getByRole('link', { name: 'Be the supplier' }).last().click();
  await expect(page.getByRole('heading', { name: 'Break Bhaav' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Hall of tricks' })).toBeVisible();
});

test("the Desk's conversation shows on the order as the buyer talks", async ({ page }) => {
  await signIn(page);
  const id = await draft(page, `desk talk ${stamp()}`, 0);
  // Bolna sends the buyer's words to the custom LLM; the AI is unreachable here, so Bhaav says
  // its safe line, and the turn is written down all the same.
  const res = await page.request.post('/v1/chat/completions', {
    headers: { authorization: `Bearer ${process.env.E2E_LLM_SECRET}` },
    data: {
      model: 'bhaav-llm',
      messages: [
        { role: 'system', content: `You are Bhaav.\nREQUEST_REF: ${id}` },
        { role: 'user', content: '50 kilo pyaaz chahiye, Friday tak' },
      ],
    },
  });
  expect(await res.text()).toContain('Ek second ji');
  await page.goto(`/r/${id}`);
  await expect(page.getByRole('heading', { name: 'What Bhaav heard' })).toBeVisible();
  await expect(page.getByText('50 kilo pyaaz chahiye, Friday tak', { exact: true })).toBeVisible();
});
