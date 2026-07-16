---
target: reader second pass (frontend/src/App.tsx)
total_score: 28
p0_count: 0
p1_count: 2
timestamp: 2026-07-16T12-21-11Z
slug: frontend-src-app-tsx
---
Method: dual-agent (A: /root/second_critique_design_a · B: /root/second_critique_evidence_b)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 4 | Loading, retry, stale, freshness, and selected-date states are clear. |
| 2 | Match system / real world | 3 | Finnish dates and facts work; ranking and catchment copy can be more natural. |
| 3 | User control and freedom | 3 | Date, week, Today, back, and native disclosures work; new-tab behavior is unannounced. |
| 4 | Consistency and standards | 4 | Home and restaurant detail share one coherent component vocabulary. |
| 5 | Error prevention | 2 | Automatically extracted diet badges appear before their safety qualification. |
| 6 | Recognition rather than recall | 2 | Alternatives #2 and #3 omit the dish and rationale needed for comparison. |
| 7 | Flexibility and efficiency | 2 | The first choice is fast, but fallback comparison and directions require extra work. |
| 8 | Aesthetic and minimalist design | 3 | Hierarchy is calm; duplicate provenance and underused companion space remain. |
| 9 | Error recovery | 3 | Retry and stale fallback are strong; an empty restaurant week renders silently. |
| 10 | Help and documentation | 2 | Criteria and source exist, but critical dietary guidance is initially hidden. |
| **Total** |  | **28/40** | **Good — focused hardening and polish needed.** |

## Audit Health Score

| # | Dimension | Score | Key finding |
|---|---|---:|---|
| 1 | Accessibility | 3 | Strong semantics and contrast; route titles and completion announcements need work. |
| 2 | Performance | 3 | Lean reader runtime; admin code and legacy reader rules ship eagerly. |
| 3 | Responsive design | 3 | No overflow at tested widths; companion and other-day row composition needs polish. |
| 4 | Theming | 3 | Current reader uses the committed tokens; two CSS generations remain. |
| 5 | Anti-patterns | 4 | No active Impeccable bans or detector findings. |
| **Total** |  | **16/20** | **Good** |

## Anti-Patterns Verdict

### LLM assessment

The current reader passes the component-level slop test. It avoids gradients, glass, broad shadows, oversized radii, identical recommendation cards, side stripes, decorative motion, and uppercase tracked scaffolding. The cream, Georgia, forest-green, and clay recipe is still category-familiar, while the generic initial mark leaves room for a more proprietary wayfinding cue.

### Deterministic scan

The exact scan was:

`node C:\Users\Juha\.agents\skills\impeccable\scripts\detect.mjs --json frontend/src/App.tsx`

It exited 0 with `[]`: zero rules, locations, or false positives. Manual review confirmed that suspicious legacy shadows, radii, and eyebrow rules are overridden by the current reader layer, so they are cascade debt rather than rendered violations.

### Visual evidence

Both assessment sub-agents had no browser backend (`getForUrl` returned “No browser is available”; `agent.browsers.list()` returned `[]`), so no overlay was available. Coordinator-owned fresh-tab browser evidence supplied the visual fallback:

- 390×844: no horizontal overflow; the leading recommendation and its CTA end at y=678. Companion rows contain no dish/rationale, and the arrow drops to the lower-left on mobile.
- 1280×720: no horizontal overflow; the primary and companions end at y=613. The companion surface is 364px tall but largely empty.
- Restaurant at 320×800: no horizontal overflow; the selected menu begins at y=503. Other-day summaries measure 139–159px because three columns squeeze long Finnish dates, facts, and the disclosure label.
- Current route titles remain the generic “Mihin lounaalle?”.

## Overall Impression

The second pass confirms that the hierarchy and visual system are solid. The single biggest opportunity is the fallback path: the first choice is excellent, but alternatives, dietary reassurance, and post-choice directions are less complete than the leading recommendation. Accessibility states are strong until a date/week finishes loading or the week is empty.

## What’s Working

1. The first recommendation is a decisive, high-contrast anchor rather than one of three marketplace cards.
2. Native semantics, 46px controls, focus styling, reduced motion, loading, retry, stale, source, and freshness states form a strong foundation.
3. Mobile-first structure preserves the current date and leading choice without horizontal overflow at 320px, 390px, and desktop.

