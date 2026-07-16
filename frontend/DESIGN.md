---
name: "Mihin lounaalle?"
description: "A crisp local wayfinding system for choosing lunch around Seinäjoki in under a minute."
colors:
  signal-clay: "#E25A31"
  signal-clay-hover: "#C94D29"
  route-green: "#334C39"
  route-green-hover: "#343A31"
  ink: "#20261D"
  secondary-ink: "#687064"
  field-ground: "#F4EFE5"
  clear-surface: "#FFFDF8"
  input-surface: "#FFFFFF"
  light-on-dark: "#FFFAF1"
  divider: "#20261D24"
  warning-ink: "#6E4620"
  warning-surface: "#FFF1D8"
  danger-ink: "#9B3027"
  danger-surface: "#FFF0ED"
  success-ink: "#2F6B3D"
  success-surface: "#EEF8F0"
typography:
  display:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "3.5rem"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "Georgia, 'Times New Roman', serif"
    fontSize: "2rem"
    fontWeight: 600
    lineHeight: 1.05
    letterSpacing: "-0.03em"
  title:
    fontFamily: "Aptos, 'Segoe UI', sans-serif"
    fontSize: "1.25rem"
    fontWeight: 760
    lineHeight: 1.2
    letterSpacing: "-0.02em"
  body:
    fontFamily: "Aptos, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.55
    letterSpacing: "normal"
  label:
    fontFamily: "Aptos, 'Segoe UI', sans-serif"
    fontSize: "0.8rem"
    fontWeight: 720
    lineHeight: 1.3
    letterSpacing: "normal"
  data:
    fontFamily: "Aptos, 'Segoe UI', sans-serif"
    fontSize: "1rem"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.01em"
    fontFeature: "'tnum' 1"
rounded:
  brand-mark: "11px"
  control: "12px"
  surface: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "18px"
  xl: "24px"
  section: "52px"
components:
  button-primary:
    backgroundColor: "{colors.route-green}"
    textColor: "{colors.light-on-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
    height: "46px"
  button-primary-hover:
    backgroundColor: "{colors.route-green-hover}"
    textColor: "{colors.light-on-dark}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
    height: "46px"
  button-secondary:
    backgroundColor: "{colors.clear-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.control}"
    padding: "11px 16px"
    height: "46px"
  input:
    backgroundColor: "{colors.input-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "11px 13px"
    height: "48px"
  information-chip:
    backgroundColor: "{colors.field-ground}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "5px 10px"
    height: "30px"
  navigation-control:
    backgroundColor: "{colors.clear-surface}"
    textColor: "{colors.ink}"
    typography: "{typography.data}"
    rounded: "{rounded.control}"
    padding: "8px 12px"
    height: "46px"
  recommendation-primary:
    backgroundColor: "{colors.route-green}"
    textColor: "{colors.light-on-dark}"
    rounded: "{rounded.surface}"
    padding: "24px"
  recommendation-secondary:
    backgroundColor: "{colors.clear-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
    padding: "24px"
  menu-reading-row:
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    padding: "18px 0"
---

# Design System: Mihin lounaalle?

## 1. Overview

**Creative North Star: "Keskipäivän opaste"**

Keskipäivän opaste treats the interface like a well-designed local wayfinding system at noon: crisp, direct, grounded, and high-signal. It preserves the established clay, green, and neutral identity, but every visual decision must help a Finnish-speaking reader choose lunch in under a minute.

The reader surface is mobile-first and composed for fast scanning: the current date, the leading recommendation, its rationale, and the path to the full offering must be obvious without study. Desktop adds breadth, not a different hierarchy. The admin surface uses the same palette and components at a denser rhythm, with the editorial serif removed from operational labels, controls, and data.

This system explicitly rejects the food-delivery marketplace, the generic SaaS dashboard, and the “AI-powered” novelty product. Recommendations earn trust through visible criteria, sources, freshness, and honest states; the underlying AI stays backstage.

**Key Characteristics:**

- Near-flat hierarchy built from solid fills, full borders, alignment, and whitespace.
- Signal Clay appears rarely as an orientation cue; Route Green carries primary action and the leading choice.
- Touch targets are at least 46px, with compact facts and calm reading density around them.
- Public decision headlines may use Georgia; every task-oriented label, control, and data point uses Aptos or Segoe UI.
- Mobile exposes the decision first; desktop increases comparison capacity without adding decoration.

## 2. Colors

The palette behaves like civic wayfinding: one visible signal, one dependable route color, and clear neutral surfaces that keep menu information legible.

