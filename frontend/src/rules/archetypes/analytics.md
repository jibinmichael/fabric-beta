markdown# Wati Analytics Page Archetype

Derived from Stripe's analytics overview pattern. Use when generating 
any Wati analytics page (Campaign Analytics, CTWA Dashboard, Broadcast 
Intelligence, Conversation Analytics, etc.).

Inherits all rules from `global.md`. This file adds STRUCTURAL 
constraints specific to analytics pages.

## STRUCTURAL CONSTRAINTS — NON-NEGOTIABLE

Before writing any TSX, internalize these:

1. The card grid is ALWAYS 3 columns on desktop. Not 2. Not 4. Three. 
   If you have 4 metrics, drop the least-important or split into 3 + 1 
   (with the 4th in row 2).

2. Every KPI card uses `<IconSlot>` for its header icon. Never a real 
   icon component.

3. Every analytics card has its own `<TimestampSlot>` in the footer. A 
   page-level "Updated X" is not a substitute.

4. Primary action buttons use Wati's primary token (WhatsApp green via 
   `surface.primary`). Never black, never blue, never purple.

5. Full-width chart rows are NOT an analytics archetype element. If you 
   need a chart, put it inside a card.

These are STRUCTURAL — violations break the demo guarantee that two 
analytics pages are visually consistent.

## Page Anatomy (in order)

1. **Page Header** — title + top-right actions
2. **Filter Bar** — time range, comparison, granularity
3. **Card Grid** — one or more rows of 3 cards each
4. *(Optional)* **Trailing Section** — detailed table or list

No other zones. No hero sections. No onboarding cards. No marketing.

## Page Header

- Title: `text-wati-3xl`, `font-semibold`, sentence case
- Top-right actions: 1–2 buttons MAX, size `sm`, variant `ghost` or `outline`
- Layout: title left, actions right, vertically aligned
- Padding below header: `wati-6`

## Filter Bar

Inline row, in this order:

- Time range — `Select` size `sm`, default "Last 7 days"
- Plain text "compared to" — `text-wati-sm`, `text.muted`
- Comparison — `Select` size `sm`, default "Previous period"
- Granularity — `Select` size `sm`, default "Daily"

Gap between elements: `wati-3`. Padding below filter bar: `wati-4`.

## Card Grid

- ALWAYS 3 columns on desktop (≥1024px)
- 2 columns on tablet (≥768px), 1 column on mobile
- Column gap: `wati-4`
- Row gap: `wati-6`
- Cards within a row: equal height (use `h-full` on each card)
- Optional `<Divider />` between major row groups

## Card Types — pick one per cell, mix freely

### Type A — Metric Card (single big number)

Use for: any single metric tracked over time (revenue, count, rate).

Anatomy:
┌─────────────────────────────────────────┐
│ Title  <IconSlot name="info" />  <DeltaBadgeSlot /> │
│                                         │
│ <MetricSlot value="..." compare="..." />│
│ <comparison text>                       │
│                                         │
│ <ChartSlot type="line" data="..." />    │
│                                         │
│ View more           <TimestampSlot />   │
└─────────────────────────────────────────┘

- Card padding: `wati-6`
- Title row: gap `wati-2` between title, info icon, delta badge
- Title: `text-wati-base`, `font-semibold`
- Big number: `text-wati-4xl`, `font-semibold`, tabular-nums
- Comparison text below number: `text-wati-sm`, `text.muted`
- Gap between number block and chart: `wati-4`
- Chart height: ~120px
- Footer: "View more" link left (`text-wati-sm`, `text.primary`) + 
  TimestampSlot right (`text-wati-xs`, `text.muted`)

### Type B — Breakdown Card (proportional list)

Use for: any metric broken into mutually-exclusive categories (payments 
by status, messages by template type, customers by segment).

Anatomy:
┌─────────────────────────────────────────┐
│ Title  <IconSlot name="info" />         │
│                                         │
│ <ChartSlot type="stacked-bar" />        │
│                                         │
│ ●  Category A           <value>         │
│ ●  Category B           <value>         │
│ ●  Category C           <value>         │
│ ●  Category D           <value>         │
│                                         │
│ View more           <TimestampSlot />   │
└─────────────────────────────────────────┘

- Card padding: `wati-6`
- Stacked bar: full width, height `wati-2` (8px), `rounded-wati-sm`
- Item rows: gap `wati-2`
- Item: colored dot (`wati-2` square) + label (left) + value 
  (right, `font-medium`, tabular-nums)
- Footer same as Type A

### Type C — List Card (data list with metadata)

Use for: recent items, top items, alerts (failed payments, new customers, 
top campaigns by sends, recent broadcasts).

Anatomy:
┌─────────────────────────────────────────┐
│ Title  <IconSlot name="info" />         │
│                                         │
│ Primary text                <Badge />   │
│ secondary meta · email                  │
│                                         │
│ Primary text                <Badge />   │
│ secondary meta · email                  │
│                                         │
│ <DataSlot rows="..." />                 │
│                                         │
│ N of N results    <TimestampSlot />     │
└─────────────────────────────────────────┘

- Card padding: `wati-6`
- Item primary: `text-wati-sm`, `font-medium`
- Item secondary: `text-wati-xs`, `text.muted`
- Item gap: `wati-3`
- Show max 3 items in card body; use `<DataSlot>` to indicate live fetch
- Footer: "N of N results" link left + TimestampSlot right

## Composition Rules

- Minimum 3 cards (1 row). Maximum 9 cards (3 rows) per page.
- The first card of the first row should be the page's "north star" metric.
- Type A and Type B cards alternate well in a single row.
- Type C cards work better in their own row.
- Do not mix more than 2 card types in a single row.
- Always include at least one TimestampSlot per row (data freshness 
  is non-negotiable for analytics).

## Forbidden in Analytics Pages

- NEVER hero sections, large illustrations, or onboarding banners.
- NEVER fake/placeholder data shown inline — use slots.
- NEVER shadows on cards (Wati uses borders, not elevation).
- NEVER purple as a chart color (use `surface.primary` Wati green or 
  semantic status colors).
- NEVER color as the only signal — every status must include a label or icon.
- NEVER omit TimestampSlot — every analytics card declares freshness.
- NEVER mix card padding sizes within the same grid.