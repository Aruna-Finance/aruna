# UI style - reference: bitnomial.com

Visual language is taken from https://bitnomial.com/ (measured from its public stylesheet and
markup). Layout and content stay as in the Claude-web prototype. Their font files and logos are
licensed or trademarked, so nothing is copied: we use free fonts with the same roles, and our own
name and marks.

## What was measured

| Aspect | Bitnomial | Our choice |
|---|---|---|
| Display font (h1, h2) | PP Neue Machina Inktrap, 400, line-height 1.2-1.3 | IBM Plex Sans 400 (self-hosted via `@fontsource`) |
| Body font | IBM Plex Sans, 400, 18px / 1.4-1.6 | IBM Plex Sans (same, open license) |
| Label and button font | PP Neue Montreal Mono 500, uppercase, letter-spacing .04em | IBM Plex Mono 500, uppercase (same family as the body) |
| Code and hashes | n/a | IBM Plex Mono 400 |
| Headline sizes | h1 74px (home 54px), h2 63px, h3 about 32px; 48px on mobile | clamp-based, same ratio |
| Ink | `#121212` / `#141414` | `#141414` |
| Accent | `#FF7756`, hover/dark `#e04b2e`, on dark `#fe5f38` | same |
| Surfaces | white, `#f7f7f7` alternate rows, `#eaeaea` footer and fades, dark `#141414` features block | same |
| Borders | `#e0e0e0` rows, `#cdcdcd` footer top | same |
| Container | max 1440px, side padding 64px (20px on mobile) | same |
| Section rhythm | hero 4rem, product rows 5.25rem, features 4rem, footer 2.625rem | same |
| Shadows | Material elevations exist but are almost unused | none; flat |
| Radius | none (square corners everywhere) | 0 |
| Breakpoints | 480, 768, 990-991, 1130, 1200 | Tailwind defaults plus `md` = 768 |

## Signature moves

1. **Column lines.** Sections carry five faint vertical lines (`rgba(0,0,0,.08)`, 1px, every 20% of a
   max 1315px box). It is the one memorable detail; everything else stays quiet.
2. **Square buttons.** Primary: accent fill, `#141414` text, 1.5px accent border, mono 500
   uppercase, letter-spacing .42px, padding .875rem 1.5rem, 21px (we use 16px for app UI).
   Hover: fill goes transparent, border and text remain (inverse). Outline variant: transparent
   fill, hover fills accent. On dark: fill `#fe5f38`, hover text white.
3. **Mono tag above the headline.** Uppercase mono, letter-spacing 1.92px, 16px, with a small
   marker each side. Used once per section at most.
4. **Dark block.** One `#141414` section with white type and underlined feature rows.
5. **Footer.** `#eaeaea`, top border `#cdcdcd`, column titles in mono uppercase `#626262`.
6. **Motion.** One staged reveal on load (opacity and short translate, 400-900ms delays), button
   fill transition .3s. Respect `prefers-reduced-motion`.

## Rules for us

- Accent `#FF7756` on white fails text contrast (about 2.6:1). Accent is for fills and lines only;
  accent-colored text uses `dawn-ink` `#c2401f`.
- `unknown` is never styled as safe: dashed grey. `local_upgradeable` always shows its basis.
- Regular-weight icons only (Phosphor regular). No em dash in copy.
- Tailwind utilities with tokens from `globals.css`; no hand-written component CSS.
