# Design System Master File

> **LOGIC:** When building a specific page, first check `design-system/pages/[page-name].md`.
> If that file exists, its rules **override** this Master file.
> If not, strictly follow the rules below.

---

**Project:** Bhaav
**Generated:** 2026-10-20 19:54:44
**Category:** General
**Design Dials:** Variance 4/10 (Balanced / Modern) | Motion 3/10 (Subtle) | Density 6/10 (Standard)

---

## Global Rules

### Color Palette

| Role | Hex | CSS Variable |
|------|-----|--------------|
| Primary | `#1E3A5F` | `--color-primary` |
| On Primary | `#FFFFFF` | `--color-on-primary` |
| Secondary | `#2563EB` | `--color-secondary` |
| On Secondary | `#FFFFFF` | `--color-on-secondary` |
| Accent/CTA | `#059669` | `--color-accent` |
| On Accent/CTA | `#000000` | `--color-on-accent` |
| Background | `#F8FAFC` | `--color-background` |
| Foreground | `#0F172A` | `--color-foreground` |
| Card | `#FFFFFF` | `--color-card` |
| Card Foreground | `#0F172A` | `--color-card-foreground` |
| Muted | `#F1F3F5` | `--color-muted` |
| Muted Foreground | `#475569` | `--color-muted-foreground` |
| Border | `#E4E7EB` | `--color-border` |
| Destructive | `#DC2626` | `--color-destructive` |
| On Destructive | `#FFFFFF` | `--color-on-destructive` |
| Ring | `#1E3A5F` | `--color-ring` |

**Color Notes:** Navy professional + paid green

### Typography

- **Heading Font:** Outfit
- **Body Font:** Work Sans
- **Mood:** geometric, modern, clean, balanced, contemporary, versatile
- **Google Fonts:** [Outfit + Work Sans](https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap)

**CSS Import:**
```css
@import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&family=Work+Sans:wght@300;400;500;600;700&display=swap');
```

### Spacing Variables

