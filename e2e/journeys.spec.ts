// Everything the main order test does not walk through: every link, removing a supplier,
// approving a quote that is not the cheapest, price memory's chart and table, what the calls page
// says when the AI does not answer, the skip link, and the way back to the last order.

import { type APIRequestContext, expect, type Page, test } from '@playwright/test';
import { signIn, stamp } from './helpers';

const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
let phoneSeq = 0;
/** A 10-digit Indian mobile number no other test in this run uses. */
const phone = () => `9${String(Date.now()).slice(-6)}${String(++phoneSeq).padStart(3, '0')}`;

type View = {
  order: { status: string };
  calls: Array<{ id: string; round: number }>;
  quotes: Array<{ id: string; supplierId: string }>;
  ranking: Array<{ quoteId: string; supplierId: string }>;
  suppliers: Array<{ id: string; name: string }>;
  bestQuoteId: string | null;
};

const view = async (api: APIRequestContext, id: string): Promise<View> =>
  (await api.get(`/api/requests/${id}`)).json();

/** An order whose pretend calls have all finished, through the same API the screens use. */
async function finishedOrder(page: Page, item: string, suppliers: number): Promise<string> {
  const api = page.request;
  const { id } = await (
    await api.post('/api/requests', { data: { buyerName: 'Journey Test Kitchen' } })
  ).json();
  await api.patch(`/api/requests/${id}`, {
    data: { item, quantity: 10, unit: 'kg', deliverBy: inDays(5) },
  });
  for (let n = 1; n <= suppliers; n++) {
    const res = await api.post(`/api/requests/${id}/suppliers`, {
      data: { name: `Journey Supplier ${n}`, phone: phone(), consentNote: 'agreed' },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  expect((await api.post(`/api/requests/${id}/start`)).status()).toBe(200);
  await expect
    .poll(async () => (await view(api, id)).order.status, { timeout: 100_000, intervals: [1500] })
    .toBe('done');
  return id;
}

test.describe.configure({ timeout: 180_000 });

test('every link on every page leads to a real page, with no errors on the way', async ({
  page,
}) => {
  await signIn(page);
  const id = await finishedOrder(page, `link check ${stamp()}`, 1);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });

  const seen = new Set<string>();
  const external = new Set<string>();
  const queue = ['/', '/prices', '/play', '/bench', `/r/${id}`];
  while (queue.length > 0 && seen.size < 40) {
    const path = queue.shift() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    const res = await page.goto(path);
    expect(res?.status(), path).toBe(200);
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1, path).toBeVisible();
    await expect(h1, `${path} must not be the not-found page`).not.toHaveText(
      'This page does not exist',
    );
    await page.waitForLoadState('networkidle');
    for (const href of await page
      .locator('a[href]')
      .evaluateAll((as) => as.map((a) => a.getAttribute('href') ?? ''))) {
      if (href.startsWith('#')) continue;
      if (href.startsWith('/')) queue.push(href);
      else external.add(href);
    }
  }
  expect(seen.has(`/r/${id}/result`), 'the results page is reachable by a link').toBe(true);
  expect(errors).toEqual([]);

  // Every external link answers (WhatsApp's share link, for one).
  for (const href of external) {
    const res = await page.request.get(href, { maxRedirects: 5, timeout: 20_000 });
    expect(res.status(), href).toBeLessThan(400);
  }
});

