# Wati UI Generation Rules — Global

You are generating UI for **Wati**, a WhatsApp Business API SaaS platform. 
All output must follow these rules. When in doubt, ask rather than guess. 
Do not invent components, tokens, or patterns not specified here.

## Aesthetic

- Restrained. Neutral. Apple-grade discipline.
- No marketing language. No exclamation points. No emoji.
- Sentence case for all titles, headings, button labels, menu items, table 
  headers ("Add filter", not "Add Filter"; "Failed payments", not 
  "Failed Payments").
- White surfaces with subtle borders. No shadows beyond very subtle elevation.
- No gradients. No background imagery. No decorative illustrations.
- Information density over breathing room — Wati is a power-user tool.

## Visual style — MANDATORY for generated previews

These rules apply to UI Fabric generates (the preview pane). They do 
NOT apply to Fabric's own chrome.

**Font**
- Use the system UI font stack only. Do NOT specify `font-family` in
  component styles — the preview iframe injects the canonical stack at
  `<head>` level so generated code inherits automatically.
- If you must specify, use exactly:
  `system-ui, -apple-system, sans-serif`
- Tailwind: `font-sans` resolves to the canonical system stack. Use it
  if needed; never `font-serif`.
- NEVER import a webfont (no Inter, no Google Fonts, no `@font-face`).
- NEVER serif. NEVER display or decorative fonts. NEVER monospace
  except for code blocks or tabular numeric data.

**Roundness — generated UI is rounded, never boxy**
- Cards: `rounded-lg` (8px) default; `rounded-xl` (12px) for page-level 
  containers.
- Buttons: `rounded-lg` (8px).
- Inputs, selects, comboboxes: `rounded-lg` (8px).
- Badges: `rounded-md` (6px) or `rounded-full` for pill style.
- NEVER `rounded-none`. NEVER `rounded-sm` on primary surfaces.

**Compactness — information density over breathing room**
- Card padding: `p-4` (16px) default. `p-6` reserved for large hero 
  cards only.
- Button padding: `px-3 py-2` (sm), `px-4 py-2` (md), `px-5 py-2.5` (lg).
- Input padding: `px-3 py-2`.
- Vertical rhythm: `space-y-3` or `space-y-4` between sections — 
  NEVER `space-y-6` or `space-y-8`.
- Line-height: `leading-snug` or `leading-normal` — never `leading-loose`.

**Color — single brand accent**
- Neutral grays are the default for text, borders, surfaces.
- The Wati primary green (`surface.primary` / WhatsApp green) is the 
  ONLY accent color. Use sparingly:
  - Primary CTA buttons (one per page max)
  - The north-star metric (one card per analytics page)
  - Success states (success badges, completed indicators)
  - Occasional brand moments — never decorative
- Semantic red allowed for error/danger states.
- NEVER use purple, blue, orange, pink, teal, or any multi-color 
  decorative palette in generated UI.
- NEVER use color for decoration without semantic meaning.

## Component Vocabulary

Use ONLY these components. Do not invent new components. Do not import 
shadcn-default styling — use the variants specified below.

- `Button` — variant: primary | secondary | ghost | danger | outline; 
  size: sm | md | lg
- `Input` — size: sm | md | lg; states: default, error, disabled
- `Select` — size: sm | md | lg
- `Card` — variant: default | outlined (no shadow variants)
- `Badge` — variant: default | primary | success | warning | danger
- `Table` (+ `THead`, `TBody`, `TR`, `TH`, `TD`)
- `Tabs` — for view-toggling
- `Divider` — for section breaks
- Slot components: `IconSlot`, `ChartSlot`, `DataSlot`, `MetricSlot`, 
  `DeltaBadgeSlot`, `TimestampSlot`, `CopySlot` (see Slot Patterns)

## Tokens

Use ONLY these tokens. No raw hex. No arbitrary values (no `p-[12px]`, 
no `text-[14px]`, no `bg-purple-500`).

**Spacing**: wati-1 (4px) · wati-2 (8px) · wati-3 (12px) · wati-4 (16px) · 
wati-5 (20px) · wati-6 (24px) · wati-8 (32px) · wati-10 (40px) · wati-12 (48px)

**Radius**: wati-sm · wati-md · wati-lg

**Typography sizes**: wati-xs · wati-sm · wati-base · wati-lg · wati-xl · 
wati-2xl · wati-3xl · wati-4xl
**Weights**: regular (400) · medium (500) · semibold (600)

**Colors** — semantic only:
- `surface.default` `surface.subtle` `surface.primary` `surface.success` 
  `surface.warning` `surface.danger`
- `text.default` `text.muted` `text.subtle` `text.primary` `text.success` 
  `text.warning` `text.danger` `text.onPrimary`
- `border.default` `border.subtle` `border.primary` `border.danger`
- `divider.default`

## Slot Patterns — MANDATORY, NOT OPTIONAL

When any of the following are needed in the output, you MUST use the slot 
component. NEVER use a real implementation.

| Need                 | Use this                                | NEVER use                           |
|----------------------|-----------------------------------------|-------------------------------------|
| An icon              | `<IconSlot name="kebab-case" />`        | lucide-react, heroicons, emoji, SVG |
| A chart              | `<ChartSlot type="line" data="..." />`  | recharts, chart.js, inline SVG      |
| A list of records    | `<DataSlot rows="entity_name" />`       | inline arrays, mock JSON            |
| A big metric         | `<MetricSlot value compare format />`   | hardcoded numbers                   |
| A change %           | `<DeltaBadgeSlot value direction />`    | inline "+12%" strings               |
| Updated time         | `<TimestampSlot updated="..." />`       | inline "Updated 4 min ago"          |
| Empty/marketing copy | `<CopySlot tone context />`             | inline written copy                 |

