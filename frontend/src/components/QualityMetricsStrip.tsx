import { useState } from "react"
import { ShieldAlert, Clock, LayoutGrid, AlertCircle, Zap } from "lucide-react"
import type {
  EffortEstimate,
  GapRisk,
  GapRiskLevel,
  QualityMetrics,
  SpecCoverage,
  SpecSectionStatus,
} from "@/lib/qualityMetrics"

type ChipId = "gap" | "effort" | "spec"

const COLOR_SUCCESS_BG = "#DCFCE7"
const COLOR_WARNING_BG = "#FEF3C7"
const COLOR_DANGER_BG = "#FEE2E2"
const COLOR_INFO_FILL = "#2563EB"
const COLOR_SUCCESS_FILL = "#16A34A"
const COLOR_WARNING_FILL = "#D97706"
const COLOR_DANGER_FILL = "#DC2626"
const COLOR_TRACK_BG = "#F0F0F0"
const COLOR_MARKER = "#1A1A1A"
const COLOR_BORDER = "#EEEEEE"
const COLOR_BORDER_SELECTED = "#1A1A1A"
const COLOR_TEXT_PRIMARY = "#1A1A1A"
const COLOR_TEXT_SECONDARY = "#666666"
const COLOR_TEXT_TERTIARY = "#999999"
const COLOR_SUBTLE_BG = "#FAFAFA"

const KEYFRAMES = `@keyframes qmStripPulse { 0%,100% { opacity: 0.45; } 50% { opacity: 0.85; } }`

function capitalize(s: string): string {
  return s.length > 0 ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

function markerLeft(level: GapRiskLevel): string {
  if (level === "low") return "16%"
  if (level === "medium") return "50%"
  return "83%"
}

function statusColor(status: SpecSectionStatus): { bg: string; fill: string; label: string } {
  if (status === "complete") return { bg: COLOR_SUCCESS_BG, fill: COLOR_SUCCESS_FILL, label: "Complete" }
  if (status === "light") return { bg: COLOR_WARNING_BG, fill: COLOR_WARNING_FILL, label: "Light" }
  return { bg: COLOR_DANGER_BG, fill: COLOR_DANGER_FILL, label: "Missing" }
}

function Shimmer({ width, height }: { width: number | string; height: number }) {
  return (
    <div
      style={{
        width,
        height,
        borderRadius: 4,
        backgroundColor: "#EEEEEE",
        animation: "qmStripPulse 1.4s ease-in-out infinite",
      }}
    />
  )
}

function ChipShell({
  icon,
  label,
  selected,
  disabled,
  onClick,
  children,
}: {
  icon: React.ReactNode
  label: string
  selected: boolean
  disabled?: boolean
  onClick?: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: 12,
        backgroundColor: "#FFFFFF",
        border: `0.5px solid ${COLOR_BORDER}`,
        borderRadius: 10,
        cursor: disabled ? "default" : "pointer",
        boxShadow: selected ? `0 0 0 2px ${COLOR_BORDER_SELECTED}` : "none",
        transition: "box-shadow 120ms ease-out",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLOR_TEXT_SECONDARY, fontSize: 12, lineHeight: 1.3 }}>
        {icon}
        <span>{label}</span>
      </div>
      {children}
    </button>
  )
}

function GapRiskChip({
  data,
  loading,
  selected,
  onSelect,
}: {
  data: GapRisk | null
  loading: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <ChipShell
      icon={<ShieldAlert size={12} strokeWidth={1.75} />}
      label={loading ? "Gap risk · analyzing…" : "Gap risk"}
      selected={selected}
      disabled={loading || !data}
      onClick={data ? onSelect : undefined}
    >
      {loading || !data ? (
        <>
          <Shimmer width="100%" height={14} />
          <Shimmer width={120} height={14} />
        </>
      ) : (
        <>
          <div style={{ position: "relative", height: 14 }}>
            <div style={{ display: "flex", gap: 2, height: "100%" }}>
              <div style={{ flex: 1, backgroundColor: COLOR_SUCCESS_BG, borderRadius: 3 }} />
              <div style={{ flex: 1, backgroundColor: COLOR_WARNING_BG, borderRadius: 3 }} />
              <div style={{ flex: 1, backgroundColor: COLOR_DANGER_BG, borderRadius: 3 }} />
            </div>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: `calc(${markerLeft(data.level)} - 4px)`,
                width: 8,
                height: 14,
                backgroundColor: COLOR_MARKER,
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ fontSize: 13, fontWeight: 500, color: COLOR_TEXT_PRIMARY, lineHeight: 1.4 }}>
            {capitalize(data.level)} · {data.flagCount} {data.flagCount === 1 ? "ambiguity" : "ambiguities"}
          </div>
        </>
      )}
    </ChipShell>
  )
}