## Priority Issues

### [P1] Dietary badges precede their safety qualification

**Why it matters:** G/L/VE badges look authoritative while “automatically extracted,” possible errors, and “verify with the restaurant” are hidden inside a closed disclosure.

**Fix:** Keep the long explanation collapsible, but show an always-visible allergy warning and explicit verification action.

**Suggested command:** `$impeccable harden`

### [P1] Alternatives #2 and #3 lack decision evidence

**Why it matters:** A user rejecting #1 must leave the home page to discover the dishes and rationales of #2/#3. On desktop this also leaves a large, underused surface; on mobile the arrow currently wraps to the lower-left.

**Fix:** Add one clamped dish line and concise rationale to each companion, preserve the quieter row treatment, and pin the arrow to the top-right.

**Suggested command:** `$impeccable layout`

### [P2] Route orientation is incomplete

**Why it matters:** Home and restaurant routes retain a generic document title, and external links open new tabs without an announced warning.

**Fix:** Set date- and restaurant-specific titles and add a consistent screen-reader new-tab hint.

**Suggested command:** `$impeccable audit`

### [P2] Async completion and empty-week handling have silent gaps

**Why it matters:** Loading is announced, but successful date/week completion is silent. An empty `days` array leaves no message or recovery path.

**Fix:** Add stable polite completion announcements, mark the changing main region busy, and render a useful empty-week state with source and return actions.

**Suggested command:** `$impeccable harden`

### [P2] The flow stops before the real-world handoff

**Why it matters:** Addresses are plain text, so a hurried user who has decided still needs a separate map search.

**Fix:** Add a restrained route action to the leading recommendation and restaurant hero without introducing a map embed.

**Suggested command:** `$impeccable shape`

### [P2] Other-day summaries are too tall on narrow phones

**Why it matters:** At 320px the first three rows measure 139–159px, making a six-day list interruption-prone.

**Fix:** Reflow the mobile summary into a two-column layout with title/facts on the left and the disclosure label on the right.

**Suggested command:** `$impeccable adapt`

### [P3] Reader payload and brand cue can be tightened

**Why it matters:** Admin code is eagerly imported on public routes, legacy reader CSS increases cascade complexity, and the initial-only mark is generic.

**Fix:** Lazy-load the admin route now; reserve legacy CSS removal for a separate safe cleanup; add one restrained route-marker detail to the existing mark.

**Suggested command:** `$impeccable optimize`

## Cognitive Load

Three of eight checks fail: chunking, minimal choices, and working memory. Six-item full-offering and other-day lists are defensible because complete coverage matters and details progressively disclose content. The avoidable load is that users must remember information across pages when comparing #2/#3.

## Persona Red Flags

### Jordan — first-time visitor

- Ranking criteria do not explain why #1 beat #2.
- “Seinäjoki · 50 km” can read as a measured distance rather than a coverage radius.
- New-tab behavior is not announced.

### Sam — keyboard, screen-reader, or low-vision user

- Route titles remain generic.
- Loading completion is silent and an empty week can become blank.
- The intentionally focusable, inert Today control adds a low-value stop, though it preserves focus continuity.

### Casey — distracted mobile user

- Rejecting #1 requires navigation before seeing alternative dishes.
- The mobile companion arrow is visually misplaced.
- Other-day rows are 139–159px tall at 320px.

### Hurried Seinäjoki lunch chooser

- The leading choice is actionable in seconds.
- The fallback comparison and route-to-restaurant handoff are slower than the primary decision.

## Minor Observations

- “1. paras valinta” is mechanical Finnish; “Päivän ykkösvalinta” is more natural.
- Home and restaurant pages duplicate some provenance at the end.
- The week range omits the year.
- The eager CSS layer is small in gzip terms but harder to maintain because old and current reader rules coexist.

## Questions to Consider

- If #1 is unsuitable, can someone choose #2 confidently without leaving the page?
- Should automatically extracted allergy markers ever appear without visible qualification?
- Is success the choice itself, or getting the user on the way to the restaurant?
- Can one small route-marker behavior make the brand feel more proprietary without adding decoration?