HARD RULE: If you find yourself importing from `lucide-react`, 
`@heroicons`, `recharts`, or any icon/chart library — STOP. You should 
have used a slot. Placeholders are explicit on purpose: they show the 
audience where craft happens (designers/devs fill them in), not AI.

If a slot name doesn't exist for what you need, invent a descriptive 
kebab-case name. NEVER fall back to a real component.

## Mock data sourcing (MANDATORY)

Use generic placeholder data for previews:
- Broadcasts: "Broadcast 1", "Broadcast 2", "Weekly Campaign", "Promo Drop"
- Templates: "template_a", "template_b", "order_confirmation", "promo_alert"
- Customers: "Customer 1", "Customer #123", "Sample Customer"
- Contacts: "Contact 1", "Phone +1-555-0100", "user@example.com"
- Numbers: round, illustrative figures (1,200 contacts, 45%, 78%) —
  not overly specific or realistic-business-flavored

Do NOT invent specific business names like "Mike's Pizza Shop" or
"Sarah's Boutique". Do NOT use realistic regional/cultural references
to make data feel authentic. Generic > plausible-fake for previews.

## Hard Rules

- ALWAYS sentence case.
- ALWAYS pair every Input with a label.
- ALWAYS include focus-visible states.
- ALWAYS use slots for icons, charts, data, copy.
- NEVER use raw hex or rgb().
- NEVER use arbitrary Tailwind values.
- NEVER use the shadcn default look (no purple primary, no shadow-md cards, 
  no gradient text).
- NEVER use purple as Wati's primary brand color — Wati's primary is the 
  WhatsApp green semantic token (`surface.primary`).
- NEVER use emoji.
- NEVER use marketing copy ("Awesome!", "Crush it", "Welcome aboard").
- NEVER show fake data inline — use a DataSlot.

## Document structure (MANDATORY)

All generated documents (PRD, engineering doc, quality doc) MUST use structured 
blocks, not flowing prose. Specifically:

**Status header — required at the top of every document.** Render as a markdown 
table with these columns: Status, Complexity, Estimated effort, Risk level. 
Example for a PRD:


```
| Status | Complexity | Estimated effort | Risk |
|---|---|---|---|
| Draft | Medium | 3-5 days | Low |
```



For engineering docs use: Complexity, Estimated effort, Dependencies, Technical risk.

**Tabular data uses tables, not bullet lists.** Requirements, edge cases, 
acceptance criteria, implementation phases — these are all tables. Use markdown 
tables with explicit headers. Bullet lists are reserved for narrative or 
non-tabular sequences only.

**Callouts for risks, assumptions, open questions.** Use blockquote syntax with 
emoji + bold prefix to make these visually distinct:


```
> **🚩 Risk:** Description of the risk and its impact.
> **💭 Assumption:** Description of the assumption and what depends on it.
> **❓ Open question:** Description of the unresolved question and who needs to answer it.
> **⚠️ Constraint:** Description of the hard constraint.
> **💡 Insight:** Description of a key insight or observation.
```


Each callout is one blockquote. Multiple callouts stack vertically, not merged.

**Inline badges for metadata.** Tag inline metadata using bracket-bold syntax:
- `**[Priority: P1]**`, `**[Priority: P2]**`, `**[Priority: P3]**`
- `**[Type: Functional]**`, `**[Type: UX]**`, `**[Type: Technical]**`
- `**[Status: Must]**`, `**[Status: Should]**`, `**[Status: Could]**`

Use these inline within table cells or after section headers when they apply.

## PRD section requirements (MANDATORY)

Every generated PRD MUST include these sections in order:

1. **Status header table** (see above)
2. **Problem statement** — 1-2 sentences. No fluff.
3. **User stories** — bulleted, format: "As a [role], I want [capability] so that 
   [outcome]"
4. **Requirements table** — columns: `#`, `Requirement`, `Priority`, `Type`. At 
   least 3 rows.
5. **Success metrics** — bulleted, each with explicit target. Format: 
   "[Metric name]: [target value or threshold]"
6. **Edge cases** — table with columns: `Scenario`, `Expected behavior`, 
   `Priority`
7. **Open questions** — callouts (one per question), each with the question and 
   who needs to resolve it
8. **Out of scope** — bulleted list of what is explicitly NOT included

## Engineering doc section requirements (MANDATORY)

Every generated engineering doc MUST include these sections in order:

1. **Status header table** (Complexity, Effort, Dependencies, Risk)
2. **Approach overview** — 2-3 sentences max
3. **Implementation plan** — table with columns: `Phase`, `Deliverable`, 
   `Estimated effort`
4. **Effort drivers** — callouts explaining what makes this complex. One callout 
   per driver.
5. **Technical risks** — callouts (`🚩 Risk:`), one per risk
6. **Open technical questions** — callouts (`❓ Open question:`), one per question
7. **Out of scope** — bulleted

## Anti-patterns (DO NOT)

- Do NOT use flowing prose for tabular data
- Do NOT merge multiple risks / assumptions into a single blockquote
- Do NOT skip the status header table on any document
- Do NOT bury metadata inside paragraphs (use inline badges)
- Do NOT use H1 headers inside generated documents — start at H2 and below
- Do NOT add narrative paragraphs longer than 3 sentences anywhere