function EffortChip({
  data,
  loading,
  selected,
  onSelect,
}: {
  data: EffortEstimate | null
  loading: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <ChipShell
      icon={<Clock size={12} strokeWidth={1.75} />}
      label={loading ? "Effort estimate · analyzing…" : "Effort estimate"}
      selected={selected}
      disabled={loading || !data}
      onClick={data ? onSelect : undefined}
    >
      {loading || !data ? (
        <>
          <Shimmer width="100%" height={14} />
          <Shimmer width={120} height={14} />
        </>
      ) : (() => {
          const leftPct = Math.max(0, Math.min(100, (data.daysMin / 15) * 100))
          const widthPct = Math.max(2, Math.min(100 - leftPct, ((data.daysMax - data.daysMin) / 15) * 100))
          return (
            <>
              <div>
                <div
                  style={{
                    position: "relative",
                    height: 8,
                    backgroundColor: COLOR_TRACK_BG,
                    borderRadius: 4,
                  }}
                >
                  <div
                    style={{
                      position: "absolute",
                      top: 0,
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      height: "100%",
                      backgroundColor: COLOR_INFO_FILL,
                      borderRadius: 4,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    fontSize: 10,
                    color: COLOR_TEXT_TERTIARY,
                    marginTop: 4,
                    lineHeight: 1,
                  }}
                >
                  <span>0d</span>
                  <span>15d{data.daysMax >= 15 ? "+" : ""}</span>
                </div>
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: COLOR_TEXT_PRIMARY, lineHeight: 1.4 }}>
                {data.daysRange} · {capitalize(data.tier)}
              </div>
            </>
          )
        })()}
    </ChipShell>
  )
}

function SpecCoverageChip({
  data,
  loading,
  selected,
  onSelect,
}: {
  data: SpecCoverage | null
  loading: boolean
  selected: boolean
  onSelect: () => void
}) {
  return (
    <ChipShell
      icon={<LayoutGrid size={12} strokeWidth={1.75} />}
      label={loading ? "Spec coverage · analyzing…" : "Spec coverage"}
      selected={selected}
      disabled={loading || !data}
      onClick={data ? onSelect : undefined}
    >
      {loading || !data ? (
        <>
          <Shimmer width="100%" height={14} />
          <Shimmer width={140} height={14} />
        </>
      ) : (() => {
          const total = data.sectionsComplete + data.sectionsLight + data.sectionsMissing
          const showBar = total > 0
          return (
            <>
              <div style={{ display: "flex", gap: 2, height: 14 }}>
                {showBar ? (
                  <>
                    {data.sectionsComplete > 0 ? (
                      <div style={{ flexGrow: data.sectionsComplete, backgroundColor: COLOR_SUCCESS_BG, borderRadius: 3 }} />
                    ) : null}
                    {data.sectionsLight > 0 ? (
                      <div style={{ flexGrow: data.sectionsLight, backgroundColor: COLOR_WARNING_BG, borderRadius: 3 }} />
                    ) : null}
                    {data.sectionsMissing > 0 ? (
                      <div style={{ flexGrow: data.sectionsMissing, backgroundColor: COLOR_DANGER_BG, borderRadius: 3 }} />
                    ) : null}
                  </>
                ) : (
                  <div style={{ flex: 1, backgroundColor: COLOR_TRACK_BG, borderRadius: 3 }} />
                )}
              </div>
              <div style={{ fontSize: 13, fontWeight: 500, color: COLOR_TEXT_PRIMARY, lineHeight: 1.4 }}>
                {data.sectionsComplete} of 9 sections complete
              </div>
            </>
          )
        })()}
    </ChipShell>
  )
}

function PanelShell({
  icon,
  title,
  summary,
  children,
}: {
  icon: React.ReactNode
  title: string
  summary: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        marginTop: 10,
        backgroundColor: "#FFFFFF",
        border: `0.5px solid ${COLOR_BORDER}`,
        borderRadius: 10,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, color: COLOR_TEXT_PRIMARY, fontSize: 12, fontWeight: 500 }}>
          {icon}
          <span>{title} · breakdown</span>
        </div>
        <div style={{ fontSize: 11, color: COLOR_TEXT_TERTIARY }}>{summary}</div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>{children}</div>
    </div>
  )
}

