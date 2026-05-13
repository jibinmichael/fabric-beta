# Fabric — Claude Code Context

> Loaded automatically by Claude Code at session start. **Update this file at the end of any session that changes architecture, conventions, or pending work.** See "Self-update protocol" at the bottom.

---

## What Fabric is

Wails desktop app that generates Wati-grounded **PRDs, engineering specs, and QA acceptance criteria** from natural-language prompts. **Phase 1 default audience: product managers, engineers, QA.** Chat interface, single-column layout.

UI generation (live React TSX preview pane, persona cards, slot pattern) is **Phase 2** — gated behind `FEATURES.uiGeneration` in `lib/features.ts`, default off. Flip the flag in Settings → refresh to get the two-pane layout and TSX output.

**Strategic positioning:** Fabric is one consumer surface for the *rules layer* (markdown files defining what Fabric generates). Cursor and other AI coding tools can consume the same rules. The rules are the IP. Fabric is the delivery vehicle.

---

## Stack

- **Desktop framework:** Wails v2 (Go backend + React frontend)
- **Frontend:** React 18 + TypeScript + Vite
- **AI SDK:** `@anthropic-ai/sdk` v0.95.1
- **Model:** `claude-sonnet-4-6` primary, `claude-opus-4-7` fallback
- **Storage:** User config directory (cross-platform — `~/Library/Application Support/Fabric/` on Mac, `%APPDATA%\Fabric\` on Windows)

---

## Repository structure

```
Fabric/
├── app.go                          # Wails Go backend
├── main.go                         # Entry point
├── wails.json                      # Wails config
├── frontend/
│   ├── src/
│   │   ├── App.tsx                 # Main UI (chat + optional preview, fmtDollars)
│   │   ├── lib/
│   │   │   ├── systemPrompt.ts     # Prompt assembly; branches on isUiGenerationEnabled()
│   │   │   ├── features.ts         # localStorage-backed feature flags (uiGeneration)
│   │   │   ├── claude.ts           # Anthropic streaming + usage capture
│   │   │   └── qualityMetrics.ts   # Parallel Haiku 4.5 metrics (always on)
│   │   ├── rules/
│   │   │   ├── global.md           # Doc structure rules (always inject — Phase 1)
│   │   │   └── ui-generation/      # Phase 2 — gated by FEATURES.uiGeneration
│   │   │       ├── global-ui.md    # UI generation rules (aesthetic, slots, tokens, etc.)
│   │   │       └── archetypes/
│   │   │           └── analytics.md
│   │   ├── components/             # Fabric's own UI components (NOT Wati's)
│   │   └── types/                  # Shared TS types
│   └── package.json
└── CLAUDE.md                       # This file
```

---

## Architecture: feature flags

Feature flags live in `lib/features.ts`, backed by `localStorage`. Read once at app mount; **page refresh required to apply changes** (acceptable v1 — simpler than reactive layout transitions).

Current flags:
- `FEATURES.uiGeneration` (default `false`) — gates the entire UI generation path.
  - When **off** (Phase 1): single-column layout, no preview pane, system prompt strips UI rules + TSX instructions + SHADCN/OUTPUT_DISCIPLINE blocks. Prompt shrinks ~30K tokens; per-turn cost drops ~40-60%.
  - When **on** (Phase 2): two-pane layout returns, preview iframe renders, full UI rules inject into the prompt, model emits `<preview>` TSX. Pre-cutover behavior intact.

Toggle in the chat input footer → **Settings** popover → checkbox.

---

## Architecture: the rules layer

The rules layer is **split** to support the Phase 1 / Phase 2 cutover:

- **`frontend/src/rules/global.md`** — *document structure rules*. Always injected, regardless of flag. Owns: status header tables, PRD section requirements, engineering doc section requirements, callout blockquote syntax, inline metadata badges, anti-patterns for doc shape.
- **`frontend/src/rules/ui-generation/global-ui.md`** — *UI generation rules* (Phase 2). Owns: aesthetic, visual style, component vocabulary, tokens, slot patterns, mock data sourcing, UI hard rules. Injected only when `FEATURES.uiGeneration` is on.
- **`frontend/src/rules/ui-generation/archetypes/*.md`** — page-type specific UI rules (analytics today). Phase 2.

Imports in `systemPrompt.ts` are unconditional (Vite bundles all rules either way). Runtime gating in `buildSystemPrompt()` branches the assembled prompt — when the flag is off, the UI rules block, the `<preview>` instructions, the shadcn rules, and the visual-output-discipline block are all omitted; an explicit "PRD-ONLY MODE: do not generate UI code" instruction takes their place.

**Critical: rules files are bundled at build time.** Editing rules requires a Vite rebuild to take effect. No hot-reload — rules are inlined into the JS bundle.

---

## Phase 2 — gated by FEATURES.uiGeneration

The sections below document UI-generation behavior. **None of this is active by default in Phase 1.** Flip `FEATURES.uiGeneration` on (Settings popover → checkbox → refresh) to activate.

### Slot pattern (MANDATORY when UI gen is on)

Generated UI must use slot placeholders, not real assets:

- `<IconSlot>` — icon placeholders (no real Lucide/MUI icons in output)
- `<ChartSlot>` — chart visualization placeholders
- `<DataSlot>` — dynamic data values
- `<MetricSlot>` — KPI numbers
- `<DeltaBadgeSlot>` — trend deltas
- `<TimestampSlot>` — time/date displays
- `<CopySlot>` — copy/text content

The slot pattern prevents the AI from making aesthetic decisions (which icon? what specific number?). Real assets get bound at handoff time by engineers.

---

## Prompt caching

**Enabled by default** via `PROMPT_CACHING_ENABLED = true` in `systemPrompt.ts`. Full system prompt (~47K tokens) is sent as a single `TextBlockParam` with `cache_control: { type: "ephemeral" }`.

Cost (Sonnet 4 pricing):
- First turn: ~$0.32 (cache write)
- Subsequent turns: ~$0.13 (cache read at 90% discount)
- Savings: ~$0.19 per turn after the first

Pricing constants live in `App.tsx`:
- `PRICE_INPUT_PER_M = 3.00`
- `PRICE_OUTPUT_PER_M = 15.00`
- `PRICE_CACHE_WRITE_PER_M = 3.75`
- `PRICE_CACHE_READ_PER_M = 0.30`

Token usage captured via `await stream.finalMessage()` in both primary and fallback paths, stored on `Message.usage?: Usage`, displayed inline using `fmtDollars()` helper.

Cost copy format (verified working):
- First turn: `"Cost ~$0.32 · cache built (next turn will be ~$0.13)"`
- Subsequent: `"Cost ~$0.13 · without caching: ~$0.32 · saved ~$0.19"`

---

## Wati design system context (what Fabric generates against)

- **Brand primary:** `#23a455` (`--wati-color-green-500`)
- **Brand accent:** `#00e785` (`--wati-color-brand-green-dark`)
- **Canonical Harmony:** `packages/ui/Materials/*` in the Wati FE repo (NOT in Fabric)
- **Tokens:** `packages/shared/styles/designTokens.css` (Figma-synced — code changes may not survive sync)
- **Legacy ratio:** `StandardButton` (456 imports) vs Harmony `Materials/Button` (55 imports). 8:1 legacy. Fabric pulls codebase toward Harmony.

### Wati FE constraints worth knowing

- `designTokens.css` is **Figma-synced**. Token value changes happen in Figma, not code.
- **Triple bookkeeping:** Tailwind config + `Colors.defaultTheme` (styled.ts) + CSS variables. Three sources of truth for the same concepts.
- Harmony components have **no `@media` queries** — fixed-size primitives, mobile responsiveness happens at page level via dedicated mobile components (MobileContactRow pattern).
- **Anatomical dependencies:** Button heights (32/40/48), Input min-heights (44/36), Dialog padding (64px) baked into page layouts. Do not change.
- Input focus token misnamed: `--wati-border-success-default` used for generic focus.
- **Multi-library coexistence:** MUI v5, Semantic UI React, Radix primitives, react-bootstrap, react-select all coexist. Tables especially fragmented.

---

## Conventions

- **Imports:** Vite `?raw` for markdown, named imports for SDK types.
- **Streaming:** `streamChat()` accepts `string | Array<TextBlockParam>` for system prompt. Returns `onComplete(text, usage)`.
- **Error handling:** Primary model → fallback model → show error in chat with thumbs-down hint.
- **UI state:** Streaming assistant messages render `__THINKING__` marker before content, then stream tokens. `Generating…` indicator at message header during stream.
- **Toasts:** Use `showToast()` for silent failures (e.g. session-switch rejections).
- **No `localStorage`/`sessionStorage` for app state** — desktop app uses Wails file storage via Go backend.
- **App-level UI state lives in `state.json`** (Go `appState` struct, alongside `ActiveSessionID`). Examples: `SidebarCollapsed`. Add new fields with `omitempty`. `persistAppState(activeID)` reads the existing state and only mutates the active session id, so sibling fields are preserved across session changes. Per-chat UI state (selectedVersionIndex etc.) is **transient** — never persisted. **Sidebar collapse is app-level, not per-chat** — do not tie it to session state, do not reset on session switch.
- **All typography uses the canonical system-ui font stack.** No webfonts. No `font-family` declarations in generated code — the preview iframe injects font CSS at `<head>` level (`build/preview-server-template/index.html` `<style>` block + `src/index.css` `:root`) so generated code inherits automatically. Fabric chrome (`frontend/src/index.css`, Tailwind `fontFamily.sans` override) uses the same stack: `system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif` + `font-feature-settings: "cv02", "cv03", "cv04", "cv11"` for SF Pro stylistic alternates on Mac. Monospace is preserved only for `<code>`/`<pre>` blocks.
- **Mock data is generic placeholder strings — no persona system, no invented businesses.** Generic > plausible-fake. See the `## Mock data sourcing (MANDATORY)` block in `frontend/src/rules/global.md` for the canonical placeholder vocabulary ("Broadcast 1", "Customer #123", `template_a`, round illustrative numbers). Do NOT reintroduce a personas file or sandbox-toggle plumbing.
- **Iteration history — auto-fork-on-edit semantics:** A "version" is any assistant message in `messages[]` with `tsxGenerated === true`. Selecting an older version via the preview-pane dropdown is **transient view state only** (`selectedVersionIndex` resets on session switch and on stream completion). If a user types a new prompt while viewing an older version, `messages[]` is **truncated** after that version's index before the new turn appends — later versions are discarded. The "Fork from here" action in the dropdown is the preservation path: it creates a new chat containing `messages[0..versionIndex]` and switches the user to it; the original chat is untouched. Preview swap on version select calls `WriteGeneratedCode(tsx)` (live file only, does NOT touch `cached_preview.tsx`), so on session reload the latest version is correctly restored. Future sessions: do not redesign this; the auto-fork default is intentional.
- **Multimodal messages are first-class.** User messages may contain text, images, or both. Image rendering touches ONLY the user-message branch in `messages.map` — never the assistant render branch, never `DeliverableView`. Adding new attachment types follows the same pattern: extend Go `ChatMessage` struct additively, extend frontend `Message` type, round-trip through `chatMessagesToUi` / `uiMessagesToChatPayload`, render in the user branch only. All attach handlers (paste / drop / picker) gate on `!isStreaming`.

---

## Anti-patterns (DO NOT)

- ❌ Generate UI with real icons (must use `IconSlot`)
- ❌ Use multi-color palettes — Wati primary green is the SINGLE accent
- ❌ Add multiple shadows / stacked elevation to cards
- ❌ Use `outline: none` on focus states without replacement focus indicator
- ❌ Change Harmony component default heights (32/40/48 Button, 44/36 Input, 64px Dialog padding)
- ❌ Edit `designTokens.css` token values directly — that's Figma's job
- ❌ Generate page layouts wider than 1200px content area (Wati admin is fixed-width)
- ❌ Import webfonts (no Inter, no Google Fonts, no `@font-face`) — typography is system-ui only across Fabric chrome AND generated previews
- ❌ Bundle real chart libraries (Recharts, Chart.js) in generated output — use `ChartSlot`

---

## Shipped

- **Iteration history UI** — version dropdown in preview-pane header (`V{n} of {total} ▾`). Hidden when ≤1 version. Click row → preview swaps via `WriteGeneratedCode`. Hover-revealed "Fork from here" creates a new chat containing the version prefix and switches to it. Auto-fork-on-edit is the default when typing while viewing an older version; warning appears above the chat input ("Typing will fork from Vn — Vm will be lost"). Auto-snaps to latest on stream complete. Per-message `created_at` field added to Go `ChatMessage` struct (additive, `omitempty`). See Conventions for the auto-fork rationale.
- **Collapsible sidebar (DeepSeek-style)** — sidebar toggles between expanded (240px) and collapsed (**44px**, tight single-column) via `PanelLeftClose`/`PanelLeftOpen` icon button. Collapsed mode renders a separate minimal layout: two stacked icon buttons (expand toggle on top, `Plus` new-chat below), each a 44×40 hit area with an 18px icon centered, ghost hover (`bg-[#EEEEEE]`). No divider, no chat list, no brand — every pixel is given back to chat+preview. Expanded mode keeps the full layout: collapse-toggle icon in the sidebar header (top-right), full-width "+ New chat" button, chat list below. Width + padding transition 200ms ease-out. State persisted via Go `appState.SidebarCollapsed`, accessed through `GetSidebarCollapsed()` / `SetSidebarCollapsed(bool)` Wails methods. Refactored Go `persistAppState` to preserve sibling fields (was previously overwriting the whole struct on every session change).
- **Compact chat typography** — 13px body / 14px input / `lineHeight: 1.5` / `gap-1.5` between messages / sidebar shows title only with `title="Last updated: {relative time}"` tooltip on hover. CSS-only changes, no component restructuring. Inline document content (DeliverableView, PersonaCardRow, parsePrdSections, extractFirstSentence — all in App.tsx) is explicitly off-limits to typography passes: those have their own internal scale and any future density change must NOT touch them.
- **Image attachment in chat input** — users can paste, drag-drop, or file-pick up to 5 images per message (PNG / JPEG / GIF / WebP, max 10 MB each, auto-compressed to JPEG@0.85 over 2 MB). Attached images render as thumbnail chips above the textarea with an X to remove. User messages with images render the thumbnails (max 120px) above the text bubble; clicking opens an inline lightbox modal (Esc/backdrop to close). Multimodal content is built per Anthropic SDK spec (`{ type: "image", source: { type: "base64", media_type, data }}` blocks before the text block). All attach affordances (paste/drop/picker button) are gated on `!isStreaming`. Persistence extends Go `ChatMessage` with `Images []ChatMessageImage` (omitempty). Wati-ify workflow (paste a Stripe screenshot + "rebuild this in Wati") works automatically via the existing rules layer — no rule changes required.
- **Document structure enrichment** — PRDs, engineering docs, and quality docs now require status header tables, requirements tables, callout blockquotes for risks/assumptions/questions, and inline metadata badges. Rules-only change to global.md, no rendering modifications.
- **Quality indicator strip** — three graphical chips (gap risk gauge, effort range bar, spec coverage stacked bar) computed via parallel Haiku calls after main stream completes. Renders below inline documents, above the usage/cost block. Click any chip to expand inline breakdown panel. Persisted in chat.json. Implementation lives in `frontend/src/lib/qualityMetrics.ts` (3 system prompts + JSON-validated parallel fire via `claude-haiku-4-5-20251001`) and `frontend/src/components/QualityMetricsStrip.tsx`. Fires only on artifact-producing turns (TSX or PRD); text-only assistant messages skip metrics. Per-chip failure degrades gracefully — surviving chips still render. Go side stores the JSON as `json.RawMessage` so the schema lives entirely in TS.
- **Feature flag system** — `lib/features.ts` holds `FEATURES` backed by `localStorage` (`fabric_feature_flags` key). Read once at mount via `isUiGenerationEnabled()`. `setFeature(key, value)` mutates and persists; refresh required for layout changes to apply. First flag: `uiGeneration` (default `false`). Toggle UI lives in a Settings popover anchored to the chat input footer (replaces the prior "Reset key" link — Reset API key moved inside the popover).
- **Phase 1 cutover — UI generation feature-flagged off by default.** Rules layer split: doc-structure rules in `rules/global.md` always inject; UI rules moved to `rules/ui-generation/global-ui.md` + `rules/ui-generation/archetypes/analytics.md`, gated behind `FEATURES.uiGeneration`. When flag off, `buildSystemPrompt()` emits an explicit "PRD-ONLY MODE: do not generate UI code" branch, drops the `<preview>` instructions, SHADCN_AVAILABILITY_RULES, and OUTPUT_DISCIPLINE_RULES blocks, and overrides the MANUS-mode plan template to a 4-item version (no "Build UI component" step). App.tsx hides the right-side preview pane via `uiGenEnabled && sessionHasPreview` — chat fills the full width. System prompt shrinks ~30K tokens; per-turn cost drops 40-60%. UI generation code intact and restorable by flipping the flag.

## Pending work (highest leverage first)

1. **Download buttons for artifacts** — `.md` for docs, `.jsx` for components, `.html` for previews, `.pdf` for engineering specs. *Scope: few hours.*
2. **Library** — shared folder ("Fabric Library") stores published chats as read-only. Opening a Library chat shows it in viewer mode. Any edit/prompt auto-clones to user's local workspace as a new editable chat. Original untouched. (Note: per-chat-version auto-fork-on-edit is already shipped; this is chat-level auto-fork.) *Scope: ~1.5 days.*
3. **Markdown canvas editing** — Monaco editor or textarea + markdown preview for engineering docs. Save back to chat state. *Scope: 1–2 days.*
4. **BE integration** — separate workstream. Requires auth model audit, SecOps review, Ishwarya sponsorship. Don't start without those three locked in.
5. **Windows `.exe` build** — `wails build -platform windows/amd64`. Defer until distribution model decided.

---

## Tech debt

- **Image storage is base64-inline in `chat.json`** (v1, image attachment feature). Each attached image lives as a base64 string inside the chat row. A 2 MB image is ~2.7 MB of text; 5 images × N messages will bloat `chat.json` and slow session loads. Refactor when this becomes a problem: write image bytes to a per-session `attachments/` folder on disk, store `{filename, media_type}` references in `chat.json`, garbage-collect on session delete. Migration is straightforward — Go `ChatMessageImage` struct just changes from inline `Data string` to filename reference, and `chatMessagesToUi` resolves the bytes on load.

---

## Demo prompts (canonical test cases)

Used to verify Fabric still produces consistent, Wati-grounded output after any rule or prompt change. Run both after any change to `global.md`, `archetypes/*.md`, or `systemPrompt.ts`.

1. **Campaign Analytics page** — should produce a 3-column metric grid + chart area + recent activity list. All metrics use `MetricSlot`, deltas use `DeltaBadgeSlot`, icons use `IconSlot`. Wati primary green for CTAs. No shadows on cards.

2. **Broadcast Intelligence page** — should produce structurally similar layout to Campaign Analytics but with different content (broadcast-specific metrics: open rate, click rate, delivered, failed). **Structural similarity is the proof point** — rules enforce consistency, prompts vary content.

If either prompt produces wildly different structures, the rules layer is failing.

---

## Strategic context (briefly)

- **HOP sponsor:** Ishwarya Srinivas — pitched and validated.
- **Engineering manager:** validated, granted access to Wati BE + FE repos.
- **Senior PMs:** validated, demanding broader access.
- **Distribution model:** TBD. Desktop (.exe + Mac app) is the stopgap; hosted web app is the likely future direction.

---

## Self-update protocol

This file doesn't literally self-update. It updates because you (or Claude Code, prompted by you) keeps it current.

**At the end of any session that:**
- Changes architecture, conventions, or anti-patterns
- Adds new files or moves existing files
- Completes pending work items (move from Pending → done, remove from list)
- Adds new pending work
- Changes strategic context

**…run this prompt in Claude Code:**

> *"Update CLAUDE.md to reflect what we did in this session. Keep it concise. Prune stale pending work. Don't let the file balloon past ~400 lines."*

That's the entire workflow. The discipline of running that prompt is what makes this file useful long-term. Without it, context drifts.

### Optional: weekly sync

Once a week, run:

> *"Read CLAUDE.md. Tell me what's stale, what's missing, and what should be pruned. Don't change anything yet — just propose edits."*

Then review the proposal, decide, and run the update.

---

**Last updated:** Initial creation — capture current state of Fabric after rules layer integration, prompt caching, iteration history work pending, Library + auto-fork-on-edit pending, BE integration deferred to separate workstream.
