# DESIGN: Shaida's visual system

Shaida uses the visual style of the builder's Muuve project (`../Muuve`, read at commit `49ba25e`, 2026-11-22), with
Shaida's own name and mark. Muuve's branding (name, dot logo, hero icons, footer video, copy) stays Muuve's.
Decision: DECISIONS D25. Tokens live in one file, `web/src/app/tokens.css`; no other file in `web/src` writes a colour.

Source of truth in Muuve is its **shipped code**, not its guide: `docs/muuve-frontend-guide.md` §7 (v0.2) describes a
dark "aurora glass" theme with Space Grotesk, but `apps/web` ships a light cream/ink theme with Inter Tight. We follow
the code. Paths below are relative to `../Muuve`.

## What could and could not be reused

| Item in Muuve | Licence found | Used in Shaida? |
|---|---|---|
| Muuve code (`apps/web/**`) | **none**: no LICENSE file, no `license` field in `package.json` | Values only (colours, sizes, radii, shadows, easing) and layout patterns, re-implemented in plain CSS. No file copied. |
| Inter Tight (via `next/font/google`, `app/layout.tsx`) | SIL Open Font License 1.1 (Google Fonts) | Yes, same way: `next/font/google` self-hosts it at build time. NOTICE.md. |
| Hero icons `public/hero/{send,share,claim,split}.webp` (320×320, glossy 3D) | none recorded; added in commit `5670e1d` by another author with no source | **No.** Unknown origin and Muuve-specific verbs. Replaced by Shaida's own line icons (`web/src/components/Icons.tsx`). |
| Footer video `public/footer/footer.mp4` | none recorded (same commit) | **No.** Replaced by a static tinted panel with grain. |
| `components/ui/glass.css` (liquid-glass button/input) | none; reads like a community registry component, no source line | **No.** Shaida uses the simpler `.glass-lens` look (Muuve's own `app/globals.css`) for the selected nav item. |
| `components/ui/how-it-works.tsx` (pinned rotated cards, dashed path) | none; likely a community component, no source line | Pattern only, re-implemented without its code: numbered tinted cards, a slight tilt, ruled-paper backdrop. |
| `components/ui/empty.tsx`, `button.tsx` (shadcn-style) | none in Muuve; the shapes follow shadcn/ui (MIT) | Pattern only: class names and CSS written here. |
| Lucide icons (`lucide-react` 1.64.0) | ISC | Not a dependency. Shaida draws its own 24-px, 1.8-stroke line icons in the same style. |
| `muuve` wordmark with a solid ink dot (`components/marketing/Hero.tsx`, `AppShell.tsx`) | Muuve branding | **No.** Shaida's mark is a half-filled ring (shows half, hides half) + lowercase `shaida` (`web/public/brand/shaida-wordmark.svg`, drawn for this repo). |
| Sprout line illustration (`Hero.tsx`) | Muuve artwork | No. Shaida's strip uses a line drawing of a sealed envelope in the same stroke style. |

No Muuve file is copied into `web/public/`. The only new asset is Shaida's own wordmark.

## Tokens (`web/src/app/tokens.css`)

### Colour (light only: Muuve ships no dark mode)
| Token | Value | Muuve source |
|---|---|---|
| `--ink` | `#0d0d0c` | `apps/web/app/globals.css` `:root --ink` |
| `--ink-72`, `--ink-60`, `--ink-56`, `--ink-45`, `--ink-42`, `--ink-12`, `--ink-10`, `--ink-06` | `rgb(13 13 12 / α)` | `--ink-56`, `--ink-42`, `--border` (0.12); `text-ink/60`, `/45`, `/10`, `bg-ink/[0.06]` in `components/app/kit.tsx` |
| `--cream` | `#fbf6ef` (page) | `--cream`; `viewport.themeColor` in `app/layout.tsx` |
| `--paper` | `#fffdf9` (cards, inputs) | `--paper` |
| `--ink-card` | `#262624` (dark card) | `kit.tsx` `Card tone="ink"` |
| `--sage-50/100/500/700` | `#e9ebe0 #dfe9d4 #3fb874 #1f7a49` | `globals.css @theme --color-sage-*` |
| `--lemon-50/100/500/700` | `#f2ecdf #f4ebc6 #e9c22e #7d6200` | `--color-lemon-*` |
| `--peach-50/100/500/700` | `#f8dcc7 #f9cba9 #f2772f #a9441a` | `--color-peach-*` |
| `--rose-50/100/500/700` | `#f0e4e6 #ecd6e2 #c564c4 #873a86` | `--color-rose-*` |
| `--danger` | `#c8402f` | `--destructive` |
| `--glow-*` | hero panel glows `246 222 104` (lemon), `249 150 84` (peach), `150 206 150` (sage), `222 150 200` (rose) | `components/marketing/hero.module.css .layer*` |

Meaning in Shaida (Muuve's `Pill` tones, `kit.tsx toneClass`): **sage = done / VALID / swept**, **lemon = working /
waiting**, **peach = unknown outcome / check again**, **rose = proofs and readers**, **danger = refused (INVALID)**,
neutral = ink at 6 %.

### Type
| Role | Spec | Muuve source |
|---|---|---|
| Family | Inter Tight 400/500/600 (`--font-sans`); JetBrains Mono for hashes and addresses (`--font-mono`, a Shaida addition: Muuve shows no hashes) | `app/layout.tsx`, `globals.css @theme --font-sans` |
| Hero headline | `clamp(52px, 11vw, 132px)`, weight 500, line-height 0.9, tracking −0.032em | `hero.module.css .headline` (172 px at 1440, 15.5 vw on phones) |
| Section title | 40 px → 64 px (md), weight 500, line-height 0.95, tracking −0.035em | `HowItWorksSection.tsx h2` |
| Page title (app) | 44 px → 68 px, weight 400, line-height 0.95, tracking −0.035em | `app/(app)/home/page.tsx h1` |
| Card title | 22 px, weight 500, tracking −0.02em | `kit.tsx CardTitle` |
| Big number | 52–76 px, weight 300, tracking −0.045em, tabular | `home/page.tsx BigStat`, balance card |
| Body | 15 px / 1.5; lede 17–18 px at `--ink-60` | `kit.tsx`, `hero.module.css .caption` |
| Label | 13 px, weight 500, `--ink-60` | `kit.tsx Field` |
| Eyebrow | 14 px, weight 500, `--ink-56`, sentence case (not uppercase) | `HowItWorksSection.tsx` "How it works" |
| Pill | 12 px, weight 600 | `kit.tsx Pill` |

### Space, radius, shadow, motion
| Token | Value | Muuve source |
|---|---|---|
| Page gutter | 16 px phone, 32 px from 768 px | `AppShell.tsx` `px-4 md:px-8` |
| Max width | app 1440 px, marketing text 1152 px | `AppShell.tsx max-w-[1440px]`, `max-w-6xl` |
| Grid gap | 16 px | `home/page.tsx gap-4` |
| Card padding | 20 px, 24 px from 768 px | `kit.tsx Card p-5 md:p-6` |
| `--r-card` | 28 px | `kit.tsx Card rounded-[28px]`, `Sheet` |
| `--r-panel` | 32 px → 48 px | `site-footer.tsx` panel |
| `--r-step-outer` / `--r-step-inner` | 25 px / 15 px | `how-it-works.tsx` |
| `--r-input` | 16 px | `kit.tsx inputClass rounded-2xl` |
| `--r-pill` | 9999 px (buttons, pills, nav) | `button.tsx rounded-full` |
| `--r-cta` | 10 px (hero CTAs only) | `hero.module.css .cta` |
| `--shadow-card` | `inset 0 1px 0 rgb(255 255 255 / .9), 0 20px 40px -24px rgb(80 60 30 / .25)` | `kit.tsx Card tone="paper"` |
| `--shadow-lift` | `0 14px 30px -8px rgb(80 60 30 / .18)` | `how-it-works.tsx` card |
| `--shadow-float` | `0 6px 16px -8px rgb(80 60 30 / .35)` | `kit.tsx CornerLink` |
| `--shadow-ink` | `0 24px 48px -24px rgb(13 13 12 / .6)` | `kit.tsx Card tone="ink"` |
| `--ease-out` | `cubic-bezier(.22, 1, .36, 1)` | `globals.css --ease-out` |
| `--ease-spring` | `cubic-bezier(.34, 1.56, .64, 1)`, 300 ms | `button.tsx` press |
| Grain | SVG `feTurbulence` fractal noise, opacity .18, `mix-blend-mode: multiply` | `globals.css .grain` |

## Components (classes in `web/src/app/globals.css` and `web/src/app/landing.css`, values from the tokens)

- **Button** `.btn` (Muuve `components/ui/button.tsx`): pill, 44 px (`.small` 36, `.big` 56), weight 500, 15 px.
  Variants: default ink on cream; `.secondary` soft (paper 80 %, hairline); `.ghost` transparent, ink 70 %;
  `.outline` 1.4 px ink; `.lemon`, `.sage`; `.danger` outline in danger. Press: scale .96 with a lemon glow, on the
  spring easing; no scale under reduced motion. Disabled: opacity .45.
- **Card** `.card` (Muuve `kit.tsx Card`): 28 px radius, paper at 70 % with blur and `--shadow-card`. Tones `.tone-sage`,
  `.tone-lemon`, `.tone-peach`, `.tone-rose` (gradient 50 → 100), `.tone-ink` (dark card, cream text).
- **Card title** `.card h2`: 22 px, weight 500. Corner link `.corner-link`: 44 px paper circle with an up-right arrow.
- **Input** `.field input` (Muuve `kit.tsx inputClass`): 48 px, 16 px radius, hairline ink 10 %, paper 80 %, focus
  border ink 40 %; invalid border danger 60 %; label 13 px ink 60 %; hint 13 px ink 45 %; error 13 px danger.
- **Pill / badge** `.state`, `.status-pill`, `.demo-tag` (Muuve `kit.tsx Pill`): 12 px weight 600 on the tone's 100 with
  its 700 text and a 6 px dot.
- **Notice** `.notice` (Muuve `kit.tsx Notice`): 16 px radius, tone 100 background, tone 700 text.
- **Steps** `.steps` (Muuve `kit.tsx StepProgress`): 32 px circles; done = lemon 500 with a check; active = paper with
  a spinner; failed = danger; unknown = peach. Shaida keeps done labels readable (no strike-through; they are evidence).
- **Nav** (Muuve `AppShell.tsx`): brand pill (1.4 px ink 70 % outline, 48 px), a paper pill group with the active item
  under a glass lens (`.glass-lens`, Muuve `globals.css`), scrolls sideways on phones.
- **Sheet / modal**: not used yet. If needed, follow Muuve `kit.tsx Sheet` (bottom sheet on phones, 28 px, ink 30 % scrim).
- **Table** `table.data`: Muuve has none; Shaida's follows the card language (13 px header in ink 56 %, dashed ink 15 %
  row rules, as Muuve's FAQ list in `home/page.tsx`).
- **Empty state** `.empty` (Muuve `components/ui/empty.tsx`): centred, 20 px title, 14 px ink 60 % text, one action.
- **Progress** `.progress` (Muuve `home/page.tsx SegmentBar`): a 14 px pill track in ink 6 % with a lemon fill.

## Layout
- **Landing** (Muuve `components/marketing/Hero.tsx`, `HowItWorksSection.tsx`, `ui/site-footer.tsx`): a full-height
  pastel panel (gradient layers + grain), a thin top nav with a hairline rule, a very large two-line headline on the
  left, outline CTAs with a muted caption beside them, then a cream strip cut by a curved notch. Then "How it works" as
  numbered tinted cards on ruled paper, then sections, then a rounded footer panel with a pill nav.
  Shaida keeps the panel still (one sage → lemon blend) rather than cycling four verbs: the hook is one sentence.
- **Dashboard** (Muuve `app/(app)/home/page.tsx`): a large greeting, a row of big light numbers, then a grid of cards
  (1 column on phones, 2 from 768 px, 4 from 1280 px) mixing a tinted card, paper cards and one ink card. Shaida's
  `/app` sections (Pay, Inbox, Prove, Shared proofs) are those cards; each opens its full screen under `/app/*`.

## Do / don't
- **Do** take every colour from `tokens.css`; `tools/lint.mjs` refuses a hex, `rgb(` or `hsl(` colour in any other CSS or
  TSX file under `web/src` (D25).
- **Do** show `—` for any value not read yet; label demo personas as demo (BUILD_CONTRACT).
- **Do** keep 390 px free of horizontal scroll; tap targets ≥ 44 px.
- **Do** respect `prefers-reduced-motion` (no press scale, no rise-in, no crossfade).
- **Don't** use Muuve's name, dot logo, hero icons, video, verbs (Send/Share/Claim/Split) or copy.
- **Don't** put stats on the landing page that no command produced (Muuve's strip has "1 link / 48h / 0 apps": Shaida's
  strip states facts with a source instead).
- **Don't** use colour alone for a verdict: VALID / INVALID / INCONCLUSIVE are always written out.
