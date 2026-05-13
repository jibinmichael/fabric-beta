import Anthropic from "@anthropic-ai/sdk"

export type GapRiskLevel = "low" | "medium" | "high"

export type GapRiskFlag = {
  category: string
  section: string
  description: string
}

export type GapRisk = {
  level: GapRiskLevel
  flagCount: number
  flags: GapRiskFlag[]
}

export type EffortTier = "small" | "medium" | "large" | "sprint"

export type EffortEstimate = {
  tier: EffortTier
  daysRange: string
  daysMin: number
  daysMax: number
  drivers: string[]
}

export type SpecSectionStatus = "complete" | "light" | "missing"

export type SpecSectionDetail = {
  name: string
  status: SpecSectionStatus
  suggestion: string
}

export type SpecCoverage = {
  sectionsComplete: number
  sectionsLight: number
  sectionsMissing: number
  sectionDetails: SpecSectionDetail[]
}

export type QualityMetrics = {
  gapRisk: GapRisk | null
  effortEstimate: EffortEstimate | null
  specCoverage: SpecCoverage | null
}

const METRICS_MODEL = "claude-haiku-4-5-20251001"
const MAX_TOKENS = 400
const TIMEOUT_MS = 60_000

const GAP_RISK_PROMPT = `Analyze this PRD and engineering doc. Identify ambiguities, undefined edge cases, conflicting requirements, vague success metrics, missing acceptance criteria. Be strict — flag genuine ambiguities, not stylistic preferences. Return ONLY this JSON:
{
  "level": "low" | "medium" | "high",
  "flagCount": <number>,
  "flags": [
    { "category": "<short label like 'Vague requirement' or 'Missing edge case'>",
      "section": "<which doc section it came from, e.g. 'PRD · Requirements'>",
      "description": "<one sentence explaining the ambiguity>" }
  ]
}
Severity rule: level = 'low' if flagCount <= 2, 'medium' if 3-5, 'high' if >5.`

const EFFORT_PROMPT = `Analyze this generated spec and UI. Estimate engineering effort to ship this as production code at Wati (React + Wati Harmony components). Return ONLY this JSON:
{
  "tier": "small" | "medium" | "large" | "sprint",
  "daysRange": "<string like '3-5 days'>",
  "daysMin": <number>,
  "daysMax": <number>,
  "drivers": [<list of complexity drivers as short strings>]
}
Tiers: small = <1 day, medium = 1-3 days, large = 3-7 days, sprint = 2 weeks+.
Cap daysMax at 15 for the graphical range (anything beyond renders as "15d+" visually).`

const SPEC_COVERAGE_PROMPT = `Analyze this generated spec. For each expected section, classify it as complete / light / missing. Expected sections: status header table, problem statement, user stories, requirements, success metrics, edge cases, open questions, out of scope, acceptance criteria.
Return ONLY this JSON:
{
  "sectionsComplete": <number>,
  "sectionsLight": <number>,
  "sectionsMissing": <number>,
  "sectionDetails": [
    { "name": "<section name>",
      "status": "complete" | "light" | "missing",
      "suggestion": "<one sentence on what's missing or could be stronger; empty string if complete>" }
  ]
}
Total across the three counts must equal 9 (the expected sections).`

const STRICTER_SUFFIX =
  "\n\nReturn ONLY the raw JSON object — no markdown fences, no prose, no commentary. Start the response with `{` and end with `}`."

function extractJsonObject(raw: string): unknown {
  const trimmed = raw.trim()
  // Strip ```json fences if present.
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced?.[1]?.trim() ?? trimmed
  // Take the substring between the first { and last }.
  const start = body.indexOf("{")
  const end = body.lastIndexOf("}")
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("No JSON object found in response")
  }
  return JSON.parse(body.slice(start, end + 1))
}

async function callHaiku(
  client: Anthropic,
  systemPrompt: string,
  userContent: string,
): Promise<string> {
  const controller = new AbortController()
  const timeoutId = globalThis.setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const response = await client.messages.create(
      {
        model: METRICS_MODEL,
        max_tokens: MAX_TOKENS,
        system: systemPrompt,
        messages: [{ role: "user", content: userContent }],
      },
      { signal: controller.signal },
    )
    const textBlock = response.content.find((b) => b.type === "text")
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text block in response")
    }
    return textBlock.text
  } finally {
    globalThis.clearTimeout(timeoutId)
  }
}