test('a supplier added by mistake can be removed before calling starts', async ({ page }) => {
  await signIn(page);
  await page.getByLabel('Your business name').fill('Remove Test Kitchen');
  await page.getByRole('button', { name: 'Start an order' }).first().click();
  for (const name of ['Keep Traders', 'Mistake Traders']) {
    await page.getByLabel('Name', { exact: true }).fill(name);
    await page.getByLabel('Mobile number').fill(phone());
    await page.getByLabel('How they agreed').fill('said yes on the phone');
    await page.getByLabel(/agreed to take a call/).check();
    await page.getByRole('button', { name: 'Add supplier' }).click();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(page.getByText('2 added')).toBeVisible();
  await page.getByRole('button', { name: 'Remove Mistake Traders' }).click();
  await expect(page.getByText('Mistake Traders', { exact: true })).toBeHidden();
  await expect(page.getByText('1 added')).toBeVisible();
  await expect(page.getByText('Keep Traders', { exact: true })).toBeVisible();
});

test('the buyer can choose a supplier who is not the cheapest', async ({ page }) => {
  await signIn(page);
  const id = await finishedOrder(page, `second choice ${stamp()}`, 3);
  const v = await view(page.request, id);
  const second = v.ranking[1];
  const secondName = v.suppliers.find((s) => s.id === second?.supplierId)?.name ?? '';
  const bestName =
    v.suppliers.find((s) => s.id === v.quotes.find((q) => q.id === v.bestQuoteId)?.supplierId)
      ?.name ?? '';

  await page.goto(`/r/${id}/result`);
  const rows = page.getByRole('listitem').filter({ hasText: 'per kilo, delivered' });
  await expect(rows).toHaveCount(3);
  await rows.nth(1).getByRole('button', { name: 'Approve' }).click();

  await expect(page.getByRole('heading', { name: `You chose ${secondName}` })).toBeVisible();
  await expect(rows.nth(1)).toContainText('Chosen');
  await expect(rows.nth(0)).toContainText('Best');
  await expect(rows.nth(0)).not.toContainText('Chosen');
  await expect(page.locator('pre')).toContainText(`2. ${secondName}`);
  await expect(page.locator('pre')).toContainText('(chosen)');
  expect(bestName).not.toBe(secondName);
});

test('price memory draws a chart from the fourth order and lists every order', async ({ page }) => {
  await signIn(page);
  const item = `chart check ${stamp()}`;
  for (let i = 0; i < 4; i++) await finishedOrder(page, item, 1);
  await page.goto('/prices');
  const card = page.locator('section').filter({ hasText: item });
  await expect(card.getByRole('img')).toHaveAttribute('aria-label', /^4 orders: from ₹/);
  await card.getByText('Show every order').click();
  await expect(card.getByRole('table').getByRole('row')).toHaveCount(5); // header + 4 orders
});

test('the calls page says so when the AI does not answer', async ({ page }) => {
  await signIn(page);
  const id = await finishedOrder(page, `ai silent ${stamp()}`, 1);
  const call = (await view(page.request, id)).calls[0];
  // Bolna asks the custom LLM for a turn; Groq is unreachable here, so Bhaav says its safe line.
  const res = await page.request.post('/v1/chat/completions', {
    headers: { authorization: `Bearer ${process.env.E2E_LLM_SECRET}` },
    data: {
      model: 'bhaav-llm',
      messages: [
        { role: 'system', content: `You are Bhaav.\nCALL_REF: ${call?.id}` },
        { role: 'user', content: 'Haan ji, boliye.' },
      ],
    },
  });
  expect(res.status()).toBe(200);
  expect(await res.text()).toContain('Ek second ji');

  await page.goto(`/r/${id}`);
  await expect(page.getByRole('heading', { name: 'Problems' })).toBeVisible();
  await expect(
    page.getByText('The AI did not answer in time; Bhaav said its safe line.'),
  ).toBeVisible();
});

test('a calling order with no live call says why it is waiting', async ({ page }) => {
  await signIn(page);
  const id = await finishedOrder(page, `waiting ${stamp()}`, 1);
  // The local fake never makes Bolna busy and calls at any hour, so the server's answer is
  // reshaped into a waiting order: first outside calling hours, then after a busy Bolna.
  let waitingFor: 'hours' | 'retry' = 'hours';
  await page.route(`**/api/requests/${id}`, async (route) => {
    const response = await route.fetch();
    const body = await response.json();
    body.order.status = 'calling';
    body.waitingFor = waitingFor;
    body.callHours = { from: 10, to: 19 }; // the deployed default; local runs use 0-24
    if (waitingFor === 'retry')
      body.calls = body.calls.map((c: object) => ({ ...c, status: 'failed', retryable: true }));
    await route.fulfill({ response, json: body });
  });

  await page.goto(`/r/${id}`);
  await expect(
    page.getByText(
      'Suppliers are called only between 10:00 and 19:00 India time, so the next call starts at 10:00.',
    ),
  ).toBeVisible();

  waitingFor = 'retry';
  await page.reload();
  await expect(
    page.getByText('Bolna was busy, so Bhaav will try that call again in a minute.'),
  ).toBeVisible();
  await expect(page.getByText('Ask: Bolna busy, trying again')).toBeVisible();
});

test('the skip link appears on the first Tab and the last order is one click away', async ({
  page,
}) => {
  await signIn(page);
  await page.getByLabel('Your business name').fill('Last Order Kitchen');
  await page.getByRole('button', { name: 'Start an order' }).first().click();
  await expect(page.getByRole('heading', { name: 'Order for Last Order Kitchen' })).toBeVisible();
  const orderUrl = page.url();

  await page.goto('/');
  await page.keyboard.press('Tab');
  const skip = page.getByRole('link', { name: 'Skip to main content' });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();

  await page.getByRole('link', { name: 'Go back to your last order' }).click();
  await expect(page).toHaveURL(orderUrl);
  await expect(page.getByRole('heading', { name: 'Order for Last Order Kitchen' })).toBeVisible();
});

test('an approval stays on screen even when a slow refresh is on its way', async ({ page }) => {
  await signIn(page);
  const id = await finishedOrder(page, `slow refresh ${stamp()}`, 2);
  await page.goto(`/r/${id}/result`);
  const rows = page.getByRole('listitem').filter({ hasText: 'per kilo, delivered' });
  await expect(rows.first().getByRole('button', { name: 'Approve' })).toBeVisible();

  // Every refresh of this order now arrives 1.5 seconds late, like a slow mobile network: the
  // server answers at once (before the approval), and the answer reaches the page afterwards.
  await page.route(`**/api/requests/${id}`, async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    await new Promise((r) => setTimeout(r, 1500));
    await route.fulfill({ response });
  });
  // Coming back to the tab starts a refresh; the buyer presses Approve straight away.
  await page.evaluate(() =>
    document.dispatchEvent(new Event('visibilitychange', { bubbles: true })),
  );
  await rows.first().getByRole('button', { name: 'Approve' }).click();

  await expect(rows.first()).toContainText('Chosen');
  await page.waitForTimeout(2500); // the slow refresh has landed by now
  await expect(rows.first()).toContainText('Chosen');
  await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
});

