# Fabric document structure rules — Global

These rules govern the *shape* of generated documents (PRDs, engineering 
docs, quality docs). They apply on every turn regardless of mode. UI 
generation rules live separately under `rules/ui-generation/` and are 
gated by `FEATURES.uiGeneration`.

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
