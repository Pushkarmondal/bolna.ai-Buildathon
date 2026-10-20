// Nothing spills, overlaps or scrolls sideways, on every page, at nine widths, with worst-case data:
// an 80-letter name with no spaces, a 120-character item, a Kannada quote, a pack price with
// delivery and payment terms, and one unbroken 70-letter word.

import { type APIRequestContext, expect, test } from '@playwright/test';

const WIDTHS = [1440, 1280, 1100, 1000, 880, 700, 375, 360, 320];
const LONG_NAME = 'Shreeramachandramurthy'.repeat(4).slice(0, 79);
const ITEM =
  'extra long grain aged basmati rice from the Dehradun valley, double polished, sortex cleaned, 25 kilo bags';
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const ids = { draft: '', live: '' };

async function order(api: APIRequestContext, phoneTail: string) {
  const { id } = await (
    await api.post('/api/requests', { data: { buyerName: `${LONG_NAME}X` } })
  ).json();
  await api.patch(`/api/requests/${id}`, {
    data: {
      item: ITEM,
      quantity: 250,
      unit: 'kg',
      deliverBy: inDays(6),
      area: 'Koramangala 5th Block, near the Forum Mall service road',
      quality: 'premium sella, 1121 variety, not older than twelve months',
    },
  });
  for (const n of [1, 2, 3]) {
    const res = await api.post(`/api/requests/${id}/suppliers`, {
      data: {
        name: `${LONG_NAME}${n}`,
        phone: `9${String(Date.now()).slice(-6)}${phoneTail}${n}`,
        language: 'kn',
        consentNote: 'agreed',
      },
    });
    expect(res.status(), await res.text()).toBe(201);
  }
  return id as string;
}

test.describe.configure({ mode: 'serial', timeout: 180_000 });

test.beforeAll(async ({ playwright }) => {
  const api = await playwright.request.newContext({ baseURL: 'http://localhost:8787' });
  expect(
    (await api.post('/api/auth', { data: { passcode: process.env.E2E_PASSCODE } })).status(),
  ).toBe(200);
  ids.draft = await order(api, '11');
  ids.live = await order(api, '22');
  await api.post(`/api/requests/${ids.live}/start`);
  await expect
    .poll(async () => (await (await api.get(`/api/requests/${ids.live}`)).json()).order.status, {
      timeout: 120_000,
      intervals: [2000],
    })
    .toBe('done');

  // Worst-case quotes on the finished calls, sent the way Bolna sends a tool call.
  const view = await (await api.get(`/api/requests/${ids.live}`)).json();
  const calls = view.calls.filter((c: { round: number }) => c.round === 1);
  const tool = (data: Record<string, string>) =>
    api.post('/tools/save_quote', {
      headers: { authorization: `Bearer ${process.env.E2E_TOOL_SECRET}` },
      data,
    });
  await tool({
    call_ref: calls[0].id,
    price: '₹2,250',
    unit: 'pack',
    pack_size: '25',
    pack_unit: 'kilo',
    delivery_charge: '1,200',
    payment_terms: 'half advance, half within fifteen days of delivery by UPI or cheque',
    supplier_words:
      'Dekhiye sahab, pachees kilo ka bag do hazaar do sau pachaas ka padega, aur delivery ka barah sau alag se lagega kyunki Koramangala bahut door hai',
  });
  await tool({
    call_ref: calls[1].id,
    price: '88',
    unit: 'kilo',
    delivery_date: inDays(30),
    min_quantity: '500',
    supplier_words:
      'ಎಂಬತ್ತೆಂಟು ರೂಪಾಯಿ ಕೆಜಿಗೆ, ಆದರೆ ಕನಿಷ್ಠ ಐನೂರು ಕೆಜಿ ತೆಗೆದುಕೊಳ್ಳಬೇಕು ಮತ್ತು ಮುಂದಿನ ತಿಂಗಳು ಮಾತ್ರ ಡೆಲಿವರಿ ಸಾಧ್ಯ',
  });
  await tool({
    call_ref: calls[2].id,
    price: '1',
    unit: 'bori',
    supplier_words: 'Supercalifragilisticexpialidocioussupercalifragilisticexpialidociousrice',
  });
  await api.dispose();
});