async function runMetric<T>(
  client: Anthropic,
  systemPrompt: string,
  userContent: string,
  validate: (parsed: unknown) => T,
): Promise<T | null> {
  try {
    const raw = await callHaiku(client, systemPrompt, userContent)
    return validate(extractJsonObject(raw))
  } catch (_err) {
    // Retry once with stricter instruction.
    try {
      const raw = await callHaiku(client, systemPrompt + STRICTER_SUFFIX, userContent)
      return validate(extractJsonObject(raw))
    } catch (_err2) {
      return null
    }
  }
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback
}

function asNumber(v: unknown, fallback = 0): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}

function asArray<T>(v: unknown, mapper: (item: unknown) => T | null): T[] {
  if (!Array.isArray(v)) return []
  const out: T[] = []
  for (const item of v) {
    const mapped = mapper(item)
    if (mapped !== null) out.push(mapped)
  }
  return out
}

function validateGapRisk(parsed: unknown): GapRisk {
  const obj = parsed as Record<string, unknown>
  const flags = asArray<GapRiskFlag>(obj.flags, (item) => {
    if (!item || typeof item !== "object") return null
    const f = item as Record<string, unknown>
    return {
      category: asString(f.category, "Issue"),
      section: asString(f.section, ""),
      description: asString(f.description, ""),
    }
  })
  let level = asString(obj.level, "low") as GapRiskLevel
  if (level !== "low" && level !== "medium" && level !== "high") level = "low"
  const flagCount = asNumber(obj.flagCount, flags.length)
  return { level, flagCount, flags }
}

function validateEffort(parsed: unknown): EffortEstimate {
  const obj = parsed as Record<string, unknown>
  let tier = asString(obj.tier, "medium") as EffortTier
  if (tier !== "small" && tier !== "medium" && tier !== "large" && tier !== "sprint") {
    tier = "medium"
  }
  const daysMin = Math.max(0, Math.min(15, asNumber(obj.daysMin, 1)))
  const daysMax = Math.max(daysMin, Math.min(15, asNumber(obj.daysMax, 3)))
  const drivers = asArray<string>(obj.drivers, (item) =>
    typeof item === "string" && item.trim().length > 0 ? item.trim() : null,
  )
  return {
    tier,
    daysRange: asString(obj.daysRange, `${daysMin}-${daysMax} days`),
    daysMin,
    daysMax,
    drivers,
  }
}

function validateSpecCoverage(parsed: unknown): SpecCoverage {
  const obj = parsed as Record<string, unknown>
  const sectionDetails = asArray<SpecSectionDetail>(obj.sectionDetails, (item) => {
    if (!item || typeof item !== "object") return null
    const f = item as Record<string, unknown>
    let status = asString(f.status, "missing") as SpecSectionStatus
    if (status !== "complete" && status !== "light" && status !== "missing") {
      status = "missing"
    }
    return {
      name: asString(f.name, "Section"),
      status,
      suggestion: asString(f.suggestion, ""),
    }
  })
  let sectionsComplete = Math.max(0, asNumber(obj.sectionsComplete, 0))
  let sectionsLight = Math.max(0, asNumber(obj.sectionsLight, 0))
  let sectionsMissing = Math.max(0, asNumber(obj.sectionsMissing, 0))
  // If totals don't add to 9, recompute from sectionDetails when possible.
  const total = sectionsComplete + sectionsLight + sectionsMissing
  if (total !== 9 && sectionDetails.length > 0) {
    sectionsComplete = sectionDetails.filter((s) => s.status === "complete").length
    sectionsLight = sectionDetails.filter((s) => s.status === "light").length
    sectionsMissing = sectionDetails.filter((s) => s.status === "missing").length
  }
  return { sectionsComplete, sectionsLight, sectionsMissing, sectionDetails }
}

export async function computeQualityMetrics(
  apiKey: string,
  generatedContent: string,
): Promise<QualityMetrics> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true })
  const [gapRisk, effortEstimate, specCoverage] = await Promise.all([
    runMetric(client, GAP_RISK_PROMPT, generatedContent, validateGapRisk),
    runMetric(client, EFFORT_PROMPT, generatedContent, validateEffort),
    runMetric(client, SPEC_COVERAGE_PROMPT, generatedContent, validateSpecCoverage),
  ])
  return { gapRisk, effortEstimate, specCoverage }
}
