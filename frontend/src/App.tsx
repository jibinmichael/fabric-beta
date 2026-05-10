import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import {
  BootstrapSessions,
  ClearApiKey,
  CreateSession,
  DeleteSession,
  GetActiveSessionID,
  GetApiKey,
  GetPreviewPort,
  GetPreviewStatus,
  GetSessionPRD,
  ListSessions,
  LoadSession,
  RenameSession,
  SaveApiKey,
  SaveMessages,
  SaveSessionPRD,
  SaveSessionPreview,
} from "../wailsjs/go/main/App"
import { EventsOn } from "../wailsjs/runtime/runtime"
import { MoreHorizontal, ChevronRight, FileText, CheckCircle, Wrench } from "lucide-react"
import { streamChat, type ClaudeMessage } from "@/lib/claude"
import { buildSystemPrompt } from "@/lib/systemPrompt"
import type { Usage } from "@anthropic-ai/sdk/resources/messages"
import { main } from "../wailsjs/go/models"

// Feature flag — when true, parses the PRD into PM/QA/Engineering
// cards rendered inline in chat, and hides the right-panel PRD tab
// (preview-only). Flip to false to revert to single-PRD-tab behavior.
const MANUS_CARDS_MODE = true

// Anthropic Claude Sonnet 4.6 pricing per 1M tokens.
// Verify against https://www.anthropic.com/pricing periodically.
const PRICE_INPUT_PER_M = 3.00
const PRICE_OUTPUT_PER_M = 15.00
const PRICE_CACHE_WRITE_PER_M = 3.75   // 1.25× input
const PRICE_CACHE_READ_PER_M = 0.30    // 0.10× input

type PlanItem = {
  text: string
  status: "queued" | "active" | "done"
}

type PersonaCardData = {
  type: "pm" | "qa" | "engineering"
  title: string
  fullContent: string
  snippet: string
  wordCount: number
  highlights?: string[]
}

type DeliverableSummary = {
  featureTitle: string
  introduction: string
  mockDataCallout?: string
  cards: PersonaCardData[]
}

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  isError?: boolean
  isStatus?: boolean
  isGenerating?: boolean
  statusSubtext?: string
  tsxGenerated?: boolean
  planItems?: PlanItem[]
  deliverable?: DeliverableSummary
  usage?: Usage
}

type SessionMetaView = {
  id: string
  title: string
  createdAt: Date
  updatedAt: Date
}

function extractTsxCode(text: string): string | null {
  const fenceMatch = text.match(/```(?:tsx?|jsx?)?\n([\s\S]*?)```/)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }

  const trimmed = text.trim()
  if (/^(import |export |function |const |interface |type )/.test(trimmed)) {
    return trimmed
  }

  return null
}