/** Every way a page can look broken, measured: returns a sentence per problem, empty when clean. */
function detect(): string[] {
  const out: string[] = [];
  const desc = (el: Element) =>
    `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '')
      .split(' ')
      .slice(0, 3)
      .join('.')}`.slice(0, 60);
  const txt = (el: Element) =>
    ((el as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').slice(0, 40);
  const root = document.documentElement;
  if (root.scrollWidth > root.clientWidth)
    out.push(`page scrolls sideways by ${root.scrollWidth - root.clientWidth}px`);
  const all = [...document.querySelectorAll('#main *, header *, nav *')];
  for (const el of all) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || el.closest('.sr-only')) continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const wider = el.scrollWidth - el.clientWidth;
    if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && wider > 1)
      out.push(`scrolls sideways: ${desc(el)} "${txt(el)}" ${wider}px`);
    if (wider > 1 && cs.overflowX === 'visible' && cs.display !== 'inline' && !el.closest('svg'))
      out.push(`spills: ${desc(el)} "${txt(el)}" ${wider}px`);
    const card = el.parentElement?.closest('.surface');
    if (card) {
      const b = card.getBoundingClientRect();
      if (r.right > b.right + 1 || r.left < b.left - 1)
        out.push(`outside its card: ${desc(el)} "${txt(el)}"`);
    }
  }
  for (const parent of all) {
    if (parent.closest('svg')) continue;
    const kids = [...parent.children].filter((k) => {
      const cs = getComputedStyle(k);
      return (
        !['absolute', 'fixed', 'sticky'].includes(cs.position) &&
        !['none', 'inline', 'contents'].includes(cs.display)
      );
    });
    if (kids.length < 2 || kids.length > 60) continue;
    const rs = kids.map((k) => k.getBoundingClientRect());
    for (let i = 0; i < kids.length; i++)
      for (let j = i + 1; j < kids.length; j++) {
        const a = rs[i] as DOMRect;
        const b = rs[j] as DOMRect;
        if (!a.width || !b.width) continue;
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2)
          out.push(`overlap: ${desc(kids[i] as Element)} with ${desc(kids[j] as Element)}`);
      }
  }
  for (const el of document.querySelectorAll('*')) {
    const cs = getComputedStyle(el);
    if (cs.position !== 'fixed' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) out.push(`fixed bar off screen: ${desc(el)}`);
  }
  return out;
}

for (const width of WIDTHS) {
  test(`every page fits at ${width}px with worst-case data`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/');
    await page.getByLabel('Passcode').fill(process.env.E2E_PASSCODE ?? '');
    await page.getByRole('button', { name: 'Open Bhaav' }).click();
    await expect(page.getByLabel('Your business name')).toBeVisible();
    const problems: string[] = [];
    for (const path of [
      '/',
      `/r/${ids.draft}`,
      `/r/${ids.live}`,
      `/r/${ids.live}/result`,
      '/prices',
      '/play',
      '/bench',
      '/no-such-page',
    ]) {
      await page.goto(path);
      await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      await page.waitForLoadState('networkidle');
      for (const p of await page.evaluate(detect))
        problems.push(`${path.replace(/req_\w+/, 'req')} ${p}`);
    }
    expect(problems).toEqual([]);
  });
}

/** Every visible text element whose contrast with its real background is under 4.5:1 (3:1 if large). */
function lowContrast(): string[] {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const rgba = (css: string): number[] => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = '#000';
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] ?? 0, d[1] ?? 0, d[2] ?? 0, (d[3] ?? 0) / 255];
  };
  const lum = (c: number[]) => {
    const f = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * f(c[0] ?? 0) + 0.7152 * f(c[1] ?? 0) + 0.0722 * f(c[2] ?? 0);
  };
  const over = (top: number[], bottom: number[]) => {
    const a = top[3] ?? 1;
    return [0, 1, 2].map((i) => (top[i] ?? 0) * a + (bottom[i] ?? 0) * (1 - a)).concat(1);
  };
  const background = (el: Element) => {
    const layers: number[][] = [];
    for (let e: Element | null = el; e; e = e.parentElement) {
      const c = rgba(getComputedStyle(e).backgroundColor);
      if ((c[3] ?? 0) > 0) layers.push(c);
      if ((c[3] ?? 0) >= 1) break;
    }
    let bg = rgba(getComputedStyle(document.body).backgroundColor);
    for (const c of layers.reverse()) bg = over(c, bg);
    return bg;
  };
  const out: string[] = [];
  for (const el of document.querySelectorAll('body *')) {
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim())) continue;
    if (el.closest('.sr-only, svg')) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const bg = background(el);
    const fg = over(rgba(cs.color), bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
    const ratio = (a + 0.05) / (b + 0.05);
    const size = Number.parseFloat(cs.fontSize);
    const need =
      size >= 24 || (size >= 18.66 && Number.parseInt(cs.fontWeight, 10) >= 700) ? 3 : 4.5;
    if (ratio < need)
      out.push(`"${(el.textContent ?? '').trim().slice(0, 30)}" ${ratio.toFixed(2)} < ${need}`);
  }
  return out;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`every text meets contrast in ${scheme} mode`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto('/');
    await page.getByLabel('Passcode').fill(process.env.E2E_PASSCODE ?? '');
    await page.getByRole('button', { name: 'Open Bhaav' }).click();
    await expect(page.getByLabel('Your business name')).toBeVisible();
    const problems: string[] = [];
    for (const path of [
      '/',
      `/r/${ids.draft}`,
      `/r/${ids.live}`,
      `/r/${ids.live}/result`,
      '/prices',
      '/play',
      '/bench',
    ]) {
      await page.goto(path);
      await page.addStyleTag({ content: '*{animation:none!important;transition:none!important}' });
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
      for (const p of await page.evaluate(lowContrast))
        problems.push(`${path.replace(/req_\w+/, 'req')} ${p}`);
    }
    expect(problems).toEqual([]);
  });
}
