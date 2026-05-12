# Fabric — Claude Code Context

> Loaded automatically by Claude Code at session start. **Update this file at the end of any session that changes architecture, conventions, or pending work.** See "Self-update protocol" at the bottom.

---

## What Fabric is

Wails desktop app that generates Wati-grounded UI from natural-language prompts. Built for designers and PMs (non-developers). Chat interface paired with a live preview pane. Backed by Claude via the Anthropic SDK.

**Strategic positioning:** Fabric is one consumer surface for the *rules layer* (markdown files defining Wati's design system constraints). Cursor and other AI coding tools can consume the same rules. The rules are the IP. Fabric is the delivery vehicle for non-developers.

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
│   │   ├── App.tsx                 # Main UI (chat + preview, pricing constants, fmtDollars)
│   │   ├── lib/
│   │   │   ├── systemPrompt.ts     # Prompt assembly (rules injection at lines 511-521)
│   │   │   └── chat.ts             # Streaming chat logic + usage capture
│   │   ├── rules/
│   │   │   ├── global.md           # Universal Wati rules
│   │   │   └── archetypes/
│   │   │       └── analytics.md    # Analytics page archetype
│   │   ├── components/             # Fabric's own UI components (NOT Wati's)
│   │   └── types/                  # Shared TS types
│   └── package.json
└── CLAUDE.md                       # This file
```

---

## Architecture: the rules layer

Fabric's core innovation is the rules layer — markdown files that constrain what the AI generates:

- **`frontend/src/rules/global.md`** — universal Wati rules (aesthetic, component vocabulary, tokens, slot patterns, hard rules)
- **`frontend/src/rules/archetypes/*.md`** — page-type specific rules (analytics today; list, detail, form, etc. to come)

These are imported via Vite `?raw` syntax in `systemPrompt.ts` (lines 4-5) and injected into the system prompt after `OUTPUT_DISCIPLINE_RULES`, before WATI API context (lines 511-521). Injection markers use `##` heading style to match other rule blocks.

**Critical: rules files are bundled at build time.** Editing rules requires a Vite rebuild to take effect. No hot-reload — rules are inlined into the JS bundle.

---

## Slot pattern (MANDATORY)

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
- **Iteration history — auto-fork-on-edit semantics:** A "version" is any assistant message in `messages[]` with `tsxGenerated === true`. Selecting an older version via the preview-pane dropdown is **transient view state only** (`selectedVersionIndex` resets on session switch and on stream completion). If a user types a new prompt while viewing an older version, `messages[]` is **truncated** after that version's index before the new turn appends — later versions are discarded. The "Fork from here" action in the dropdown is the preservation path: it creates a new chat containing `messages[0..versionIndex]` and switches the user to it; the original chat is untouched. Preview swap on version select calls `WriteGeneratedCode(tsx)` (live file only, does NOT touch `cached_preview.tsx`), so on session reload the latest version is correctly restored. Future sessions: do not redesign this; the auto-fork default is intentional.

---

## Anti-patterns (DO NOT)

- ❌ Generate UI with real icons (must use `IconSlot`)
- ❌ Use multi-color palettes — Wati primary green is the SINGLE accent
- ❌ Add multiple shadows / stacked elevation to cards
- ❌ Use `outline: none` on focus states without replacement focus indicator
- ❌ Change Harmony component default heights (32/40/48 Button, 44/36 Input, 64px Dialog padding)
- ❌ Edit `designTokens.css` token values directly — that's Figma's job
- ❌ Generate page layouts wider than 1200px content area (Wati admin is fixed-width)
- ❌ Use `Inter` weights below 400 or above 700 (system supports 100–900 but design uses 400/500/600/700)
- ❌ Bundle real chart libraries (Recharts, Chart.js) in generated output — use `ChartSlot`

---

## Shipped

- **Iteration history UI** — version dropdown in preview-pane header (`V{n} of {total} ▾`). Hidden when ≤1 version. Click row → preview swaps via `WriteGeneratedCode`. Hover-revealed "Fork from here" creates a new chat containing the version prefix and switches to it. Auto-fork-on-edit is the default when typing while viewing an older version; warning appears above the chat input ("Typing will fork from Vn — Vm will be lost"). Auto-snaps to latest on stream complete. Per-message `created_at` field added to Go `ChatMessage` struct (additive, `omitempty`). See Conventions for the auto-fork rationale.

## Pending work (highest leverage first)

1. **Download buttons for artifacts** — `.md` for docs, `.jsx` for components, `.html` for previews, `.pdf` for engineering specs. *Scope: few hours.*
2. **Library** — shared folder ("Fabric Library") stores published chats as read-only. Opening a Library chat shows it in viewer mode. Any edit/prompt auto-clones to user's local workspace as a new editable chat. Original untouched. (Note: per-chat-version auto-fork-on-edit is already shipped; this is chat-level auto-fork.) *Scope: ~1.5 days.*
3. **Markdown canvas editing** — Monaco editor or textarea + markdown preview for engineering docs. Save back to chat state. *Scope: 1–2 days.*
4. **Update `global.md` to reference real `--wati-*` token names** — currently references generic token concepts; should reference actual Wati token names (`--wati-color-green-500`, `--wati-spacing-3xl`, etc.) so output is correctly tokenized. *Scope: rule edit + verification.*
5. **BE integration** — separate workstream. Requires auth model audit, SecOps review, Ishwarya sponsorship. Don't start without those three locked in.
6. **Windows `.exe` build** — `wails build -platform windows/amd64`. Defer until distribution model decided.

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