### Primary

- **Signal Clay** (#E25A31): the rare attention cue for current context, focus, selected markers, and meaningful status emphasis. It is not a body-text color on Field Ground or Clear Surface.
- **Pressed Signal Clay** (#C94D29): the deeper interactive state for Signal Clay when that accent is used on a sufficiently large non-text control.

### Secondary

- **Route Green** (#334C39): the dependable action color, the leading recommendation surface, and the strongest navigational anchor.
- **Deep Route Green** (#343A31): the hover and pressed state for Route Green actions.

### Neutral

- **Ink** (#20261D): default text and the primary high-contrast line color.
- **Secondary Ink** (#687064): supporting copy and metadata on Clear Surface only; use Ink on Field Ground when the text is small or contrast is uncertain.
- **Field Ground** (#F4EFE5): the page canvas. It creates place and continuity, not a decorative “paper” effect.
- **Clear Surface** (#FFFDF8): grouped reading and decision surfaces.
- **Input Surface** (#FFFFFF): editable fields and controls that must read as active.
- **Light on Dark** (#FFFAF1): text and dividers on Route Green.
- **Quiet Divider** (#20261D24): full borders and separators that organize without turning every region into a card.

### State Colors

- **Warning Pair** (#6E4620 on #FFF1D8): stale or delayed information.
- **Danger Pair** (#9B3027 on #FFF0ED): errors and destructive feedback.
- **Success Pair** (#2F6B3D on #EEF8F0): completed operations and healthy states.

**The One Signal Rule.** Signal Clay occupies no more than 10% of a screen. Its rarity is what makes it useful.

**The Route Green Action Rule.** Route Green is reserved for primary action, the first recommendation, and active wayfinding. Inactive states never borrow its saturation.

**The Clear Surface Rule.** Field Ground is the canvas and Clear Surface is the reading layer. Never stack cream-on-cream cards to manufacture hierarchy.

## 3. Typography

**Display Font:** Georgia (with Times New Roman and serif fallbacks)  
**Body Font:** Aptos (with Segoe UI and sans-serif fallbacks)  
**Label/Mono Font:** Aptos with tabular numerals for dates, scores, times, prices, and operational data

**Character:** Georgia provides a recognizably local editorial voice only where a reader is making a decision. Aptos carries every interaction and fact with compact, familiar clarity. The contrast is deliberate: guidance may have character; controls must disappear into the task.

### Hierarchy

- **Display** (600, 3.5rem desktop / 2.5rem mobile, 1.0): the reader home-page decision headline only.
- **Headline** (600, 2rem, 1.05): reader section headings and restaurant names; never form or admin headings.
- **Title** (760, 1.25rem, 1.2): recommendation titles, admin panel headings, and prominent task labels.
- **Body** (400, 1rem, 1.55): descriptions, rationales, and menus; prose is capped at 70ch.
- **Label** (720, 0.8rem, 1.3): buttons, metadata labels, chips, and field labels in sentence case.
- **Data** (700, 1rem, 1.2): dates, times, scores, counts, and prices with tabular numerals.

**The Serif Boundary Rule.** Georgia is permitted for public decision headlines and restaurant storytelling only. It is forbidden in buttons, chips, field labels, admin controls, tables, status messages, and operational data.

**The No Eyebrow Scaffold Rule.** Repeated tiny uppercase tracked labels are prohibited. Use one plain sentence-case context label when orientation genuinely requires it.

## 4. Elevation

The system is near-flat. Tonal contrast, full dividers, spacing, and solid Route Green emphasis establish hierarchy. Resting cards and panels have no shadow. A low structural shadow (0 1px 2px rgba(32, 38, 29, 0.04)) is allowed only when a control temporarily overlaps content or needs separation from a moving surface.

The current broad card shadow (0 1px 2px rgba(32, 38, 29, 0.06), 0 12px 32px rgba(52, 48, 37, 0.08)) is legacy styling and must be removed from bordered cards during the rework.

### Shadow Vocabulary

- **Structural Low** (0 1px 2px rgba(32, 38, 29, 0.04)): temporary overlap, sticky controls, or a compact floating toolbar. Never pair it with a decorative 1px card border.

**The Flat Map Rule.** If a surface can be understood through alignment, fill, or a divider, it gets no shadow.

## 5. Components

Components feel aligned, compact, and touchable. They reuse a small vocabulary and signal state without novelty.

### Buttons

- **Shape:** precise controls with a 12px radius and a 46px minimum height.
- **Primary:** Route Green with Light on Dark text, 11px × 16px padding, and strong sentence-case labeling.
- **Hover / Focus:** Deep Route Green on hover; a 3px Signal Clay focus outline with a 3px offset. Active state scales only to 0.98 and never shifts layout.
- **Secondary:** Clear Surface with Ink text and a full Quiet Divider border. Signal Clay is not a default button fill.

### Chips

- **Style:** Field Ground or transparent fill, Ink text, a full Quiet Divider border, a 999px pill radius, and 5px × 10px padding.
- **State:** factual chips display time, price, diet, or status. Selected chips require an icon or text change in addition to color.

### Cards / Containers

- **Corner Style:** restrained 14px radius. The existing 20–28px surface radii are legacy and must not be copied into new work.
- **Background:** Clear Surface for grouped content; Route Green for the single leading recommendation.
- **Shadow Strategy:** flat at rest. Use full dividers and spacing, not ambient lift.
- **Border:** one full Quiet Divider border on neutral surfaces; no border on the solid Route Green recommendation.
- **Internal Padding:** 18px on compact mobile groups and 24px on recommendation or menu surfaces.

### Inputs / Fields

- **Style:** Input Surface, a 12px radius, a full 1px Ink border at 24% opacity, 11px × 13px padding, and a 48px minimum height.
- **Focus:** Signal Clay border plus a 3px translucent Signal Clay ring.
- **Error / Disabled:** pair text with the semantic state surface; disabled controls retain readable text and communicate inactivity without relying on opacity alone.

### Navigation

- **Style:** a quiet header with the local mark, a full-width divider, and no decorative navigation. The date navigator is the primary wayfinding control: one aligned row, 46px arrow targets, a sentence-case context label, and a tabular date.
- **Mobile treatment:** the date navigator spans the content width and precedes the decision headline, establishing date context before the recommendation; secondary catchment metadata may collapse, but the date and next/previous actions never do.

### Recommendation Wayfinder

The first recommendation is the single solid Route Green anchor. Rank, restaurant, rationale, and two or three decision facts form one scan path. A route action may follow the menu action as a quieter real-world handoff. The second and third recommendations are quieter aligned companions rather than three equally promoted marketplace cards; each still shows one dish and a short rationale so it can work as a genuine fallback. The full menu offering becomes a calm row or reading list when that structure scans faster than a card grid.

**The One Decision Rule.** The current date and leading recommendation must be identifiable in the first mobile viewport without relying on animation.

### Safety and Status

Automatically extracted dietary markers never stand alone. An always-visible sentence tells readers to verify allergens with the restaurant, while a native disclosure contains the longer explanation. Loading and successful date/week changes are announced through stable polite status regions, and an empty week always provides a recovery path.

## 6. Do's and Don'ts

### Do:

- **Do** make the current date and leading recommendation identifiable in the first 390 × 844 viewport.
- **Do** keep interactive targets at least 46px high and preserve visible keyboard focus.
- **Do** use Route Green for primary action and Signal Clay only for rare orientation and state cues.
- **Do** show ranking criteria, source, freshness, and stale or unavailable states in plain Finnish.
- **Do** announce completed date and week changes without moving focus unexpectedly.
- **Do** pair automatically extracted dietary markers with an always-visible verification message.
- **Do** use full dividers, alignment, and 18–24px internal spacing before introducing another container.
- **Do** keep long rationales and operational prose within 70ch.
- **Do** use text or an icon alongside color for warning, danger, success, and selected states.

### Don't:

- **Don't** resemble a food-delivery marketplace with equally promoted restaurant tiles, promotional imagery, or ordering affordances.
- **Don't** resemble a generic SaaS dashboard with interchangeable stat cards, decorative charts, or a sidebar that does not serve a real task.
- **Don't** resemble an “AI-powered” novelty product with gradients, glows, bot motifs, or implementation-first copy.
- **Don't** use repeated tiny uppercase tracked eyebrows as section scaffolding.
- **Don't** use 20–28px card radii, nested cards, or identical card grids as the default structure.
- **Don't** combine a 1px border with the current broad 32px-blur shadow on the same resting surface.
- **Don't** use a colored border-left or border-right thicker than 1px for notices; use a full border, state fill, icon, or leading text.
- **Don't** use Signal Clay for small text on Field Ground or Clear Surface.
- **Don't** add glassmorphism, gradient text, decorative grids, or motion that does not communicate state.
