---
target: reader (frontend/src/App.tsx)
total_score: 24
p0_count: 0
p1_count: 3
timestamp: 2026-07-16T09-15-58Z
slug: frontend-src-app-tsx
---
Method: dual-agent (A: /root/critique_design_a · B: /root/critique_evidence_b)

## Design Health Score

| # | Heuristic | Score | Key issue |
|---|---|---:|---|
| 1 | Visibility of system status | 3 | Loading, stale, unavailable, and retry states are honest; freshness is buried at the end of the page. |
| 2 | Match system / real world | 3 | Natural Finnish and familiar dates work; the unexplained `/10` score and dietary shorthand feel abstract. |
| 3 | User control and freedom | 2 | Day/week arrows and back navigation exist, but there is no “Tänään” shortcut and restaurant detail loses the originating date. |
| 4 | Consistency and standards | 3 | The existing UI is internally coherent, but it contradicts the documented DESIGN.md component vocabulary. |
| 5 | Error prevention | 3 | Allergy and stale-data warnings are responsible; the UI does not prevent users from losing their chosen-day context. |
| 6 | Recognition rather than recall | 2 | Restaurant detail requires the user to remember which weekday they selected. |
| 7 | Flexibility and efficiency | 1 | Navigation is sequential only; there is no fast route back to today or the selected day. |
| 8 | Aesthetic and minimalist design | 2 | Clean styling is undermined by oversized setup, duplicate menu content, equal-weight cards, and excess containment. |
| 9 | Error recovery | 3 | Errors use plain Finnish, preserve the page shell, and offer a clear retry. |
| 10 | Help and documentation | 2 | Ranking and allergy context exist, but the score and dietary abbreviations are not explained. |
| **Total** |  | **24/40** | **Acceptable — significant improvement needed** |

## Anti-Patterns Verdict

### LLM assessment

The reader has a high risk of being read as AI-generated. The Finnish copy and Seinäjoki context are credible, but the visual grammar is a familiar “artisanal editorial food app”: warm cream canvas, Georgia display type, olive and clay accents, an oversized magazine hero, repeated tracked uppercase eyebrows, pill facts, large rounded cards, and ambient shadows.

The intended local wayfinding identity is present in the palette, but the composition behaves like a leisurely restaurant magazine rather than a decisive lunchtime utility. The strongest visual moment is the promise “Poimi päivän paras lounas,” not the restaurant the product recommends.

### Deterministic scan

The exact scan command was:

`node C:\Users\Juha\.agents\skills\impeccable\scripts\detect.mjs --json frontend/src/App.tsx`

It exited 0 with `[]`: zero rules, locations, or false positives. That clean result is a coverage limitation, not proof of quality. Because the stable target was `App.tsx`, the scanner did not surface the separate stylesheet where the strongest violations live. Independent source and browser evidence found:

- Eight repeated `.eyebrow` / `.date-label` labels, styled as small tracked uppercase text.
- A 3px Signal Clay side stripe on `.menu-data-notice`.
- Bordered reader cards paired with a 32px-blur dual shadow.
- Reader surfaces with 20–28px radii; the mobile first recommendation measured 22px.
- Three equal recommendation cards followed by six full menu cards in the QA dataset.
- A prominent `/10` score that makes the ranking machinery more visible than the decision evidence.

### Visual overlays

No reliable user-visible overlay is available. Both assessment agents found the in-app Browser backend unavailable in their own sessions, and the supported evaluation surface is read-only, so mutable injection was correctly treated as unavailable. The fallback was four fresh coordinator-owned browser captures plus DOM geometry, computed styles, contrast calculations, overflow checks, and console inspection on the mock-backed QA server.

## Overall Impression

The reader looks considered and local, but it answers too late. On mobile, the first restaurant name begins below the first 844px viewport; on desktop, it begins below the default 720px browser viewport. Restaurant detail repeats the same failure: identity and controls occupy the screen while the first actual daily menu begins below it. The single biggest opportunity is to invert the hierarchy so orientation is compact and the recommended choice becomes the first meaningful object.

## What’s Working

1. **Local voice and trustworthy context.** Finnish copy, explicit dates, Seinäjoki framing, addresses, phone numbers, sources, and freshness language establish credibility without making AI the story.
2. **A strong leading-color concept.** Route Green is highly legible with Light on Dark and gives recommendation #1 a clear anchor without marketplace imagery.
3. **Resilient states and useful semantics.** Retry, stale, unavailable, pending, missing-day, ordered-list, labeled-button, visible-focus, and reduced-motion foundations show solid product thinking.

## Priority Issues

### [P1] The core answer is below the fold

**Why it matters:** At 375×844, recommendation #1 begins at y=820 but its restaurant name begins at y=906. At the default 1265×720 desktop viewport, the card begins at y=722 and its name at y=812. Restaurant detail puts the first daily menu at y=921 on mobile and y=794 on desktop. The product cannot meet its under-one-minute promise when the answer is not visible.

**Fix:** Compress the header and orientation copy, combine date context with the recommendation section, move the allergy caveat after the leading choice, and show the selected day’s restaurant/menu immediately on detail.

**Suggested command:** `$impeccable layout`

### [P1] The recommendation layer recreates choice overload

**Why it matters:** Each recommendation can expose rank, score, rationale, up to six courses, dietary markers, allergens, hours, price, source, and a link. Then the same restaurants reappear in the full menu grid. The user is asked to process many facts before making a supposedly simplified decision.