function GapRiskPanel({ data }: { data: GapRisk }) {
  return (
    <PanelShell
      icon={<ShieldAlert size={12} strokeWidth={1.75} color={COLOR_TEXT_SECONDARY} />}
      title="Gap risk"
      summary={`${data.flagCount} ${data.flagCount === 1 ? "flag" : "flags"} · ${capitalize(data.level)}`}
    >
      {data.flags.length === 0 ? (
        <div style={{ fontSize: 12, color: COLOR_TEXT_TERTIARY, padding: "8px 10px" }}>
          No ambiguities flagged.
        </div>
      ) : (
        data.flags.map((flag, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 8,
              padding: "10px 12px",
              backgroundColor: COLOR_SUBTLE_BG,
              borderRadius: 6,
              alignItems: "flex-start",
            }}
          >
            <AlertCircle size={13} strokeWidth={1.75} color={COLOR_WARNING_FILL} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLOR_TEXT_PRIMARY }}>{flag.category}</div>
                {flag.section ? (
                  <div style={{ fontSize: 11, color: COLOR_TEXT_TERTIARY, flexShrink: 0 }}>{flag.section}</div>
                ) : null}
              </div>
              {flag.description ? (
                <div style={{ fontSize: 12, color: COLOR_TEXT_SECONDARY, lineHeight: 1.45 }}>{flag.description}</div>
              ) : null}
            </div>
          </div>
        ))
      )}
    </PanelShell>
  )
}

function EffortPanel({ data }: { data: EffortEstimate }) {
  return (
    <PanelShell
      icon={<Clock size={12} strokeWidth={1.75} color={COLOR_TEXT_SECONDARY} />}
      title="Effort estimate"
      summary={`${data.daysRange} · ${capitalize(data.tier)}`}
    >
      {data.drivers.length === 0 ? (
        <div style={{ fontSize: 12, color: COLOR_TEXT_TERTIARY, padding: "8px 10px" }}>
          No specific drivers reported.
        </div>
      ) : (
        data.drivers.map((driver, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              gap: 8,
              padding: "10px 12px",
              backgroundColor: COLOR_SUBTLE_BG,
              borderRadius: 6,
              alignItems: "flex-start",
            }}
          >
            <Zap size={13} strokeWidth={1.75} color={COLOR_INFO_FILL} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ fontSize: 12, color: COLOR_TEXT_PRIMARY, lineHeight: 1.45 }}>{driver}</div>
          </div>
        ))
      )}
    </PanelShell>
  )
}

function SpecCoveragePanel({ data }: { data: SpecCoverage }) {
  return (
    <PanelShell
      icon={<LayoutGrid size={12} strokeWidth={1.75} color={COLOR_TEXT_SECONDARY} />}
      title="Spec coverage"
      summary={`${data.sectionsComplete} complete · ${data.sectionsLight} light · ${data.sectionsMissing} missing`}
    >
      {data.sectionDetails.length === 0 ? (
        <div style={{ fontSize: 12, color: COLOR_TEXT_TERTIARY, padding: "8px 10px" }}>
          No section details reported.
        </div>
      ) : (
        data.sectionDetails.map((section, i) => {
          const sc = statusColor(section.status)
          return (
            <div
              key={i}
              style={{
                display: "flex",
                gap: 8,
                padding: "10px 12px",
                backgroundColor: COLOR_SUBTLE_BG,
                borderRadius: 6,
                alignItems: "flex-start",
              }}
            >
              <div
                style={{
                  flexShrink: 0,
                  marginTop: 1,
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 4,
                  backgroundColor: sc.bg,
                  color: sc.fill,
                  textTransform: "uppercase",
                  letterSpacing: 0.3,
                }}
              >
                {sc.label}
              </div>
              <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: COLOR_TEXT_PRIMARY }}>{section.name}</div>
                {section.suggestion ? (
                  <div style={{ fontSize: 12, color: COLOR_TEXT_SECONDARY, lineHeight: 1.45 }}>{section.suggestion}</div>
                ) : null}
              </div>
            </div>
          )
        })
      )}
    </PanelShell>
  )
}

export function QualityMetricsStrip({
  metrics,
  loading,
}: {
  metrics: QualityMetrics | null | undefined
  loading: boolean
}) {
  const [selected, setSelected] = useState<ChipId | null>(null)
  const gap = metrics?.gapRisk ?? null
  const effort = metrics?.effortEstimate ?? null
  const spec = metrics?.specCoverage ?? null

  const toggle = (id: ChipId) => setSelected((prev) => (prev === id ? null : id))

  return (
    <div style={{ marginTop: 10, display: "flex", flexDirection: "column" }}>
      <style>{KEYFRAMES}</style>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
        <GapRiskChip
          data={gap}
          loading={loading && !gap}
          selected={selected === "gap"}
          onSelect={() => toggle("gap")}
        />
        <EffortChip
          data={effort}
          loading={loading && !effort}
          selected={selected === "effort"}
          onSelect={() => toggle("effort")}
        />
        <SpecCoverageChip
          data={spec}
          loading={loading && !spec}
          selected={selected === "spec"}
          onSelect={() => toggle("spec")}
        />
      </div>
      {selected === "gap" && gap ? <GapRiskPanel data={gap} /> : null}
      {selected === "effort" && effort ? <EffortPanel data={effort} /> : null}
      {selected === "spec" && spec ? <SpecCoveragePanel data={spec} /> : null}
    </div>
  )
}