/** When <preview> is absent or unmatched: fenced TSX blocks (prefer last), then line-start heuristics. */
function extractTsxFallbacks(fullText: string): string | null {
  const fenceRe = /```(?:tsx?|typescript|jsx?)\s*\n([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  let lastFence: string | null = null
  while ((m = fenceRe.exec(fullText)) !== null) {
    const inner = m[1]?.trim()
    if (inner) {
      lastFence = stripPreviewFence(inner)
    }
  }
  if (lastFence) {
    return lastFence
  }

  const looseFence = extractTsxCode(fullText)
  if (looseFence) {
    return looseFence
  }

  const lines = fullText.split("\n")
  let start = -1
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim()
    if (/^(import |export default function |export function |function |const |interface |type )/.test(t)) {
      start = i
      break
    }
  }
  if (start >= 0) {
    const candidate = lines.slice(start).join("\n").trim()
    if (candidate.length >= 40) {
      return candidate
    }
  }

  return null
}

/** Strips optional markdown fences if Claude wrapped TSX inside &lt;preview&gt; despite instructions. */
function stripPreviewFence(tsx: string): string {
  const s = tsx.trim()
  const fence = s.match(/^```(?:tsx?|jsx?)?\s*\n([\s\S]*?)```\s*$/m)
  if (fence) {
    return fence[1].trim()
  }
  return s
}

function extractPreviewAndPrd(fullText: string): { tsx: string | null; prd: string | null } {
  const previewMatch = fullText.match(/<preview>([\s\S]*?)<\/preview>/i)
  const prdMatch = fullText.match(/<prd>([\s\S]*?)<\/prd>/i)

  let tsx: string | null = null
  if (previewMatch?.[1] !== undefined) {
    const stripped = stripPreviewFence(previewMatch[1])
    tsx = stripped.length > 0 ? stripped : null
  }

  let prd: string | null = prdMatch?.[1]?.trim() ?? null
  if (prd === "") {
    prd = null
  }

  return { tsx, prd }
}

function parsePlanFromStream(streamedText: string): string[] | null {
  const match = streamedText.match(/<plan>([\s\S]*?)<\/plan>/i)
  if (!match) return null
  const body = match[1]
  const items = body
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim())
    .filter((line) => line.length > 0)
  return items.length > 0 ? items : null
}

function computePlanProgress(items: string[], streamedText: string): PlanItem[] {
  // Section markers map to plan item indices that COMPLETE when seen.
  // Order matches the canonical 5-item UI generation plan; for shorter
  // plans (questions, tweaks), markers may not appear and items stay
  // active/queued until stream ends.
  const markers = [
    { match: "## 1. Product", completesIndex: 0 },
    { match: "## 2. QA & Acceptance", completesIndex: 1 },
    { match: "## 3. Engineering", completesIndex: 2 },
    { match: "<preview>", completesIndex: 3 },
  ]
  let highestComplete = -1
  for (const m of markers) {
    if (streamedText.includes(m.match)) {
      if (m.completesIndex > highestComplete) {
        highestComplete = m.completesIndex
      }
    }
  }
  return items.map((text, idx) => {
    let status: PlanItem["status"]
    if (idx <= highestComplete) status = "done"
    else if (idx === highestComplete + 1) status = "active"
    else status = "queued"
    return { text, status }
  })
}

function stripPlanBlock(text: string): string {
  return text.replace(/<plan>[\s\S]*?<\/plan>\s*/i, "").trimStart()
}

function extractFirstSentence(content: string): string {
  const trimmed = content.trim()
  if (!trimmed) return ""
  const firstPara = trimmed.split(/\n\n/)[0] ?? ""
  const cleaned = firstPara
    .replace(/^#+\s+.*\n?/, "")
    .replace(/^\s*[-*]\s+/, "")
    .replace(/\n/g, " ")
    .trim()
  if (cleaned.length <= 140) return cleaned
  const sentenceMatch = cleaned.match(/^.{30,200}?[.!?](?:\s|$)/)
  if (sentenceMatch) return sentenceMatch[0].trim()
  return cleaned.slice(0, 140).trim() + "..."
}

function parsePrdSections(prdContent: string): DeliverableSummary | null {
  if (!prdContent || prdContent.trim().length === 0) return null

  const titleMatch = prdContent.match(/^#\s+(.+?)\s*$/m)
  if (!titleMatch) return null
  const featureTitle = titleMatch[1].trim()

  const introMatch = prdContent.match(
    /##\s*Introduction\s*\n([\s\S]*?)(?=\n\s*⚠|\n##\s|$)/i,
  )
  const introduction = introMatch ? introMatch[1].trim() : ""

  const mockMatch = prdContent.match(
    /⚠\s*\*{0,2}MOCK DATA\*{0,2}[^\n]*[\s\S]*?(?=\n##\s|$)/i,
  )
  const mockDataCallout = mockMatch ? mockMatch[0].trim() : undefined

  const pmMatch = prdContent.match(
    /##\s*1\.\s*Product[^\n]*\n([\s\S]*?)(?=\n##\s*2\.|$)/i,
  )
  const qaMatch = prdContent.match(
    /##\s*2\.\s*QA[^\n]*\n([\s\S]*?)(?=\n##\s*3\.|$)/i,
  )
  const engMatch = prdContent.match(
    /##\s*3\.\s*Engineering[^\n]*\n([\s\S]*?)$/i,
  )

  const pmContent = pmMatch ? pmMatch[1].trim() : ""
  const qaContent = qaMatch ? qaMatch[1].trim() : ""
  const engContent = engMatch ? engMatch[1].trim() : ""

  if (!pmContent && !qaContent && !engContent) return null

  const cards: PersonaCardData[] = []

  if (pmContent) {
    cards.push({
      type: "pm",
      title: "Product Brief",
      fullContent: pmContent,
      snippet: extractFirstSentence(pmContent),
      wordCount: pmContent.split(/\s+/).filter(Boolean).length,
    })
  }

  if (qaContent) {
    const scenarioCount = (qaContent.match(/(?:^|\n)\s*[-*]?\s*Given\s/gi) || []).length
    cards.push({
      type: "qa",
      title: "QA & Acceptance",
      fullContent: qaContent,
      snippet: extractFirstSentence(qaContent),
      wordCount: qaContent.split(/\s+/).filter(Boolean).length,
      highlights: scenarioCount > 0 ? [`${scenarioCount} scenarios`] : undefined,
    })
  }

  if (engContent) {
    const gapCount = (engContent.match(/⚠\s*GAP/gi) || []).length
    cards.push({
      type: "engineering",
      title: "Engineering Notes",
      fullContent: engContent,
      snippet: extractFirstSentence(engContent),
      wordCount: engContent.split(/\s+/).filter(Boolean).length,
      highlights: gapCount > 0 ? [`${gapCount} gaps`] : undefined,
    })
  }

  return { featureTitle, introduction, mockDataCallout, cards }
}

function formatPreviewStatus(status: string): string {
  if (status.startsWith("error:")) {
    return status
  }

  switch (status) {
    case "":
      return "Starting preview server..."
    case "copying-template":
      return "Preparing preview template..."
    case "installing-dependencies":
      return "Installing preview dependencies..."
    case "starting-vite":
      return "Starting preview runtime..."
    case "ready":
      return "Preview ready."
    default:
      return "Starting preview server..."
  }
}

function parseSessionDate(value: unknown): Date {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value
  }
  if (typeof value === "string") {
    const d = new Date(value)
    return Number.isNaN(d.getTime()) ? new Date() : d
  }
  return new Date()
}

function sessionMetaFromMain(m: main.SessionMeta): SessionMetaView {
  return {
    id: m.id,
    title: m.title,
    createdAt: parseSessionDate(m.created_at),
    updatedAt: parseSessionDate(m.updated_at),
  }
}

function formatSessionTimestamp(d: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d)
}

function chatMessagesToUi(messages: main.ChatMessage[] | undefined | null): Message[] {
  if (!messages?.length) {
    return []
  }
  return messages.map((row, index) => {
    let deliverable: DeliverableSummary | undefined
    if (row.role === "assistant" && row.content) {
      const prdMatch = row.content.match(/<prd>([\s\S]*?)<\/prd>/i)
      const prdMd = prdMatch?.[1]?.trim()
      if (prdMd) {
        const parsed = parsePrdSections(prdMd)
        if (parsed) {
          deliverable = parsed
        }
      }
    }
    return {
      id: `persisted-${index}-${row.role}`,
      role: row.role as "user" | "assistant",
      content: row.content,
      tsxGenerated: Boolean(row.tsx_generated),
      isStatus: row.role === "assistant" && Boolean(row.tsx_generated),
      isError: false,
      isGenerating: false,
      statusSubtext:
        row.role === "assistant" && row.tsx_generated ? "Click the preview to interact." : undefined,
      deliverable,
    }
  })
}

function uiMessagesToChatPayload(messages: Message[]): main.ChatMessage[] {
  return messages
    .filter((m) => !m.isGenerating)
    .map((m) => {
      const cm = new main.ChatMessage({
        role: m.role,
        content: m.content,
        tsx_generated: Boolean(m.role === "assistant" && m.tsxGenerated),
      })
      return cm
    })
}

function assistantDisplayContent(m: Message): { body: string; sub?: string } {
  if (m.role === "assistant" && m.isGenerating) {
    if (m.planItems && m.planItems.length > 0) {
      return { body: "__PLAN__", sub: undefined }
    }
    return { body: "__THINKING__", sub: undefined }
  }
  // After generation, if a plan exists, keep showing it (all items now in
  // done state). Replaces the legacy "Preview updated" text for Manus-mode
  // messages.
  if (m.role === "assistant" && !m.isGenerating && m.planItems && m.planItems.length > 0) {
    return { body: "__PLAN__", sub: undefined }
  }
  // Fallback for non-Manus-mode messages (no planItems).
  if (m.role === "assistant" && m.tsxGenerated && !m.isGenerating) {
    return { body: "Preview updated.", sub: m.statusSubtext ?? "Click the preview to interact." }
  }
  return { body: m.content, sub: m.statusSubtext }
}

function ThinkingIndicator() {
  return (
    <span
      className="inline-flex items-baseline gap-1"
      style={{
        color: "#666666",
        fontSize: 14,
        lineHeight: 1.6,
        fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
      }}
    >
      <span>Thinking</span>
      <span className="inline-flex" aria-hidden style={{ letterSpacing: "0.02em" }}>
        <span
          className="fabric-thinking-dot inline-block"
          style={{ animationDelay: "0ms" }}
        >
          .
        </span>
        <span
          className="fabric-thinking-dot inline-block"
          style={{ animationDelay: "200ms" }}
        >
          .
        </span>
        <span
          className="fabric-thinking-dot inline-block"
          style={{ animationDelay: "400ms" }}
        >
          .
        </span>
      </span>
    </span>
  )
}

function PlanIndicator({ items }: { items: PlanItem[] }) {
  return (
    <div
      className="flex flex-col gap-1.5"
      style={{
        fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      {items.map((item, idx) => {
        const color =
          item.status === "done"
            ? "#1A1A1A"
            : item.status === "active"
              ? "#1A1A1A"
              : "#999999"
        const icon =
          item.status === "done" ? "✓" : item.status === "active" ? "◐" : "▢"
        const isActive = item.status === "active"
        return (
          <div key={idx} className="flex items-baseline gap-2" style={{ color }}>
            <span
              aria-hidden
              style={{
                width: 14,
                display: "inline-block",
                fontSize: 12,
              }}
              className={isActive ? "fabric-thinking-dot" : ""}
            >
              {icon}
            </span>
            <span style={{ fontWeight: item.status === "done" ? 400 : 500 }}>{item.text}</span>
          </div>
        )
      })}
    </div>
  )
}

function PersonaCardRow({
  card,
  expanded,
  onToggle,
}: {
  card: PersonaCardData
  expanded: boolean
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)

  const Icon =
    card.type === "pm"
      ? FileText
      : card.type === "qa"
        ? CheckCircle
        : Wrench

  const iconColor =
    card.type === "pm"
      ? "#2563EB"
      : card.type === "qa"
        ? "#16A34A"
        : "#D97706"

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        border: `1px solid ${hovered || expanded ? "#DDDDDD" : "#EEEEEE"}`,
        borderRadius: 8,
        backgroundColor: "#FFFFFF",
        overflow: "hidden",
        boxShadow: hovered
          ? "0 2px 4px rgba(0, 0, 0, 0.06), 0 1px 2px rgba(0, 0, 0, 0.04)"
          : "0 1px 2px rgba(0, 0, 0, 0.03)",
        transition:
          "box-shadow 180ms ease, border-color 180ms ease",
      }}
    >
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full cursor-pointer items-center justify-between gap-3 border-0 text-left"
        style={{
          padding: "12px 14px",
          backgroundColor: expanded ? "#FAFAFA" : "#FFFFFF",
          borderBottom: expanded ? "1px solid #EEEEEE" : "none",
          transition: "background-color 150ms ease",
          fontFamily:
            "Avenir Next, Avenir, system-ui, sans-serif",
        }}
      >
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Icon
            size={16}
            strokeWidth={2}
            style={{ color: iconColor, flexShrink: 0 }}
          />
          <div
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#1A1A1A",
              lineHeight: 1.4,
            }}
          >
            {card.title}
          </div>
        </div>
        <div
          className="flex shrink-0 items-center gap-2"
          style={{ fontSize: 11 }}
        >
          {card.highlights?.map((h) => (
            <span
              key={h}
              style={{
                padding: "2px 8px",
                borderRadius: 4,
                backgroundColor: "#F5F5F5",
                color: "#666666",
                fontWeight: 500,
              }}
            >
              {h}
            </span>
          ))}
          <ChevronRight
            size={14}
            style={{
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 200ms ease",
              color: "#999999",
              marginLeft: 2,
            }}
          />
        </div>
      </button>

      {!expanded && card.snippet ? (
        <div
          style={{
            padding: "0 14px 12px 42px",
            fontSize: 12,
            fontWeight: 400,
            color: "#666666",
            lineHeight: 1.55,
          }}
          className="line-clamp-2"
        >
          {card.snippet}
        </div>
      ) : null}

      {expanded ? (
        <div
          className="fabric-prd-markdown"
          style={{
            padding: "16px 18px 18px 18px",
            backgroundColor: "#FFFFFF",
          }}
        >
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {card.fullContent}
          </ReactMarkdown>
        </div>
      ) : null}
    </div>
  )
}

function DeliverableView({ deliverable }: { deliverable: DeliverableSummary }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggle = (type: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      return next
    })
  }

  return (
    <div
      className="mt-3 flex flex-col gap-2.5"
      style={{ fontFamily: "Avenir Next, Avenir, system-ui, sans-serif" }}
    >
      <div
        className="flex items-baseline gap-1.5"
        style={{
          fontSize: 12,
          fontWeight: 500,
          color: "#16A34A",
          fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 11,
          }}
        >
          ✓
        </span>
        <span>Task complete</span>
      </div>
      <div
        style={{
          fontSize: 15,
          fontWeight: 600,
          color: "#1A1A1A",
          lineHeight: 1.3,
        }}
      >
        {deliverable.featureTitle}
      </div>
      {deliverable.introduction ? (
        <div
          style={{
            fontSize: 13,
            fontWeight: 400,
            color: "#666666",
            lineHeight: 1.55,
          }}
        >
          {deliverable.introduction}
        </div>
      ) : null}
      {deliverable.mockDataCallout ? (
        <div
          style={{
            border: "1px solid #EEEEEE",
            borderRadius: 6,
            backgroundColor: "#FAFAFA",
            padding: "8px 12px",
            fontSize: 12,
            lineHeight: 1.5,
            color: "#666666",
          }}
        >
          {deliverable.mockDataCallout}
        </div>
      ) : null}
      <div className="flex flex-col gap-1.5">
        {deliverable.cards.map((card) => (
          <PersonaCardRow
            key={card.type}
            card={card}
            expanded={expanded.has(card.type)}
            onToggle={() => toggle(card.type)}
          />
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [apiKey, setApiKey] = useState<string | null>(null)
  const [isApiKeyLoaded, setIsApiKeyLoaded] = useState(false)
  const [sessionsReady, setSessionsReady] = useState(false)
  const [isSavingKey, setIsSavingKey] = useState(false)
  const [keyInput, setKeyInput] = useState("")
  const [keyError, setKeyError] = useState<string | null>(null)

  const [sessions, setSessions] = useState<SessionMetaView[]>([])
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null)
  const [sessionTitle, setSessionTitle] = useState("New chat")

  const [messages, setMessages] = useState<Message[]>([])
  const [isStreaming, setIsStreaming] = useState(false)
  const [inputText, setInputText] = useState("")
  const [previewPort, setPreviewPort] = useState(0)
  const [previewStatus, setPreviewStatus] = useState("")
  const [rightPanelView, setRightPanelView] = useState<"preview" | "prd">("preview")
  const [currentPRD, setCurrentPRD] = useState("")

  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)
  const iframeReloadTimeoutRef = useRef<number | null>(null)
  const nextIdRef = useRef(0)
  const streamingTextRef = useRef<string>("")
  const planParsedRef = useRef<boolean>(false)
  const detectedMarkersRef = useRef<Set<string>>(new Set())

  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    sessionId: string
  } | null>(null)

  const [toast, setToast] = useState<string | null>(null)
  const toastTimeoutRef = useRef<number | null>(null)

  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState("")
  const renameInputRef = useRef<HTMLInputElement>(null)
  const renameBlurSkipRef = useRef(false)

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const showToast = useCallback((message: string) => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current)
    }
    setToast(message)
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null)
      toastTimeoutRef.current = null
    }, 2500)
  }, [])

  const refreshSessionList = useCallback(
    async (activeIdForTitle?: string | null) => {
      const list = await ListSessions()
      const mapped = list.map(sessionMetaFromMain)
      setSessions(mapped)
      setSessionTitle((prevTitle) => {
        const id =
          activeIdForTitle !== undefined && activeIdForTitle !== null
            ? activeIdForTitle
            : activeSessionId
        const active = id ? mapped.find((s) => s.id === id) : undefined
        return active ? active.title : prevTitle
      })
    },
    [activeSessionId],
  )

  const applySessionData = useCallback((data: main.SessionData) => {
    setActiveSessionId(data.meta.id)
    setSessionTitle(data.meta.title)
    const ui = chatMessagesToUi(data.messages ?? [])
    setMessages(ui)
    nextIdRef.current = ui.length + 1
    setCurrentPRD(data.prd ?? "")
  }, [])

  useEffect(() => {
    async function loadApiKey() {
      const saved = await GetApiKey()
      if (saved) {
        setApiKey(saved)
      } else {
        setApiKey(null)
      }
      setIsApiKeyLoaded(true)
    }

    loadApiKey().catch(() => {
      setApiKey(null)
      setIsApiKeyLoaded(true)
    })
  }, [])

  useEffect(() => {
    if (!isApiKeyLoaded) {
      return
    }
    let cancelled = false
    ;(async () => {
      try {
        const data = await BootstrapSessions()
        if (cancelled) {
          return
        }
        applySessionData(data)
        await refreshSessionList(data.meta.id)
      } catch (err) {
        console.error("BootstrapSessions:", err)
      } finally {
        if (!cancelled) {
          setSessionsReady(true)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isApiKeyLoaded, applySessionData, refreshSessionList])

  useEffect(() => {
    const off = EventsOn("preview:updated", () => {
      if (iframeReloadTimeoutRef.current) {
        window.clearTimeout(iframeReloadTimeoutRef.current)
      }
      iframeReloadTimeoutRef.current = window.setTimeout(() => {
        const frame = iframeRef.current
        if (frame && frame.src) {
          frame.src = frame.src
        }
      }, 200)
    })

    return () => {
      off()
      if (iframeReloadTimeoutRef.current) {
        window.clearTimeout(iframeReloadTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    const off = EventsOn("prd:updated", () => {
      void (async () => {
        try {
          const id = await GetActiveSessionID()
          if (!id) {
            return
          }
          const text = await GetSessionPRD(id)
          setCurrentPRD(text)
        } catch (err) {
          console.error("GetSessionPRD:", err)
        }
      })()
    })
    return () => off()
  }, [])

  useEffect(() => {
    let stopped = false
    const timeout = window.setTimeout(() => {
      stopped = true
    }, 30000)

    const interval = window.setInterval(async () => {
      if (stopped) {
        return
      }

      try {
        const [port, status] = await Promise.all([GetPreviewPort(), GetPreviewStatus()])
        if (stopped) {
          return
        }
        setPreviewStatus(status)
        if (port > 0) {
          setPreviewPort(port)
          window.clearInterval(interval)
        }
      } catch {
        // Keep polling; backend may still be starting.
      }
    }, 500)

    return () => {
      stopped = true
      window.clearInterval(timeout)
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    const node = messagesContainerRef.current
    if (!node) {
      return
    }
    node.scrollTop = node.scrollHeight
  }, [messages, isStreaming])

  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const close = () => setContextMenu(null)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [contextMenu])

  useEffect(() => {
    if (!contextMenu) {
      return
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setContextMenu(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [contextMenu])

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current !== null) {
        window.clearTimeout(toastTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!renamingSessionId) {
      return
    }
    const el = renameInputRef.current
    if (!el) {
      return
    }
    el.focus()
    el.select()
  }, [renamingSessionId])

  useEffect(() => {
    if (!deleteConfirmId) {
      return
    }
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        setDeleteConfirmId(null)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [deleteConfirmId])

  const persistChat = useCallback(
    async (msgs: Message[]) => {
      if (!activeSessionId) {
        return
      }
      try {
        await SaveMessages(activeSessionId, uiMessagesToChatPayload(msgs))
        await refreshSessionList()
      } catch (err) {
        console.error("SaveMessages:", err)
      }
    },
    [activeSessionId, refreshSessionList],
  )

  const canSend = useMemo(() => {
    return Boolean(apiKey) && !isStreaming && inputText.trim().length > 0 && Boolean(activeSessionId)
  }, [apiKey, inputText, isStreaming, activeSessionId])

  const sessionHasPreview = messages.some(
    (m) => m.role === "assistant" && m.tsxGenerated === true,
  )

  const handleSelectSession = async (id: string) => {
    if (isStreaming || id === activeSessionId) {
      if (isStreaming) {
        showToast("Wait for the current generation to finish")
      }
      return
    }
    try {
      const data = await LoadSession(id)
      applySessionData(data)
      setRightPanelView("preview")
      await refreshSessionList(id)
    } catch (err) {
      console.error("LoadSession:", err)
    }
  }

  const handleNewSession = async () => {
    if (isStreaming) {
      showToast("Wait for the current generation to finish")
      return
    }
    try {
      const meta = await CreateSession()
      setMessages([])
      setActiveSessionId(meta.id)
      setSessionTitle(meta.title)
      setCurrentPRD("")
      nextIdRef.current = 0
      setRightPanelView("preview")
      const data = await LoadSession(meta.id)
      applySessionData(data)
      await refreshSessionList(meta.id)
    } catch (err) {
      console.error("CreateSession:", err)
    }
  }

  const beginRenameSession = (id: string) => {
    const current = sessions.find((s) => s.id === id)?.title ?? ""
    setRenameDraft(current)
    setRenamingSessionId(id)
  }

  const cancelRenameSession = () => {
    renameBlurSkipRef.current = true
    setRenamingSessionId(null)
    setRenameDraft("")
    window.setTimeout(() => {
      renameBlurSkipRef.current = false
    }, 0)
  }

  const commitRenameSession = async () => {
    const id = renamingSessionId
    if (!id) {
      return
    }
    const trimmed = renameDraft.trim()
    if (trimmed.length === 0) {
      showToast("Session name cannot be empty")
      return
    }
    try {
      await RenameSession(id, trimmed)
      await refreshSessionList()
      if (id === activeSessionId) {
        setSessionTitle(trimmed)
      }
      renameBlurSkipRef.current = true
      setRenamingSessionId(null)
      setRenameDraft("")
      window.setTimeout(() => {
        renameBlurSkipRef.current = false
      }, 0)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rename failed"
      showToast(msg)
    }
  }

  const confirmDeleteSession = async () => {
    const id = deleteConfirmId
    if (!id) {
      return
    }
    const wasActive = id === activeSessionId
    try {
      await DeleteSession(id)
      setDeleteConfirmId(null)
      showToast("Session deleted")
      if (wasActive) {
        const newActive = await GetActiveSessionID()
        if (newActive) {
          const data = await LoadSession(newActive)
          applySessionData(data)
          setRightPanelView("preview")
          await refreshSessionList(newActive)
        } else {
          setActiveSessionId(null)
          setMessages([])
          setSessionTitle("New chat")
          setCurrentPRD("")
          nextIdRef.current = 0
          await refreshSessionList()
        }
      } else {
        await refreshSessionList()
      }
    } catch (err) {
      console.error("DeleteSession:", err)
      const msg = err instanceof Error ? err.message : "Delete failed"
      showToast(msg)
    }
  }

  const submitMessage = async () => {
    if (!apiKey || !canSend || !activeSessionId) {
      return
    }

    const userContent = inputText.trim()

    const userMessage: Message = {
      id: `msg-${nextIdRef.current++}`,
      role: "user",
      content: userContent,
    }
    const assistantPlaceholder: Message = {
      id: `msg-${nextIdRef.current++}`,
      role: "assistant",
      content: "Generating preview...",
      isStatus: true,
      isGenerating: true,
    }

    const contextMessages: ClaudeMessage[] = [
      ...messages
        .filter((msg) => !msg.isError && msg.content.trim().length > 0 && !msg.isGenerating)
        .map((msg) => {
          if (msg.role === "assistant" && msg.tsxGenerated) {
            return {
              role: "assistant" as const,
              content: msg.content || "Preview updated.",
            }
          }
          return { role: msg.role, content: msg.content }
        }),
      { role: "user", content: userContent },
    ]

    setMessages((prev) => [...prev, userMessage, assistantPlaceholder])
    setInputText("")
    setIsStreaming(true)
    streamingTextRef.current = ""
    planParsedRef.current = false
    detectedMarkersRef.current = new Set()
    const systemPrompt = buildSystemPrompt()

    await streamChat(
      apiKey,
      systemPrompt,
      contextMessages,
      (text: string) => {
        streamingTextRef.current += text
        const accumulated = streamingTextRef.current

        // First, parse plan if not yet parsed and </plan> has appeared
        if (!planParsedRef.current && accumulated.includes("</plan>")) {
          planParsedRef.current = true
          const items = parsePlanFromStream(accumulated)
          if (items && items.length > 0) {
            const initialPlan: PlanItem[] = items.map((t, idx) => ({
              text: t,
              status: idx === 0 ? "active" : "queued",
            }))
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantPlaceholder.id ? { ...msg, planItems: initialPlan } : msg,
              ),
            )
          }
        }

        // Then, watch for new section markers and update plan progress
        if (planParsedRef.current) {
          const markers = ["## 1. Product", "## 2. QA & Acceptance", "## 3. Engineering", "<preview>"]
          let newMarkerHit = false
          for (const m of markers) {
            if (!detectedMarkersRef.current.has(m) && accumulated.includes(m)) {
              detectedMarkersRef.current.add(m)
              newMarkerHit = true
            }
          }
          if (newMarkerHit) {
            setMessages((prev) =>
              prev.map((msg) => {
                if (msg.id !== assistantPlaceholder.id || !msg.planItems) {
                  return msg
                }
                const updatedItems = computePlanProgress(
                  msg.planItems.map((p) => p.text),
                  accumulated,
                )
                return { ...msg, planItems: updatedItems }
              }),
            )
          }
        }
      },
      (errorText) => {
        setMessages((prev) => {
          const next = prev.map((msg) =>
            msg.id === assistantPlaceholder.id
              ? {
                  ...msg,
                  content: errorText || "Unknown error",
                  isError: true,
                  isStatus: false,
                  isGenerating: false,
                }
              : msg,
          )
          void persistChat(next)
          return next
        })
        setIsStreaming(false)
      },
      async (fullText, usage) => {
        // Mark all plan items as done when streaming completes.
        setMessages((prev) =>
          prev.map((msg) => {
            if (msg.id !== assistantPlaceholder.id || !msg.planItems) {
              return msg
            }
            return {
              ...msg,
              planItems: msg.planItems.map((p) => ({ ...p, status: "done" })),
            }
          }),
        )

        const parsed = extractPreviewAndPrd(fullText)
        const tsxExtracted = parsed.tsx ?? extractTsxFallbacks(fullText)
        const prdMd = parsed.prd

        const tsxCode = tsxExtracted

        if (tsxCode) {
          try {
            await SaveSessionPreview(activeSessionId, tsxCode)
            if (prdMd) {
              await SaveSessionPRD(activeSessionId, prdMd)
              setCurrentPRD(prdMd)
            }
            const deliverable = prdMd ? parsePrdSections(prdMd) : null
            setMessages((prev) => {
              const next = prev.map((msg) =>
                msg.id === assistantPlaceholder.id
                  ? {
                      ...msg,
                      content: stripPlanBlock(fullText),
                      tsxGenerated: true,
                      isStatus: true,
                      isGenerating: false,
                      statusSubtext: "Click the preview to interact.",
                      deliverable: deliverable ?? undefined,
                      usage,
                    }
                  : msg,
              )
              void persistChat(next)
              return next
            })
            showToast("Preview ready")
          } catch (err) {
            console.error("Failed to save preview:", err)
            setMessages((prev) => {
              const next = prev.map((msg) =>
                msg.id === assistantPlaceholder.id
                  ? {
                      ...msg,
                      content: "Failed to update preview.",
                      isError: true,
                      isStatus: false,
                      isGenerating: false,
                    }
                  : msg,
              )
              void persistChat(next)
              return next
            })
          }
        } else if (prdMd) {
          try {
            await SaveSessionPRD(activeSessionId, prdMd)
            setCurrentPRD(prdMd)
            const deliverable = parsePrdSections(prdMd)
            setMessages((prev) => {
              const next = prev.map((msg) =>
                msg.id === assistantPlaceholder.id
                  ? {
                      ...msg,
                      content:
                        stripPlanBlock(fullText).trim() || "PRD saved without preview code.",
                      isStatus: false,
                      isGenerating: false,
                      tsxGenerated: false,
                      deliverable: deliverable ?? undefined,
                      usage,
                    }
                  : msg,
              )
              void persistChat(next)
              return next
            })
            showToast("PRD ready")
          } catch (err) {
            console.error("Failed to save PRD:", err)
            setMessages((prev) => {
              const next = prev.map((msg) =>
                msg.id === assistantPlaceholder.id
                  ? {
                      ...msg,
                      content: "Failed to save PRD.",
                      isError: true,
                      isStatus: false,
                      isGenerating: false,
                    }
                  : msg,
              )
              void persistChat(next)
              return next
            })
          }
        } else {
          setMessages((prev) => {
            const next = prev.map((msg) =>
              msg.id === assistantPlaceholder.id
                ? {
                    ...msg,
                    content: stripPlanBlock(fullText).trim() || "No response received.",
                    isStatus: false,
                    isGenerating: false,
                    tsxGenerated: false,
                    usage,
                  }
                : msg,
            )
            void persistChat(next)
            return next
          })
          showToast("Response ready")
        }
        setIsStreaming(false)
      },
    )
  }

  const handleSaveKey = async () => {
    const value = keyInput.trim()
    if (!value) {
      setKeyError("Please enter a valid API key.")
      return
    }

    setIsSavingKey(true)
    setKeyError(null)

    try {
      await SaveApiKey(value)
      setApiKey(value)
      setKeyInput("")
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to save API key."
      setKeyError(message)
    } finally {
      setIsSavingKey(false)
    }
  }

  const handleResetKey = async () => {
    try {
      await ClearApiKey()
      setApiKey(null)
      setInputText("")
      setIsStreaming(false)
      if (activeSessionId) {
        try {
          const data = await LoadSession(activeSessionId)
          applySessionData(data)
        } catch {
          // Session may have been removed or inactive cleared.
        }
      }
    } catch {
      // Keep silent reset errors to avoid disrupting chat flow.
    }
  }

  const handleInputKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault()
      void submitMessage()
    }
  }

  const sidebarFont = { fontFamily: "Avenir Next, Avenir, system-ui, sans-serif" } as const

  return (
    <div className="flex h-full w-full bg-white">
      <style
        dangerouslySetInnerHTML={{
          __html: `
@keyframes fabricThinkingDot {
  0%, 100% { opacity: 0.2 }
  50% { opacity: 1 }
}
.fabric-thinking-dot {
  animation: fabricThinkingDot 1.05s ease-in-out infinite;
}
`,
        }}
      />
      <aside
        className="flex h-full shrink-0 flex-col overflow-hidden border-r"
        style={{
          width: 240,
          boxSizing: "border-box",
          backgroundColor: "#FAFAFA",
          borderColor: "#EEEEEE",
          padding: 12,
          ...sidebarFont,
        }}
      >
        <div style={{ borderBottom: "1px solid #EEEEEE", paddingBottom: 12 }}>
          <button
            type="button"
            onClick={() => void handleNewSession()}
            disabled={!sessionsReady || isStreaming}
            title={isStreaming ? "Wait for the current generation to finish" : ""}
            className="w-full rounded-[6px] border-0 font-medium transition-colors hover:bg-[#F5F5F5] disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              backgroundColor: "transparent",
              color: "#1A1A1A",
              padding: "8px 12px",
              fontSize: 13,
              fontWeight: 500,
            }}
          >
            + New chat
          </button>
        </div>
        <div className="mt-3 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
          {sessions.map((s) => (
            <div
              key={s.id}
              className="group flex w-full min-w-0 items-center rounded-[6px]"
              style={{
                padding: 4,
                backgroundColor: s.id === activeSessionId ? "#EEEEEE" : "transparent",
              }}
              onMouseEnter={(e) => {
                if (s.id !== activeSessionId) {
                  e.currentTarget.style.backgroundColor = "#F5F5F5"
                }
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor =
                  s.id === activeSessionId ? "#EEEEEE" : "transparent"
              }}
            >
              <button
                type="button"
                onClick={() => {
                  if (renamingSessionId === s.id) {
                    return
                  }
                  void handleSelectSession(s.id)
                }}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setContextMenu({ x: e.clientX, y: e.clientY, sessionId: s.id })
                }}
                className="min-w-0 flex-1 cursor-pointer rounded-[4px] border-0 bg-transparent text-left transition-colors"
                style={{ padding: "4px 4px 4px 4px" }}
              >
                {renamingSessionId === s.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameDraft}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    maxLength={80}
                    className="box-border h-7 w-full min-w-0 border px-2 py-0 text-[13px] outline-none focus-visible:ring-0"
                    style={{ borderColor: "#DDDDDD", borderRadius: 4 }}
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        void commitRenameSession()
                      }
                      if (e.key === "Escape") {
                        e.preventDefault()
                        cancelRenameSession()
                      }
                    }}
                    onBlur={() => {
                      if (renameBlurSkipRef.current) {
                        return
                      }
                      void commitRenameSession()
                    }}
                  />
                ) : (
                  <>
                    <div
                      className="truncate"
                      style={{
                        fontSize: 13,
                        fontWeight: 500,
                        color: "#1A1A1A",
                      }}
                    >
                      {s.title}
                    </div>
                    <div style={{ fontSize: 11, fontWeight: 400, color: "#999999", marginTop: 2 }}>
                      {formatSessionTimestamp(s.updatedAt)}
                    </div>
                  </>
                )}
              </button>
              <button
                type="button"
                aria-label="Session actions"
                className={`flex shrink-0 cursor-pointer items-center justify-center rounded-[4px] border-0 bg-transparent transition-colors ${
                  s.id === activeSessionId ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                }`}
                style={{
                  padding: 4,
                  minWidth: 24,
                  minHeight: 24,
                  color: "#999999",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = "#EEEEEE"
                  e.currentTarget.style.color = "#1A1A1A"
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = "transparent"
                  e.currentTarget.style.color = "#999999"
                }}
                onClick={(e) => {
                  e.stopPropagation()
                  const r = e.currentTarget.getBoundingClientRect()
                  const menuWidth = 140
                  setContextMenu({
                    x: Math.max(8, r.right - menuWidth),
                    y: r.bottom + 4,
                    sessionId: s.id,
                  })
                }}
              >
                <MoreHorizontal size={14} strokeWidth={2} aria-hidden />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section
        className="flex h-full min-w-0 flex-1 flex-col border-r"
        style={{ borderColor: "#EEEEEE" }}
      >
        {!isApiKeyLoaded || !sessionsReady ? (
          <div className="flex h-full items-center justify-center text-[14px]" style={{ color: "#999999" }}>
            Loading...
          </div>
        ) : !apiKey ? (
          <div className="flex h-full flex-col items-center justify-center px-6">
            <h2 className="text-[16px] font-medium text-[#1A1A1A]">Connect to Claude</h2>
            <p
              className="mt-2 max-w-[280px] text-center text-[12px]"
              style={{ color: "#999999", lineHeight: 1.5 }}
            >
              Enter your Anthropic API key. Stored locally on this machine. Never sent anywhere except
              Anthropic.
            </p>
            <div className="mt-4 w-full max-w-[280px] space-y-3">
              <Input
                type="password"
                value={keyInput}
                onChange={(event) => setKeyInput(event.target.value)}
                placeholder="sk-ant-..."
                className="h-10 text-[14px]"
              />
              <Button
                type="button"
                onClick={() => void handleSaveKey()}
                disabled={isSavingKey || keyInput.trim().length === 0}
                className="h-9 w-full bg-[#1A1A1A] text-white hover:bg-[#1A1A1A]/90"
              >
                Save and continue
              </Button>
              {keyError ? (
                <p className="text-[12px]" style={{ color: "#dc2626" }}>
                  {keyError}
                </p>
              ) : null}
            </div>
          </div>
        ) : (
          <>
            <div
              className="shrink-0 border-b px-6 py-2 text-[12px]"
              style={{ borderColor: "#EEEEEE", color: "#999999" }}
            >
              {sessionTitle}
            </div>
            <div ref={messagesContainerRef} className="flex-1 overflow-y-auto px-6 py-3">
              {messages.length === 0 ? (
                <div
                  className="flex h-full items-center justify-center text-[14px] font-normal"
                  style={{ color: "#999999" }}
                >
                  Ask anything
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {messages.map((message) => {
                    const display = assistantDisplayContent(message)
                    if (message.role === "user") {
                      return (
                        <div key={message.id} className="flex justify-end">
                          <div
                            className="max-w-[80%] rounded-[12px] px-[14px] py-[10px] text-[14px]"
                            style={{
                              backgroundColor: "#F5F5F5",
                              color: "#1A1A1A",
                              lineHeight: 1.5,
                              whiteSpace: "pre-wrap",
                            }}
                          >
                            {message.content}
                          </div>
                        </div>
                      )
                    }

                    return (
                      <div
                        key={message.id}
                        className="py-[10px] text-[14px] whitespace-pre-wrap"
                        style={{
                          color: message.isError
                            ? "#dc2626"
                            : message.isStatus || message.tsxGenerated
                              ? "#666666"
                              : "#1A1A1A",
                          lineHeight: 1.6,
                        }}
                      >
                        {message.isGenerating ? (
                          <div className="mb-2">
                            <span
                              className="inline-flex items-baseline gap-1"
                              style={{
                                color: "#666666",
                                fontSize: 14,
                                lineHeight: 1.6,
                                fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
                              }}
                            >
                              <span>Generating</span>
                              <span className="inline-flex" aria-hidden style={{ letterSpacing: "0.02em" }}>
                                <span
                                  className="fabric-thinking-dot inline-block"
                                  style={{ animationDelay: "0ms" }}
                                >
                                  .
                                </span>
                                <span
                                  className="fabric-thinking-dot inline-block"
                                  style={{ animationDelay: "200ms" }}
                                >
                                  .
                                </span>
                                <span
                                  className="fabric-thinking-dot inline-block"
                                  style={{ animationDelay: "400ms" }}
                                >
                                  .
                                </span>
                              </span>
                            </span>
                          </div>
                        ) : null}
                        {display.body === "__PLAN__" && message.planItems ? (
                          <PlanIndicator items={message.planItems} />
                        ) : display.body === "__THINKING__" ? (
                          <ThinkingIndicator />
                        ) : (
                          display.body
                        )}
                        {display.sub ? (
                          <div className="mt-1 text-[12px]" style={{ color: "#999999", lineHeight: 1.4 }}>
                            {display.sub}
                          </div>
                        ) : null}
                        {MANUS_CARDS_MODE && message.deliverable ? (
                          <DeliverableView deliverable={message.deliverable} />
                        ) : null}
                        {message.usage ? (() => {
                          const inputTok = message.usage.input_tokens
                          const outputTok = message.usage.output_tokens
                          const cacheRead = message.usage.cache_read_input_tokens ?? 0
                          const cacheCreate = message.usage.cache_creation_input_tokens ?? 0

                          let line1: string
                          if (cacheRead > 0) {
                            line1 = `${cacheRead.toLocaleString()} cached · ${inputTok.toLocaleString()} input · ${outputTok.toLocaleString()} output`
                          } else if (cacheCreate > 0) {
                            line1 = `${cacheCreate.toLocaleString()} cache primed · ${inputTok.toLocaleString()} input · ${outputTok.toLocaleString()} output`
                          } else {
                            line1 = `${inputTok.toLocaleString()} input · ${outputTok.toLocaleString()} output`
                          }

                          let line2: string | null = null
                          if (cacheRead > 0) {
                            const totalInputEquivalent = inputTok + cacheRead + cacheCreate
                            const costWithCaching =
                              (inputTok * PRICE_INPUT_PER_M
                                + cacheRead * PRICE_CACHE_READ_PER_M
                                + cacheCreate * PRICE_CACHE_WRITE_PER_M
                                + outputTok * PRICE_OUTPUT_PER_M) / 1_000_000
                            const costWithoutCaching =
                              (totalInputEquivalent * PRICE_INPUT_PER_M
                                + outputTok * PRICE_OUTPUT_PER_M) / 1_000_000
                            const saved = costWithoutCaching - costWithCaching
                            const savedPct = costWithoutCaching > 0 ? (saved / costWithoutCaching) * 100 : 0
                            line2 = `Saved ~${(saved * 100).toFixed(1)}¢ (${savedPct.toFixed(0)}% off)`
                          } else if (cacheCreate > 0) {
                            line2 = "Cache primed — savings start on next turn"
                          }

                          return (
                            <div
                              className="mt-2"
                              style={{
                                fontSize: 12,
                                fontWeight: 400,
                                color: "#666666",
                                lineHeight: 1.4,
                                fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
                              }}
                            >
                              <div>{line1}</div>
                              {line2 ? <div>{line2}</div> : null}
                            </div>
                          )
                        })() : null}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            <div className="border-t px-6 py-3" style={{ borderColor: "#EEEEEE" }}>
              <div className="flex flex-col gap-2">
                <Textarea
                  value={inputText}
                  onChange={(event) => setInputText(event.target.value)}
                  onKeyDown={handleInputKeyDown}
                  placeholder="Describe what you want to build..."
                  disabled={isStreaming}
                  className="min-h-[64px] w-full resize-none border text-[14px] placeholder:text-[14px] shadow-none focus-visible:ring-0"
                  style={{
                    borderColor: "#DDDDDD",
                    borderRadius: "6px",
                    padding: "8px",
                    backgroundColor: "#FFFFFF",
                  }}
                />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => void handleResetKey()}
                    className="m-0 border-0 bg-transparent p-0 text-[12px] font-normal hover:underline"
                    style={{ color: "#999999" }}
                  >
                    Reset key
                  </button>

                  <button
                    type="button"
                    disabled={!canSend}
                    onClick={() => void submitMessage()}
                    className="m-0 w-auto border-0 bg-transparent p-0 text-[12px] font-medium text-[#1A1A1A] hover:cursor-pointer disabled:cursor-not-allowed disabled:text-[#999999]"
                  >
                    Send
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {sessionHasPreview ? (
      <section
        className="flex h-full shrink-0 flex-col bg-white"
        style={{
          flex: "0 0 55%",
          minWidth: 0,
          backgroundColor: "#FFFF",
          boxShadow: "-4px 0 18px rgba(0, 0, 0, 0.08)",
        }}
      >
        {!MANUS_CARDS_MODE ? (
          <div
            className="flex shrink-0 justify-center border-b px-4 pt-3 pb-3"
            style={{ borderColor: "#EEEEEE" }}
          >
            <div
              className="inline-flex rounded-full"
              style={{
                backgroundColor: "#F0F0F0",
                padding: 3,
                gap: 0,
              }}
            >
              <button
                type="button"
                onClick={() => setRightPanelView("preview")}
                className="cursor-pointer rounded-full border-0 outline-none"
                style={{
                  padding: "6px 16px",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
                  transition: "background-color 150ms ease, color 150ms ease, box-shadow 150ms ease",
                  ...(rightPanelView === "preview"
                    ? {
                        backgroundColor: "#FFFFFF",
                        color: "#1A1A1A",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
                      }
                    : {
                        backgroundColor: "transparent",
                        color: "#666666",
                        boxShadow: "none",
                      }),
                }}
                onMouseEnter={(e) => {
                  if (rightPanelView !== "preview") {
                    e.currentTarget.style.color = "#1A1A1A"
                  }
                }}
                onMouseLeave={(e) => {
                  if (rightPanelView !== "preview") {
                    e.currentTarget.style.color = "#666666"
                  }
                }}
              >
                Preview
              </button>
              <button
                type="button"
                onClick={() => setRightPanelView("prd")}
                className="cursor-pointer rounded-full border-0 outline-none"
                style={{
                  padding: "6px 16px",
                  fontSize: 12,
                  fontWeight: 500,
                  fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
                  transition: "background-color 150ms ease, color 150ms ease, box-shadow 150ms ease",
                  ...(rightPanelView === "prd"
                    ? {
                        backgroundColor: "#FFFFFF",
                        color: "#1A1A1A",
                        boxShadow: "0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)",
                      }
                    : {
                        backgroundColor: "transparent",
                        color: "#666666",
                        boxShadow: "none",
                      }),
                }}
                onMouseEnter={(e) => {
                  if (rightPanelView !== "prd") {
                    e.currentTarget.style.color = "#1A1A1A"
                  }
                }}
                onMouseLeave={(e) => {
                  if (rightPanelView !== "prd") {
                    e.currentTarget.style.color = "#666666"
                  }
                }}
              >
                PRD
              </button>
            </div>
          </div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-hidden">
          {rightPanelView === "preview" ? (
            sessionHasPreview && previewPort > 0 ? (
              <iframe
                ref={iframeRef}
                src="/preview/"
                style={{ width: "100%", height: "100%", border: "none" }}
                title="Fabric Preview"
              />
            ) : (
              <div
                className="flex h-full items-center justify-center px-8 text-center text-[14px] font-normal"
                style={{
                  color: "#999999",
                  fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
                }}
              >
                {sessionHasPreview
                  ? formatPreviewStatus(previewStatus)
                  : "Generate something to see it here"}
              </div>
            )
          ) : !MANUS_CARDS_MODE && currentPRD.trim().length > 0 ? (
            <div
              className="fabric-prd-markdown h-full overflow-y-auto bg-white px-8 py-8"
              style={{ maxWidth: 720, margin: "0 auto", boxSizing: "border-box" }}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{currentPRD}</ReactMarkdown>
            </div>
          ) : (
            <div
              className="flex h-full items-center justify-center px-8 text-center text-[14px]"
              style={{
                color: "#999999",
                fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
              }}
            >
              Generate a preview first — the PRD will appear here.
            </div>
          )}
        </div>
      </section>
      ) : null}

      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[140px] rounded-md border bg-white py-1 shadow-md"
          style={{
            left: contextMenu.x,
            top: contextMenu.y,
            borderColor: "#EEEEEE",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F5F5]"
            style={{ color: "#1A1A1A" }}
            onClick={() => {
              const id = contextMenu.sessionId
              setContextMenu(null)
              beginRenameSession(id)
            }}
          >
            Rename
          </button>
          <button
            type="button"
            className="block w-full px-3 py-2 text-left text-[13px] hover:bg-[#F5F5F5]"
            style={{ color: "#b91c1c" }}
            onClick={() => {
              const id = contextMenu.sessionId
              setContextMenu(null)
              setDeleteConfirmId(id)
            }}
          >
            Delete
          </button>
        </div>
      ) : null}

      <div
        aria-live="polite"
        style={{
          position: "fixed",
          bottom: 24,
          right: 24,
          zIndex: 100,
          background: "#1A1A1A",
          color: "#FFFFFF",
          padding: "10px 16px",
          borderRadius: 8,
          fontFamily: "Avenir Next, Avenir, system-ui, sans-serif",
          fontSize: 13,
          fontWeight: 500,
          opacity: toast ? 1 : 0,
          transform: toast ? "translateY(0)" : "translateY(8px)",
          transition: "opacity 180ms ease, transform 180ms ease",
          pointerEvents: "none",
        }}
      >
        {toast ?? ""}
      </div>

      {deleteConfirmId ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center"
          style={{ backgroundColor: "rgba(0,0,0,0.35)" }}
          onClick={() => setDeleteConfirmId(null)}
          role="presentation"
        >
          <div
            className="max-w-[360px] rounded-lg bg-white p-6 shadow-lg"
            style={{ fontFamily: "Avenir Next, Avenir, system-ui, sans-serif" }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-[16px] font-medium text-[#1A1A1A]">Delete this session?</h3>
            <p className="mt-2 text-[14px]" style={{ color: "#666666", lineHeight: 1.5 }}>
              This can&apos;t be undone.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                className="border-0 bg-transparent text-[14px] font-medium"
                style={{ color: "#666666" }}
                onClick={() => setDeleteConfirmId(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-[6px] border-0 px-4 py-2 text-[14px] font-medium text-white"
                style={{ backgroundColor: "#DC2626" }}
                onClick={() => void confirmDeleteSession()}
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