test('copying the WhatsApp text still works where the clipboard API is blocked', async ({
  page,
}) => {
  await signIn(page);
  const id = await finishedOrder(page, `copy fallback ${stamp()}`, 1);
  await page.goto(`/r/${id}/result`);
  // As in WhatsApp's or Instagram's built-in browser: the modern clipboard call is refused.
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.reject(new Error('blocked')) },
      configurable: true,
    });
  });
  await page.getByRole('button', { name: 'Copy text' }).click();
  await expect(page.getByText('Copied.')).toBeVisible();
});

test('the lie-catcher stops an invented price, and the calls page shows it', async ({ page }) => {
  await signIn(page);
  const id = await finishedOrder(page, `lie check ${stamp()}`, 1);
  const call = (await view(page.request, id)).calls[0];
  // The fake Groq answers "lie test" with "Doosre supplier ne ₹27.75 bola hai." — a price nobody said.
  const res = await page.request.post('/v1/chat/completions', {
    headers: { authorization: `Bearer ${process.env.E2E_LLM_SECRET}` },
    data: {
      model: 'bhaav-llm',
      messages: [
        { role: 'system', content: `You are Bhaav.\nCALL_REF: ${call?.id}` },
        { role: 'user', content: 'lie test: koi aur kitne mein de raha hai?' },
      ],
    },
  });
  const spoken = await res.text();
  expect(spoken).toContain('Ek second ji');
  expect(spoken).not.toContain('27.75');

  await page.goto(`/r/${id}`);
  await expect(page.getByText('1 stopped')).toBeVisible();
  await expect(page.getByText('Stopped ₹27.75: not in the quote book')).toBeVisible();
  await expect(page.getByText('“Doosre supplier ne ₹27.75 bola hai.”')).toBeVisible();
});
