# Direction contract — Vitrine Glass

Status: approved by Nodal (2026-11-26). Source of truth: `EPIC-Chess Project [CORE].md` lines 3–33.

- **THESIS**: Agent Chess is a cinematic chess *stage*, not a chess dashboard. The board is the only content; everything else is glass instrumentation that floats above it and disappears when not needed. The category default — board plus visible move list, eval, debug chips and a footer — is refused.
- **OWN-WORLD**: smoked charcoal `#0B0D10`, surface `#15181D`, elevated `#1E2229`; pearl `#F2EDE4`, muted `#9AA0A8`; one violet-blue accent `#8AA2FF`; board pearl `#D8D4CB` / smoked `#2B3038`. Material: frosted HUD (`blur(18px) saturate(120%)`) strictly in the chrome layer; matte board with fine grain and contact shadows; 1px specular rims. Display face Cormorant Garamond, UI face Inter with tabular numerals. No wood-and-felt skeuomorphism, no purple neon gradient soup.
- **STORY**: first launch shows the user-supplied SVG logo, then a clean stage: board + Play/Pause only. Tapping a piece enters its POV; the camera pushes in through a slow spring. Captures, checks and mates get the one-frame inverted impact, speed lines and a subtitle line from the piece — dry, not theatrical. Modes live behind a single glass sheet, not a nav bar.
- **FIRST VIEWPORT**: portrait phone. Splash logo (asset pending from Nodal) → stage. Board occupies ~72% of viewport height, tilted 4° with a soft glass plinth. Top: minimal glass HUD with turn + mode name. Bottom: single glass transport pill (Play / Pause, hint, mode). Moves panel collapsed to a hairline until pulled up. No debug copy.
- **FORM**: Vitrine Glass — full replacement visual world (3rd of the reviewed directions). Seed key: not drawn (`impeccable` launcher unavailable on noexec `/mnt/sdcard`); contract recorded manually after dual-agent review.
- **FINISH**: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

## CORE coverage in this build

| CORE line | Implemented now | Deferred |
|---|---|---|
| 5 dramatic camera + impact | POV push-in, impact frame, speed lines, shockwave | true 3D camera |
| 6 modes | Classic + Play with bot + 2P + Agent vs Agent playable; Adventure / Rank / Puzzle / Atomic shown as locked glass cards | full modes |
| 13 anti-slop animated UI | Vitrine Glass system | — |
| 14 slow liquid motion | 520–760ms springs for pieces, 420ms HUD morph | — |
| 15 settings / pieces / themes | settings sheet, 3 themes, sprite set | custom piece upload |
| 16 3D + bloom + shadow | layered depth, contact shadow, bloom on impact only | real 3D |
| 18 talking pieces / EN first | subtitle rail with dry EN quips; SFX | Indonesian dub |
| 26 SVG logo | inline SVG knight placeholder | Nodal's SVG asset |
| 27 clean first interface | splash → stage + Play/Pause only | — |
| 31 POV | POV lens overlay with arrow guidance | free camera orbit |
| 32 scene subtitles | subtitle rail | full Adventure scenes |

Explicitly out of scope for this APK: Lc0/Stockfish, quest minigames, atomic upgrade cards, real 3D. These are documented separately, not faked.