**Fix:** Make #1 a concise decision block with restaurant, area/address, hours, price, short rationale, and a restrained menu preview. Turn #2 and #3 into compact aligned companions. Present the full offering as a calm reading list with progressive disclosure instead of another card grid.

**Suggested command:** `$impeccable distill`

### [P1] Contrast and focus visibility miss the baseline

**Why it matters:** Signal Clay on Field Ground is 3.19:1 at 0.72rem, Muted on Field Ground is 4.48:1, and the translucent focus outline composites to roughly 1.62–1.69:1 on light surfaces. White on the clay website CTA is also too weak for normal-size text. These are not polish issues for small labels and keyboard users.

**Fix:** Keep small text in Ink on Field Ground, reserve Signal Clay for non-text signals and a solid ≥3:1 focus outline, use Route Green for primary actions, and use Muted only on Clear Surface where it reaches 5.05:1.

**Suggested command:** `$impeccable audit`

### [P2] Restaurant detail loses the chosen-day context

**Why it matters:** Recommendation links preserve only the week. Back navigation always returns to today, all seven weekday cards carry equal weight, and the user must remember which day they meant to inspect.

**Fix:** Carry the originating `date`, preserve it in the back link, identify and prioritize that weekday, and provide a direct “Tänään” control when browsing another date or week.

**Suggested command:** `$impeccable shape`

### [P2] The implementation contradicts its documented design system

**Why it matters:** Repeated eyebrows, 20–28px radii, broad shadows plus borders, a side-striped notice, and symmetrical card grids undermine the approved “Keskipäivän opaste” direction.

**Fix:** Apply the documented 14px surfaces, 12px controls, flat hierarchy, One Signal rule, Route Green action rule, and aligned reading-row structure.

**Suggested command:** `$impeccable quieter`

## Cognitive Load

**7 of 8 checks fail — high cognitive load.**

- **Single focus:** Fail — hero, date control, allergy caveat, ranking explanation, and recommendation compete before the answer.
- **Chunking:** Fail — recommendation payloads contain far more than four scan items.
- **Grouping:** Pass — sections and surfaces group related content clearly.
- **Visual hierarchy:** Fail — hierarchy is strong but points to the slogan instead of the choice.
- **One thing at a time:** Fail — score, rationale, menu, price, hours, and source compete simultaneously.
- **Minimal choices:** Fail — the full restaurant list and seven equal weekdays exceed four visible options.
- **Working memory:** Fail — selected day and origin must be remembered across the detail route.
- **Progressive disclosure:** Fail — recommendations expose detailed menus before the later full menus; only raw source text is collapsed.

Decision points above four include up to six visible courses inside one recommendation, seven equally styled weekdays, and an unbounded full restaurant offering.

## Emotional Journey

- **Opening:** warm, local, confident promise.
- **First valley:** the promised answer does not arrive in the first viewport.
- **Intended peak:** the solid Route Green #1 recommendation creates welcome certainty after scrolling.
- **Second valley:** dense course lists and duplicate menu cards reopen the choice the product claimed to simplify.
- **Detail valley:** a Thursday chooser lands on a generic week and must scan from Monday.
- **End memory:** exhaustive catalogue and provenance, rather than a quick “that’s where I’m going.”

## Persona Red Flags

### Jordan — first-time visitor

Jordan sees a promise rather than an answer. `/10`, dietary abbreviations, and ranking mechanics are unexplained, and restaurant detail gives no obvious confirmation that it opened the chosen day.

### Sam — keyboard, screen reader, or low-vision user

Small clay labels, muted canvas text, the clay CTA, and the translucent focus ring miss contrast targets. `aria-label` is placed on generic date/week containers without an explicit navigation/group role, and dietary abbreviations have no accessible legend.

### Casey — distracted mobile user

At 375×844, neither reader route exposes actionable food content. Long stacked cards require extensive scrolling, while no Today shortcut or preserved selected-day context helps after interruption. Date controls themselves are a solid 46×46px, but several text links and the brand link do not provide equivalent touch areas.

### Hurried Seinäjoki lunch chooser

The service covers a 50km area, yet recommendations do not surface address, district, or distance. A user can see what is “best” before learning whether it is practical to reach.

## Minor Observations

- The clay restaurant website CTA conflicts with DESIGN.md’s Route Green primary-action rule.
- The mobile detail header hides the 50km catchment entirely.
- Week ranges omit the year and become ambiguous around year boundaries.
- The allergy notice is important, but its placement and side stripe make it louder than the recommendation.
- The desktop website CTA is isolated far from the restaurant facts.
- The score uses `letter-spacing: -0.05em`, tighter than the documented -0.04em floor.
- Long course names and fact rows do wrap without horizontal overflow, which is worth preserving.
- Fresh-tab console capture reported no warnings or errors on either public route.

## Questions to Consider

- If recommendation #1 is the product’s answer, why is “Poimi päivän paras lounas” larger and earlier than the restaurant name?
- Does the `/10` score create trust, or make the ranking feel falsely precise and implementation-led?
- Can a recommendation across a 50km area be actionable without address or distance?
- After opening a Thursday recommendation, why should the next screen begin conceptually on Monday?
- Could the allergy caveat remain responsible without standing between the user and every first decision?
