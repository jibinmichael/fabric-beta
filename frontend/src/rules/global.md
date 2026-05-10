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