*Density: 6/10 — Standard*

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` / `0.25rem` | Tight gaps |
| `--space-sm` | `8px` / `0.5rem` | Icon gaps, inline spacing |
| `--space-md` | `16px` / `1rem` | Standard padding |
| `--space-lg` | `24px` / `1.5rem` | Section padding |
| `--space-xl` | `32px` / `2rem` | Large gaps |
| `--space-2xl` | `48px` / `3rem` | Section margins |
| `--space-3xl` | `64px` / `4rem` | Hero padding |

### Shadow Depths

| Level | Value | Usage |
|-------|-------|-------|
| `--shadow-sm` | `0 1px 2px rgba(0,0,0,0.05)` | Subtle lift |
| `--shadow-md` | `0 4px 6px rgba(0,0,0,0.1)` | Cards, buttons |
| `--shadow-lg` | `0 10px 15px rgba(0,0,0,0.1)` | Modals, dropdowns |
| `--shadow-xl` | `0 20px 25px rgba(0,0,0,0.15)` | Hero images, featured cards |

---

## Component Specs

### Buttons

```css
/* Primary Button */
.btn-primary {
  background: #059669;
  color: #000000;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}

.btn-primary:hover {
  opacity: 0.9;
  transform: translateY(-1px);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: #1E3A5F;
  border: 2px solid #1E3A5F;
  padding: 12px 24px;
  border-radius: 8px;
  font-weight: 600;
  transition: all 200ms ease;
  cursor: pointer;
}
```

### Cards

```css
.card {
  background: #F8FAFC;
  border-radius: 12px;
  padding: 24px;
  box-shadow: var(--shadow-md);
  transition: all 200ms ease;
  cursor: pointer;
}

.card:hover {
  box-shadow: var(--shadow-lg);
  transform: translateY(-2px);
}
```

### Inputs

```css
.input {
  padding: 12px 16px;
  border: 1px solid #E2E8F0;
  border-radius: 8px;
  font-size: 16px;
  transition: border-color 200ms ease;
}

.input:focus {
  border-color: #1E3A5F;
  outline: none;
  box-shadow: 0 0 0 3px #1E3A5F20;
}
```

### Modals

```css
.modal-overlay {
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.modal {
  background: white;
  border-radius: 16px;
  padding: 32px;
  box-shadow: var(--shadow-xl);
  max-width: 500px;
  width: 90%;
}
```

---

## Style Guidelines

**Style:** Minimalism & Swiss Style

**Keywords:** Clean, simple, spacious, functional, white space, high contrast, geometric, sans-serif, grid-based, essential

**Best For:** Enterprise apps, dashboards, documentation sites, SaaS platforms, professional tools

**Key Effects:** Subtle hover (200-250ms), smooth transitions, sharp shadows if any, clear type hierarchy, fast loading

### Page Pattern

**Pattern Name:** Hero + Features + CTA

- **Conversion Strategy:** Deep CTA placement. For CTA label text, verify at least 4.5:1 against the button fill; use 7:1 only when the product explicitly targets AAA normal-text contrast. Keep focus and component boundaries independently visible. Disable hero parallax under reduced motion and render its static final state.
- **CTA Placement:** Hero (sticky) + Bottom
- **Section Order:** Hero with headline/image > Value prop > Key features (3-5) > CTA section > Footer

---

## Motion

**Scroll Reveal** (Subtle) — Trigger: scroll (viewport enter) | Duration: 300-400ms | Easing: `power1.out`

```js
gsap.from(el, { opacity: 0, y: 12, duration: 0.35, ease: 'power1.out', scrollTrigger: { trigger: el, start: 'top 90%', toggleActions: 'play none none reverse' } });
```

**Framework notes:** Requires the ScrollTrigger plugin registered once via gsap.registerPlugin(ScrollTrigger); Use matchMedia('(prefers-reduced-motion: reduce)') to skip non-essential motion and render the final state immediately

- ✅ Keep the y offset small (8-16px) so it reads as a fade, not a slide
- ❌ Don't reveal below-the-fold content needed for SEO/crawlers as invisible-by-default without a no-JS fallback
- ⚡ toggleActions 'play none none reverse' avoids re-triggering on every scroll direction change

---

## Anti-Patterns (Do NOT Use)


### Additional Forbidden Patterns

- ❌ **Emojis as icons** — Use SVG icons (Heroicons, Lucide, Simple Icons)
- ❌ **Missing cursor:pointer** — All clickable elements must have cursor:pointer
- ❌ **Layout-shifting hovers** — Avoid scale transforms that shift layout
- ❌ **Low contrast text** — Maintain 4.5:1 minimum contrast ratio
- ❌ **Instant state changes** — Always use transitions (150-300ms)
- ❌ **Invisible focus states** — Focus states must be visible for a11y

---

## Pre-Delivery Checklist

Before delivering any UI code, verify:

- [ ] No emojis used as icons (use SVG instead)
- [ ] All icons from consistent icon set (Heroicons/Lucide)
- [ ] `cursor-pointer` on all clickable elements
- [ ] Hover states with smooth transitions (150-300ms)
- [ ] Light mode: text contrast 4.5:1 minimum
- [ ] Focus states visible for keyboard navigation
- [ ] `prefers-reduced-motion` respected
- [ ] Responsive: 375px, 768px, 1024px, 1440px
- [ ] No content hidden behind fixed navbars
- [ ] No horizontal scroll on mobile

---

## Apple direction (20 Oct 2026)

The founder asked for a premium, Apple-like look. This section replaces the earlier "Bhaav adjustments" (navy, green, Outfit and Work Sans); where it and the generated file above disagree, this section wins. The skill's design-system search proposed a luxury palette (serif and gold) that did not fit; its style search matched **Liquid Glass** (for navigation chrome, used sparingly) and **Bento Box Grid** (Apple-style cards on #F5F5F7), and its typography search matched **Inter** as the neutral sans. Those are the sources.

### Colour

| Token | Light | Dark | Notes |
|-------|-------|------|-------|
| `--bg` (page) | `#F5F5F7` | `#000000` | Apple's grey canvas; black in dark |
| `--card` | `#FFFFFF` | `#1C1C1E` | Cards sit on the page with a soft shadow (light) or a hairline (dark) |
| `--fg` | `#1D1D1F` | `#F5F5F7` | 15.5:1 / 19.3:1 |
| `--muted-fg` | `#636366` | `#A1A1A6` | Apple's own `#6E6E73` is only 4.15:1 on the grey wells, so the darker system grey is used: 4.9:1 or better on every surface |
| `--muted` (wells, chips) | `#E8E8ED` | `#2C2C2E` | |
| `--accent` (buttons) | `#0071E3` | `#0071E3` | White text 4.7:1. Apple's dark-mode `#0A84FF` gives white text only 3.65:1, so the light blue is kept in both themes, as apple.com does |
| `--link` | `#0066CC` | `#2997FF` | 5.6:1 / 7.0:1 |
| `--input-border` | `#86868B` | `#8E8E93` | 3.6:1 / 5.2:1 for the field outline |
| success / warn / danger / info | `#1D7A35` `#A24800` `#C4001B` `#0066CC` on soft tints | `#30D158` `#FF9F0A` `#FF6961` `#64B5FF` on dark tints | Every pair 4.7:1 or better |

One blue for actions. Green only for savings and good status. Every status also has words or an icon.

### Type

- San Francisco on Apple devices through the system font stack (`-apple-system, BlinkMacSystemFont`), Inter elsewhere, then Noto Sans Devanagari and Kannada for Hindi and Kannada text.
- 17px body, line height 1.47, tracking −0.022em (Apple's body settings); headlines bold with tracking −0.028em, the home headline −0.035em at up to 72px.

### Surfaces and shape

- `.surface`: white card, 22px corners, `0 1px 2px / 4%, 0 8px 28px / 6%` shadow in light; `#2C2C2E` hairline in dark.
- `.glass`: the top bar and the phone tab bar only, `saturate(180%) blur(20px)` over 72% white or near-black. Solid when the person asks for reduced transparency or the browser has no backdrop filter.
- Buttons are pills (fully rounded), 44px (48px large). Filled blue for the action, a hairline pill with blue text beside it.
- Lists are grouped rows divided by hairlines inside one card (like iOS Settings), not separate boxes.
- Inner wells (figures, transcripts, the WhatsApp text) use the page grey inside the white card.

### Motion

- Each page fades and rises 8px over 420ms on Apple's ease (`cubic-bezier(.25,.1,.25,1)`); buttons press to 98%. All of it is cut to near zero under `prefers-reduced-motion`.

### Layout rules that tests enforce

- Long unbroken words wrap anywhere (`overflow-wrap: anywhere` on the body), so an 80-letter name never leaves its card.
- The quote book is a stacked list until its card is 32rem wide (a container query), so it never scrolls sideways.
- `e2e/fit.spec.ts` loads every page at 1440, 1280, 1100, 1000, 880, 700, 375, 360 and 320px with worst-case data and fails on any spill, overlap, card overflow, sideways scroll or off-screen bar.

### Kept from before

- Pages other than Home load on demand; a page that fails to load after a deploy offers a reload.
- A main button is never greyed out with its reason hidden; it can be pressed and the screen says what is missing.
- Phosphor icons, imported one by one through `web/src/icons.ts`, regular weight (closest to SF Symbols).
