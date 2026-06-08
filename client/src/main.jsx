import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BarChart3,
  Clock,
  Database,
  ExternalLink,
  Eye,
  HelpCircle,
  PhoneCall,
  Radio,
  ShieldAlert,
  UserCheck,
  Users,
  Wifi,
  X,
} from "lucide-react";
import "./styles.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:8080";

const GOOGLE_SHEET_DATABASE_URL =
  import.meta.env.VITE_GOOGLE_SHEET_DATABASE_URL ||
  "https://docs.google.com/spreadsheets/d/13IxCpTTyUXF-ssFI7PcSbO8xfsauJvkZkOPQcpETJc4/edit?gid=1129431701#gid=1129431701";

const AUTO_REFRESH_SECONDS = Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 60);

function formatCountdown(seconds) {
  const total = Math.max(0, Number(seconds || 0));
  const minutes = Math.floor(total / 60);
  const remainingSeconds = total % 60;

  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatValue(value, fallback = "â€”") {
  if (value === undefined || value === null || value === "") return fallback;
  return value;
}

function severityWeight(value) {
  const severity = String(value || "").toLowerCase();

  if (severity === "critical") return 4;
  if (severity === "high") return 3;
  if (severity === "medium") return 2;
  if (severity === "low") return 1;

  return 0;
}

function severityClass(value) {
  const sev = String(value || "").toLowerCase();

  if (sev === "critical") return "severity-critical";
  if (sev === "high") return "severity-high";
  if (sev === "medium") return "severity-medium";
  if (sev === "low") return "severity-low";

  return "severity-neutral";
}

function riskClass(value) {
  const risk = String(value || "").toLowerCase();

  if (risk === "critical") return "risk-critical";
  if (risk === "high") return "risk-high";
  if (risk === "medium") return "risk-medium";
  if (risk === "low") return "risk-low";

  return "risk-neutral";
}

function snapshotValue(snapshot, key, fallback = "â€”") {
  const value = snapshot?.[key];

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value;
}

function formatSnapshotDate(value) {
  if (!value) return "â€”";

  const raw = String(value);

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return date.toLocaleDateString([], {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatSnapshotTime(value) {
  if (!value) return "â€”";

  const raw = String(value);

  if (/^\d{1,2}:\d{2}/.test(raw)) {
    return raw;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return raw;
  }

  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function getSnapshotNumber(snapshot, key) {
  return safeNumber(snapshotValue(snapshot, key, 0));
}

function estimateAgentsNeeded(callsOnHold, agentsAvailable) {
  const hold = safeNumber(callsOnHold);
  const available = safeNumber(agentsAvailable);

  if (hold <= 0) return 0;

  return Math.max(0, Math.ceil(hold / 8) - available);
}

function buildSnapshotStory(snapshot) {
  const date = formatSnapshotDate(snapshotValue(snapshot, "Date"));
  const time = formatSnapshotTime(snapshotValue(snapshot, "Time"));

  const callsOnHold = getSnapshotNumber(snapshot, "Calls On Hold");
  const available = getSnapshotNumber(snapshot, "Agents Available");
  const pastCallback = getSnapshotNumber(snapshot, "Past Callback Limit");
  const pastVoicemail = getSnapshotNumber(snapshot, "Past Voicemail Limit");
  const criticalFlags = getSnapshotNumber(snapshot, "Critical Count");
  const highFlags = getSnapshotNumber(snapshot, "High Count");
  const risk = snapshotValue(snapshot, "Company Risk Level", "Unknown");

  const agentsNeeded = estimateAgentsNeeded(callsOnHold, available);

  const headline = `At ${time} on ${date}, we had ${callsOnHold} calls on hold with ${available} agents available.`;

  let riskMeaning = "The queue was stable at this moment.";

  if (String(risk).toLowerCase() === "critical") {
    riskMeaning =
      "Critical means customers were waiting while the operation did not have enough live coverage to protect the queue.";
  } else if (String(risk).toLowerCase() === "high") {
    riskMeaning =
      "High means the queue was building pressure and could become critical without more coverage.";
  } else if (String(risk).toLowerCase() === "medium") {
    riskMeaning =
      "Medium means the queue needed attention, but it was not yet at the highest risk level.";
  }

  const details = [];

  if (pastCallback > 0) {
    details.push(`${pastCallback} calls were past callback threshold`);
  }

  if (pastVoicemail > 0) {
    details.push(`${pastVoicemail} calls were past voicemail threshold`);
  }

  if (criticalFlags > 0) {
    details.push(`${criticalFlags} critical call-level flags were detected`);
  }

  if (highFlags > 0) {
    details.push(`${highFlags} high call-level flags were detected`);
  }

  const action =
    agentsNeeded > 0
      ? `Watchtower estimates at least ${agentsNeeded} more available agents were needed at this time.`
      : "No extra-agent estimate was triggered at this moment.";

  return {
    date,
    time,
    risk,
    callsOnHold,
    available,
    pastCallback,
    pastVoicemail,
    criticalFlags,
    highFlags,
    agentsNeeded,
    headline,
    details,
    riskMeaning,
    action,
  };
}

function normalizeFlaggedAgentFromWatchlist(item) {
  return {
    id: item.ID || item.id || item["Watchlist ID"] || "",
    agentName: item["Agent Name"] || item.agentName || item.agent || "Unknown Agent",
    vendor: item.Vendor || item.vendor || "Unknown",
    issue: item["Issue Type"] || item.issueType || "Queue risk",
    severity: item.Severity || item.severity || "High",
    status: item.Status || item.status || "Monitoring",
    evidence: item.Evidence || item.evidence || "",
    watchOut: item["Things To Watch Out"] || item.watchOut || "",
    coachingAction:
      item["Coaching Action"] ||
      item.coachingAction ||
      "Review the call, confirm process adherence, and coach based on evidence.",
    averageScore: item["Average Score"] || item.averageScore || "â€”",
    callsSeen: item["Calls Seen Today"] || item.callsSeenToday || item.callsSeen || "â€”",
    lastCallId: item["Last Queue Call ID"] || item.lastQueueCallId || item.lastCallId || "â€”",
    source: item["Watchlist ID"] ? "Daily Critical" : "Watchlist",
  };
}

function normalizeFlaggedAgentFromMetric(item) {
  return {
    id: `${item.agent || item["Agent Name"]}-${item.vendor || item.Vendor}`,
    agentName: item.agent || item["Agent Name"] || "Unknown Agent",
    vendor: item.vendor || item.Vendor || "Unknown",
    issue:
      safeNumber(item.callbackRiskCalls || item["Callback Risk Calls"]) > 0
        ? "Long Wait / Callback Risk"
        : safeNumber(item.criticalFlags || item["Critical Flags"]) > 0
        ? "Critical Queue Risk"
        : safeNumber(item.highFlags || item["High Flags"]) > 0
        ? "High Queue Risk"
        : "Automatic Queue Watch",
    severity: item.severity || item.Severity || "High",
    status: "Live Monitoring",
    evidence: [
      `Avg Score: ${formatValue(item.avgScore || item["Average Score"])}`,
      `Calls Seen: ${formatValue(item.callsSeen || item["Calls Seen"])}`,
      `Callback Risk Calls: ${formatValue(item.callbackRiskCalls || item["Callback Risk Calls"])}`,
      `Critical Flags: ${formatValue(item.criticalFlags || item["Critical Flags"])}`,
      `High Flags: ${formatValue(item.highFlags || item["High Flags"])}`,
      `Last Call ID: ${formatValue(item.lastCallId || item["Last Queue Call ID"])}`,
    ].join(" | "),
    watchOut: Array.isArray(item.watchOut)
      ? item.watchOut.join(" | ")
      : item.watchOut || item["Things To Watch Out"] || "",
    coachingAction:
      "Review the flagged call exposure, confirm why the call exceeded safe queue timing, and coach based on evidence.",
    averageScore: item.avgScore || item["Average Score"] || "â€”",
    callsSeen: item.callsSeen || item["Calls Seen"] || "â€”",
    lastCallId: item.lastCallId || item["Last Queue Call ID"] || "â€”",
    source: "Live Agent Metrics",
  };
}

function buildAgentFlagStory(dailyCritical, watchlist) {
  const source = dailyCritical.length ? dailyCritical : watchlist;

  if (!source.length) {
    return {
      hasAgent: false,
      agentName: "No agent flagged yet",
      vendor: "No call center found",
      issue: "No agent issue has been saved yet.",
      score: "â€”",
      text: "No agent was auto-flagged in the current dashboard data yet.",
    };
  }

  const agent = source[0];

  const agentName = agent["Agent Name"] || agent.agentName || agent.agent || "Unknown Agent";
  const vendor = agent.Vendor || agent.vendor || "Unknown";
  const issue = agent["Issue Type"] || agent.issueType || "queue risk";
  const score = agent["Average Score"] || agent.averageScore || "not available";

  const callCenterText =
    vendor === "Unknown"
      ? "No call center was related to this agent on the live link under monitoring."
      : `This agent was related to ${vendor}.`;

  return {
    hasAgent: true,
    agentName,
    vendor,
    issue,
    score,
    text: `Watchtower flagged ${agentName} for ${issue}. Average score: ${score}. ${callCenterText}`,
  };
}

function buildCoverageNeedStory(summary, snapshotStats, vendorMetrics) {
  const callsOnHold = safeNumber(summary.callsOnHold);
  const agentsAvailable = safeNumber(summary.agentsAvailable);
  const pastCallback = safeNumber(summary.pastCallback);
  const estimatedAgentsNeeded = estimateAgentsNeeded(callsOnHold, agentsAvailable);

  const sortedVendors = [...vendorMetrics].sort((a, b) => {
    const aRisk =
      safeNumber(a["Critical Flags"]) * 3 +
      safeNumber(a["High Flags"]) * 2 +
      safeNumber(a["Calls Seen"]);

    const bRisk =
      safeNumber(b["Critical Flags"]) * 3 +
      safeNumber(b["High Flags"]) * 2 +
      safeNumber(b["Calls Seen"]);

    return bRisk - aRisk;
  });

  const topVendor = sortedVendors[0];

  let callCenterName = "Unknown";
  let callCenterMessage =
    "No specific call center can be confirmed from the live link for this coverage gap yet.";

  if (topVendor?.Vendor && topVendor.Vendor !== "Unknown") {
    callCenterName = topVendor.Vendor;
    callCenterMessage = `${topVendor.Vendor} is the strongest call-center signal in todayâ€™s saved vendor data.`;
  }

  let headline = "Coverage looks stable right now.";
  let recommendation = "No extra-agent estimate is triggered right now.";

  if (estimatedAgentsNeeded > 0) {
    headline = `Overall queue needs about ${estimatedAgentsNeeded} more available agents right now.`;
    recommendation =
      callCenterName === "Unknown"
        ? `Watchtower estimates ${estimatedAgentsNeeded} more available agents are needed, but the live link does not confirm which call center owns the gap.`
        : `Watchtower estimates ${estimatedAgentsNeeded} more available agents are needed. Start by validating live coverage with ${callCenterName}.`;
  }

  return {
    callCenterName,
    estimatedAgentsNeeded,
    callsOnHold,
    agentsAvailable,
    pastCallback,
    peakHold: snapshotStats.maxCallsOnHold,
    peakCallback: snapshotStats.maxPastCallback,
    headline,
    callCenterMessage,
    recommendation,
  };
}


function buildCallbackExposureStory(summary, snapshotStats, todaySnapshots, recentSnapshots) {
  const source = todaySnapshots.length ? todaySnapshots : recentSnapshots;

  const callbackValues = source
    .map((snapshot) => safeNumber(snapshot["Past Callback Limit"]))
    .filter((value) => value > 0);

  const currentCallbackRisk = safeNumber(summary.pastCallback);
  const peakCallbackRisk = Math.max(currentCallbackRisk, ...callbackValues, 0);
  const averageCallbackRisk = callbackValues.length
    ? Math.round(callbackValues.reduce((total, value) => total + value, 0) / callbackValues.length)
    : currentCallbackRisk;

  const projectedFiveDays = averageCallbackRisk > 0 ? averageCallbackRisk * 5 : currentCallbackRisk * 5;
  const projectedSevenDays = averageCallbackRisk > 0 ? averageCallbackRisk * 7 : currentCallbackRisk * 7;

  let exposureLevel = "Low";
  let headline = "Callback exposure is currently under control.";
  let meaning =
    "Callback exposure means calls have crossed the safe callback waiting window. These calls should be watched because they can create repeat contacts, escalations, and poor customer experience.";
  let recommendedFix = "Continue monitoring callback-risk calls and queue coverage.";

  if (currentCallbackRisk >= 25 || peakCallbackRisk >= 25) {
    exposureLevel = "Critical";
    headline = `${currentCallbackRisk} calls are currently past callback threshold. Peak saved exposure reached ${peakCallbackRisk}.`;
    recommendedFix =
      "Add available coverage immediately, prioritize callback-risk calls first, and ask vendors to confirm live queue support.";
  } else if (currentCallbackRisk > 0 || averageCallbackRisk > 0) {
    exposureLevel = "High";
    headline = `${currentCallbackRisk} calls are currently past callback threshold. Recent average exposure is around ${averageCallbackRisk}.`;
    recommendedFix =
      "Prioritize the callback-risk calls first, then validate whether the wait time was caused by low live coverage, agent availability, vendor staffing, or schedule gaps. Once schedules are added, Watchtower can compare expected coverage vs actual queue coverage to identify the root cause more accurately.";
  }

  return {
    currentCallbackRisk,
    peakCallbackRisk,
    averageCallbackRisk,
    projectedFiveDays,
    projectedSevenDays,
    exposureLevel,
    headline,
    meaning,
    recommendedFix,
  };
}

function InfoTip({ text }) {
  return (
    <span className="info-tip" tabIndex={0}>
      <HelpCircle size={16} />
      <span className="info-bubble">{text}</span>
    </span>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
  danger,
  warning,
  tip,
  onClick,
  loading = false,
  countdown = AUTO_REFRESH_SECONDS,
  refreshSeconds = AUTO_REFRESH_SECONDS,
  className = "",
}) {
  const shouldElectricAlert =
    String(label || "").toLowerCase() === "auto-flag agents" && Number(value) > 0;
  const safeRefreshSeconds = Math.max(1, Number(refreshSeconds || AUTO_REFRESH_SECONDS));
  const safeCountdown = Math.max(0, Math.min(safeRefreshSeconds, Number(countdown || 0)));
  const progressPercent = Math.max(0, Math.min(100, (safeCountdown / safeRefreshSeconds) * 100));

  return (
    <button
      type="button"
      className={`stat-card stat-card-button ${danger ? "danger-card" : ""} ${
        warning ? "warning-card" : ""
      } ${onClick ? "clickable-stat-card" : ""} ${
        shouldElectricAlert ? "auto-flag-alert" : ""
      } ${className}`}
      onClick={onClick}
      disabled={!onClick}
    >
      <div className="stat-top">
        <div className="stat-icon">{icon}</div>
        <InfoTip text={tip} />
      </div>

      <p>{label}</p>
      <h2>{value}</h2>
      <span>{sub}</span>

      <div className={`stat-countdown ${loading ? "is-loading" : ""}`}>
        <div className="stat-countdown-row">
          <span className="stat-countdown-label">{loading ? "Loading data" : "Next refresh"}</span>
          <strong>{formatCountdown(safeCountdown)}</strong>
        </div>
        <div className="stat-countdown-track" aria-hidden="true">
          <i style={{ width: `${progressPercent}%` }} />
        </div>
      </div>
    </button>
  );
}

function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <Eye size={28} />
      <strong>{title}</strong>
      <p>{text}</p>
    </div>
  );
}


function StatDetailModal({ detail, onClose, onPrimaryAction }) {
  if (!detail) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="stat-detail-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.title} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="stat-detail-header">
          <div>
            <span>{detail.eyebrow || "Metric details"}</span>
            <h2>{detail.title}</h2>
            <p>{detail.subtitle}</p>
          </div>

          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <div className="stat-detail-hero-row">
          <div className="stat-detail-big-number">
            <span>{detail.valueLabel}</span>
            <strong>{detail.value}</strong>
            <small className={detail.statusClass || "risk-neutral"}>{detail.status}</small>
          </div>

          <div className="stat-detail-meaning">
            <span>What this means</span>
            <p>{detail.meaning}</p>
          </div>
        </div>

        <div className="stat-detail-grid">
          <div className="stat-detail-block">
            <span>Evidence Watchtower is using</span>
            <ul>
              {(detail.evidence || []).map((item, index) => (
                <li key={`evidence-${index}`}>{item}</li>
              ))}
            </ul>
          </div>

          <div className="stat-detail-block action-block">
            <span>What to do next</span>
            <ul>
              {(detail.actions || []).map((item, index) => (
                <li key={`action-${index}`}>{item}</li>
              ))}
            </ul>
          </div>
        </div>

        {detail.footerNote ? <div className="stat-detail-note">{detail.footerNote}</div> : null}

        {detail.primaryActionLabel ? (
          <div className="stat-detail-footer">
            <button type="button" className="stat-detail-action-btn" onClick={onPrimaryAction}>
              {detail.primaryActionLabel}
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function FlaggedAgentsModal({ open, onClose, agents }) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="flagged-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Auto-flagged agents"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flagged-modal-header">
          <div>
            <span>Auto-flagged agents</span>
            <h2>Agents Watchtower says need review now</h2>
            <p>
              These agents were flagged from the saved watchlist, daily critical records,
              or live agent metrics. Review the evidence before coaching.
            </p>
          </div>

          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        {agents.length === 0 ? (
          <div className="flagged-modal-empty">
            <Eye size={34} />
            <h3>No flagged agents found yet.</h3>
            <p>
              The dashboard may show queue risk, but no agent-level flagged records are available
              in the current response yet. Let the monitor save one more snapshot or check the
              Agent Watchlist tab.
            </p>
          </div>
        ) : (
          <div className="flagged-agent-grid">
            {agents.map((agent, index) => (
              <article className="flagged-agent-card" key={`${agent.id}-${index}`}>
                <div className="flagged-agent-top">
                  <div>
                    <h3>{agent.agentName}</h3>
                    <p>
                      {agent.vendor === "Unknown"
                        ? "No call center was linked to this agent in the live queue data."
                        : `${agent.vendor} call center`}
                    </p>
                  </div>

                  <span className={`severity-badge ${severityClass(agent.severity)}`}>
                    {agent.severity}
                  </span>
                </div>

                <div className="flagged-agent-metrics">
                  <div>
                    <span>Issue</span>
                    <strong>{agent.issue}</strong>
                  </div>

                  <div>
                    <span>Avg Score</span>
                    <strong>{agent.averageScore}</strong>
                  </div>

                  <div>
                    <span>Calls Seen</span>
                    <strong>{agent.callsSeen}</strong>
                  </div>

                  <div>
                    <span>Last Call</span>
                    <strong>{agent.lastCallId}</strong>
                  </div>
                </div>

                <div className="flagged-agent-section">
                  <span>Evidence</span>
                  <p>{agent.evidence || "No detailed evidence was saved for this agent yet."}</p>
                </div>

                <div className="flagged-agent-section">
                  <span>Things to watch out</span>
                  <p>{agent.watchOut || "No watch-out notes saved yet."}</p>
                </div>

                <div className="flagged-agent-action">
                  <span>Recommended coaching action</span>
                  <p>{agent.coachingAction}</p>
                </div>

                <small className="flagged-source">Source: {agent.source}</small>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function App() {
  const [dashboard, setDashboard] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshCountdown, setRefreshCountdown] = useState(AUTO_REFRESH_SECONDS);
  const [lastLoaded, setLastLoaded] = useState("");
  const [error, setError] = useState("");
  const [flaggedModalOpen, setFlaggedModalOpen] = useState(false);
  const [statDetail, setStatDetail] = useState(null);

  async function loadDashboard() {
    try {
      setRefreshing(true);
      setError("");

      const [dashboardRes, monitorRes] = await Promise.allSettled([
        fetch(`${SERVER_URL}/api/dashboard`, { cache: "no-store" }),
        fetch(`${SERVER_URL}/api/monitor-status`, { cache: "no-store" }),
      ]);

      if (dashboardRes.status === "fulfilled" && dashboardRes.value.ok) {
        const data = await dashboardRes.value.json();

        if (data.ok) {
          setDashboard(data);
        } else {
          setError(data.error || "Dashboard returned an error.");
        }
      } else {
        setError("Watchtower server is waking up. Retrying automatically...");
      }

      if (monitorRes.status === "fulfilled" && monitorRes.value.ok) {
        const monitorData = await monitorRes.value.json();
        setMonitor(monitorData);
      }

      setLastLoaded(new Date().toLocaleString());
    } catch (err) {
      setError("Watchtower server is waking up. Retrying automatically...");
    } finally {
      setLoading(false);
      setRefreshing(false);
      setRefreshCountdown(AUTO_REFRESH_SECONDS);
    }
  }

  useEffect(() => {
    loadDashboard();

    const interval = setInterval(() => {
      loadDashboard();
    }, AUTO_REFRESH_SECONDS * 1000);

    const countdownInterval = setInterval(() => {
      setRefreshCountdown((current) => {
        if (current <= 1) return AUTO_REFRESH_SECONDS;
        return current - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(countdownInterval);
    };
  }, []);

  const sheet = dashboard?.sheetDashboard || dashboard?.dashboard || {};
  const live = dashboard?.liveQueue || dashboard?.queue || {};

  const latestSnapshot = sheet.latestSnapshot || {};
  const recentSnapshots = sheet.recentSnapshots || [];
  const todaySnapshots = sheet.todaySnapshots || [];
  const dailyCritical = sheet.dailyCritical || [];
  const watchlist = sheet.watchlist || [];
  const scoreAverages = sheet.scoreAverages || [];
  const vendorMetrics = sheet.vendorMetrics || [];
  const liveRows = live.rows || [];
  const cardsAreLoading = loading || refreshing;
  const liveAgentMetrics = live.agentMetrics || [];

  const activeWatchlist = useMemo(() => {
    return watchlist.filter((item) => {
      return String(item.Status || item.status || "").toLowerCase() !== "resolved";
    });
  }, [watchlist]);

  const flaggedAgents = useMemo(() => {
    const fromDailyCritical = dailyCritical.map(normalizeFlaggedAgentFromWatchlist);
    const fromWatchlist = activeWatchlist.map(normalizeFlaggedAgentFromWatchlist);

    const fromLiveMetrics = liveAgentMetrics
      .filter((agent) => {
        const severity = String(agent.severity || agent.Severity || "").toLowerCase();
        return severity === "critical" || severity === "high";
      })
      .map(normalizeFlaggedAgentFromMetric);

    const combined = [...fromDailyCritical, ...fromWatchlist, ...fromLiveMetrics];

    const deduped = new Map();

    combined.forEach((agent) => {
      const key = `${String(agent.agentName).toLowerCase()}|${String(agent.vendor).toLowerCase()}`;

      if (!deduped.has(key)) {
        deduped.set(key, agent);
        return;
      }

      const current = deduped.get(key);
      const currentWeight = severityWeight(current.severity);
      const nextWeight = severityWeight(agent.severity);

      if (nextWeight > currentWeight || agent.source === "Watchlist") {
        deduped.set(key, agent);
      }
    });

    return Array.from(deduped.values()).sort((a, b) => {
      return (
        severityWeight(b.severity) - severityWeight(a.severity) ||
        String(a.agentName).localeCompare(String(b.agentName))
      );
    });
  }, [dailyCritical, activeWatchlist, liveAgentMetrics]);

  const unassignedHighRiskRows = useMemo(() => {
    return liveRows.filter((row) => {
      const severity = String(row.severity || row.Severity || "").toLowerCase();
      const agent = String(row.agent || row["Agent Name"] || "").trim();

      return !agent && (severity === "critical" || severity === "high");
    });
  }, [liveRows]);

  const summary = useMemo(() => {
    const callsOnHold =
      safeNumber(live?.summary?.callsOnHold) ||
      safeNumber(latestSnapshot["Calls On Hold"]) ||
      safeNumber(latestSnapshot.callsOnHold);

    const agentsAvailable =
      safeNumber(live?.summary?.agentsAvailable) ||
      safeNumber(latestSnapshot["Agents Available"]) ||
      safeNumber(latestSnapshot.agentsAvailable);

    const pastCallback =
      safeNumber(live?.summary?.pastCallback) ||
      safeNumber(latestSnapshot["Past Callback Limit"]) ||
      safeNumber(latestSnapshot.pastCallback);

    const companyRisk =
      live?.summary?.companyRisk ||
      latestSnapshot["Company Risk Level"] ||
      latestSnapshot.companyRisk ||
      "Unknown";

    return {
      callsOnHold,
      agentsAvailable,
      pastCallback,
      autoFlagged: flaggedAgents.length,
      unassignedRisk: unassignedHighRiskRows.length,
      companyRisk,
    };
  }, [live, latestSnapshot, flaggedAgents.length, unassignedHighRiskRows.length]);

  const snapshotStats = useMemo(() => {
    const source = todaySnapshots.length ? todaySnapshots : recentSnapshots;

    const totalSnapshots = source.length;

    const zeroAvailableCount = source.filter((s) => {
      return safeNumber(s["Agents Available"]) === 0 && safeNumber(s["Calls On Hold"]) > 0;
    }).length;

    const criticalCount = source.filter((s) => {
      return String(s["Company Risk Level"] || "").toLowerCase() === "critical";
    }).length;

    const highCount = source.filter((s) => {
      return String(s["Company Risk Level"] || "").toLowerCase() === "high";
    }).length;

    const maxCallsOnHold = source.reduce((max, s) => {
      return Math.max(max, safeNumber(s["Calls On Hold"]));
    }, 0);

    const maxPastCallback = source.reduce((max, s) => {
      return Math.max(max, safeNumber(s["Past Callback Limit"]));
    }, 0);

    return {
      totalSnapshots,
      zeroAvailableCount,
      criticalCount,
      highCount,
      maxCallsOnHold,
      maxPastCallback,
    };
  }, [todaySnapshots, recentSnapshots]);

  const operationsDiagnosis = useMemo(() => {
    const callsOnHold = safeNumber(summary.callsOnHold);
    const agentsAvailable = safeNumber(summary.agentsAvailable);
    const pastCallback = safeNumber(summary.pastCallback);
    const autoFlagged = flaggedAgents.length;
    const unassignedRisk = unassignedHighRiskRows.length;

    const repeatedZeroCoverage = snapshotStats.zeroAvailableCount;
    const repeatedCriticalHigh = snapshotStats.criticalCount + snapshotStats.highCount;
    const peakHold = snapshotStats.maxCallsOnHold;
    const peakCallback = snapshotStats.maxPastCallback;

    let level = "Low";
    let headline = "Queue is currently stable.";
    let mainProblem = "No major queue failure is showing right now.";
    let businessImpact =
      "Continue monitoring score risk, callback risk, vendor coverage, and schedule adherence.";

    const actions = [];
    const leadershipMessage = [];

    if (callsOnHold > 0 && agentsAvailable === 0) {
      level = "Critical";
      headline = "Critical coverage gap: calls are waiting with 0 agents available.";
      mainProblem = `${callsOnHold} calls are currently on hold, but there are no agents available to take calls.`;
      businessImpact =
        "Customers are waiting without live coverage. This can increase callback volume, repeat contacts, poor customer experience, and escalation pressure.";

      actions.push("Contact vendor/team leads and request live coverage confirmation.");
      actions.push("Ask each vendor how many agents are actively covering the queue right now.");
      actions.push(
        "Use this snapshot as evidence to request the schedule/roster data needed for exact schedule adherence tracking."
      );
      actions.push("Prioritize callback-risk calls before random QA review.");
      actions.push(
        "Validate agent status from the live tools: available, on call, unavailable, break, lunch, or not logged in."
      );
    } else if (callsOnHold >= 25) {
      level = "High";
      headline = "High queue pressure: calls waiting are above safe level.";
      mainProblem = `${callsOnHold} calls are currently on hold.`;
      businessImpact =
        "The queue is building pressure. If staffing does not increase quickly, more calls may hit callback risk.";

      actions.push("Ask vendors to confirm live coverage and increase available agents if possible.");
      actions.push("Watch callback threshold closely.");
      actions.push(
        "Request roster/schedule data so Watchtower can compare expected coverage vs actual coverage."
      );
    }

    if (pastCallback > 0) {
      if (level !== "Critical") level = "High";

      actions.push(
        `Review the ${pastCallback} callback-risk calls first because they are already outside the safe waiting window.`
      );
      leadershipMessage.push(`${pastCallback} calls are already past callback threshold.`);
    }

    if (autoFlagged > 0) {
      actions.push(`Review the ${autoFlagged} auto-flagged agents before random QA sampling.`);
      leadershipMessage.push(`${autoFlagged} agents were auto-flagged for coaching review.`);
    }

    if (unassignedRisk > 0) {
      actions.push(
        `Review the ${unassignedRisk} unassigned high-risk queue rows because they could not be tied to a specific agent.`
      );
      leadershipMessage.push(`${unassignedRisk} high-risk rows had no agent name attached.`);
    }

    if (repeatedZeroCoverage > 0) {
      leadershipMessage.push(
        `${repeatedZeroCoverage} saved snapshots showed calls waiting with 0 agents available.`
      );
    }

    if (repeatedCriticalHigh > 0) {
      leadershipMessage.push(`${repeatedCriticalHigh} snapshots were Critical or High risk.`);
    }

    if (peakHold > 0) {
      leadershipMessage.push(`Peak calls on hold reached ${peakHold}.`);
    }

    if (peakCallback > 0) {
      leadershipMessage.push(`Peak callback-risk calls reached ${peakCallback}.`);
    }

    if (!actions.length) {
      actions.push("Continue monitoring live queue movement.");
      actions.push("Review daily low-score agents once score averages populate.");
      actions.push("Watch for repeated 0-available moments during peak times.");
    }

    return {
      level,
      headline,
      mainProblem,
      businessImpact,
      actions,
      leadershipMessage,
    };
  }, [summary, snapshotStats, flaggedAgents.length, unassignedHighRiskRows.length]);

  const agentFlagStory = useMemo(() => {
    return buildAgentFlagStory(dailyCritical, activeWatchlist);
  }, [dailyCritical, activeWatchlist]);

  const coverageNeedStory = useMemo(() => {
    return buildCoverageNeedStory(summary, snapshotStats, vendorMetrics);
  }, [summary, snapshotStats, vendorMetrics]);

  const callbackExposure = useMemo(() => {
    return buildCallbackExposureStory(summary, snapshotStats, todaySnapshots, recentSnapshots);
  }, [summary, snapshotStats, todaySnapshots, recentSnapshots]);

  const statDetails = useMemo(() => {
    const callsOnHold = safeNumber(summary.callsOnHold);
    const agentsAvailable = safeNumber(summary.agentsAvailable);
    const pastCallback = safeNumber(summary.pastCallback);
    const autoFlagged = flaggedAgents.length;
    const unassignedRisk = unassignedHighRiskRows.length;
    const agentsNeeded = estimateAgentsNeeded(callsOnHold, agentsAvailable);
    const snapshotDate = formatSnapshotDate(snapshotValue(latestSnapshot, "Date"));
    const snapshotTime = formatSnapshotTime(snapshotValue(latestSnapshot, "Time"));
    const snapshotStamp =
      snapshotDate === "â€”" && snapshotTime === "â€”"
        ? "No saved snapshot timestamp was loaded yet."
        : `Latest saved snapshot: ${snapshotDate} at ${snapshotTime}.`;

    const queueStatus =
      callsOnHold > 0 && agentsAvailable === 0
        ? "Critical coverage gap"
        : callsOnHold >= 25
          ? "High queue pressure"
          : callsOnHold > 0
            ? "Active queue pressure"
            : "No live hold pressure";

    const queueStatusClass =
      callsOnHold > 0 && agentsAvailable === 0
        ? "risk-critical"
        : callsOnHold >= 25
          ? "risk-high"
          : callsOnHold > 0
            ? "risk-medium"
            : "risk-low";

    const callbackStatus =
      pastCallback > 0 ? "Callback-risk calls found" : "No callback-risk calls showing";

    const flaggedPreview = flaggedAgents.slice(0, 5).map((agent) => {
      return `${agent.agentName} (${agent.vendor}, ${agent.severity})`;
    });

    return {
      callsOnHold: {
        eyebrow: "Live queue pressure",
        title: "Calls On Hold",
        subtitle: "This tells leadership how much customer demand is waiting right now.",
        valueLabel: "Current calls waiting",
        value: callsOnHold,
        status: queueStatus,
        statusClass: queueStatusClass,
        meaning:
          callsOnHold > 0
            ? "Customers are waiting in the queue. If available coverage is low, this becomes a staffing/utilization problem before it becomes a QA problem."
            : "The live queue is not showing hold pressure right now. Keep watching the saved snapshots for repeated spikes.",
        evidence: [
          `${callsOnHold} calls are currently on hold.`,
          `${agentsAvailable} agents are currently available.`,
          agentsNeeded > 0
            ? `Estimated extra agents needed right now: ${agentsNeeded}.`
            : "No extra-agent estimate was triggered by the current queue count.",
          snapshotStamp,
          `Peak calls on hold in loaded snapshots: ${snapshotStats.maxCallsOnHold}.`,
        ],
        actions:
          callsOnHold > 0
            ? [
                "Confirm which vendors have agents actually available, not only scheduled.",
                "Check whether agents are on break, lunch, unavailable, or logged out while calls are waiting.",
                "Use this metric with schedule adherence to prove utilization gaps.",
                "If calls are building, review callback-risk calls before random QA sampling.",
              ]
            : [
                "Keep monitoring every snapshot for spikes.",
                "Use historical snapshots to find which times of day usually create queue pressure.",
                "Compare queue pressure against vendor schedules once the roster data is available.",
              ],
        footerNote:
          "Best leadership use: this card helps prove whether the operation had enough live coverage when customers were waiting.",
      },

      agentsAvailable: {
        eyebrow: "Coverage / utilization",
        title: "Agents Available",
        subtitle: "This shows whether the queue had agents ready to receive calls.",
        valueLabel: "Available agents",
        value: agentsAvailable,
        status:
          agentsAvailable === 0 && callsOnHold > 0
            ? "Critical: 0 available while calls wait"
            : agentsAvailable === 0
              ? "0 available showing"
              : "Coverage showing available",
        statusClass:
          agentsAvailable === 0 && callsOnHold > 0
            ? "risk-critical"
            : agentsAvailable === 0
              ? "risk-high"
              : "risk-low",
        meaning:
          agentsAvailable === 0 && callsOnHold > 0
            ? "This is the strongest utilization warning: customers are waiting, but the live queue shows no available agents."
            : "Available agents are the coverage side of the story. This should be compared against schedules, breaks, lunches, and actual login status.",
        evidence: [
          `${agentsAvailable} agents are available now.`,
          `${callsOnHold} calls are on hold now.`,
          `${snapshotStats.zeroAvailableCount} loaded snapshots showed calls waiting with 0 agents available.`,
          `Critical/high saved snapshots loaded: ${snapshotStats.criticalCount + snapshotStats.highCount}.`,
          snapshotStamp,
        ],
        actions: [
          "Ask each vendor/team lead to confirm who is logged in and available right now.",
          "Compare available agents against the expected schedule, breaks, and lunches.",
          "When calls are waiting with 0 available, capture this as utilization evidence.",
          "Use the queue snapshot time to audit agent status in the vendor roster or WFM sheet.",
        ],
        footerNote:
          "Best leadership use: this card connects queue failure to schedule adherence and agent availability.",
      },

      pastCallback: {
        eyebrow: "Callback risk",
        title: "Past Callback",
        subtitle: "This identifies calls that have crossed the unsafe waiting threshold.",
        valueLabel: "Calls past 500 seconds",
        value: pastCallback,
        status: callbackStatus,
        statusClass: pastCallback > 0 ? "risk-high" : "risk-low",
        meaning:
          pastCallback > 0
            ? "These calls are already past the callback-risk threshold. They should be reviewed before random QA because they can create repeat contacts, escalations, and poor customer experience."
            : "No callback-risk calls are showing right now. Keep watching because this can change quickly when coverage drops.",
        evidence: [
          `${pastCallback} calls are currently past the 500-second callback threshold.`,
          `Peak callback-risk calls in loaded snapshots: ${snapshotStats.maxPastCallback}.`,
          `${callsOnHold} calls are on hold now.`,
          `${agentsAvailable} agents are available now.`,
          snapshotStamp,
        ],
        actions:
          pastCallback > 0
            ? [
                "Review callback-risk calls first.",
                "Check whether the wait was caused by low coverage, unavailable agents, or high volume.",
                "Use these calls as coaching and staffing evidence, not just QA score evidence.",
                "Confirm if these calls created repeat contacts later.",
              ]
            : [
                "Continue monitoring the callback threshold.",
                "Watch for repeated near-threshold calls during peak windows.",
                "Use this with Calls On Hold and Agents Available to tell the full queue story.",
              ],
        footerNote:
          "Best leadership use: this card shows the customer-experience impact of low coverage or slow queue movement.",
      },

      callbackExposure: {
        eyebrow: "Callback exposure",
        title: "Callback Exposure",
        subtitle: "This exposes how many calls have crossed the safe callback waiting window and what could happen if coverage does not improve.",
        valueLabel: "Current callback-risk calls",
        value: callbackExposure.currentCallbackRisk,
        status:
          callbackExposure.exposureLevel === "Critical"
            ? "Critical callback exposure"
            : callbackExposure.exposureLevel === "High"
              ? "Callback risk active"
              : "Callback exposure controlled",
        statusClass:
          callbackExposure.exposureLevel === "Critical"
            ? "risk-critical"
            : callbackExposure.exposureLevel === "High"
              ? "risk-high"
              : "risk-low",
        meaning: callbackExposure.meaning,
        evidence: [
          `${callbackExposure.currentCallbackRisk} calls are currently past callback threshold.`,
          `Peak callback exposure in loaded snapshots: ${callbackExposure.peakCallbackRisk}.`,
          `Recent average callback exposure: ${callbackExposure.averageCallbackRisk}.`,
          `Projected 5-day exposure if the pattern continues: ${callbackExposure.projectedFiveDays}.`,
          `Projected 7-day exposure if the pattern continues: ${callbackExposure.projectedSevenDays}.`,
          snapshotStamp,
        ],
        actions:
          callbackExposure.currentCallbackRisk > 0
            ? [
                "Prioritize callback-risk calls before random QA review.",
                "Validate whether the callback exposure is caused by low coverage, unavailable agents, or peak call volume.",
                "Use the snapshot time to ask vendors for live coverage confirmation.",
                "Once schedules are available, compare expected coverage vs actual queue coverage during the callback spike.",
              ]
            : [
                "Continue monitoring callback exposure by snapshot time.",
                "Use the forecast as an early warning before callbacks become repeat contacts.",
                "Add schedules later so Watchtower can show whether the root cause is staffing, adherence, or volume.",
              ],
        footerNote:
          "Best leadership use: this card turns callback risk into a prevention view instead of only reacting after customers have already waited too long.",
      },

      autoFlagged: {
        eyebrow: "Agent coaching priority",
        title: "Auto-Flag Agents",
        subtitle: "This shows how many agents Watchtower marked for coaching review from sheets and live metrics.",
        valueLabel: "Flagged agents",
        value: autoFlagged,
        status: autoFlagged > 0 ? "Agent review needed" : "No flagged agents loaded",
        statusClass: autoFlagged > 0 ? "risk-high" : "risk-low",
        meaning:
          autoFlagged > 0
            ? "These are the agents the system says should be reviewed before random sampling because they have score risk, queue risk, or repeated watchlist evidence."
            : "No flagged agents were loaded in the current dashboard response. Let the monitor save another snapshot or check the Google Sheet tabs.",
        evidence: [
          `${autoFlagged} unique agents are flagged after deduping Daily Critical, Watchlist, and Live Metrics.`,
          `${dailyCritical.length} Daily Critical records loaded.`,
          `${activeWatchlist.length} active Watchlist records loaded.`,
          `${liveAgentMetrics.length} live agent metrics loaded.`,
          flaggedPreview.length
            ? `First flagged agents: ${flaggedPreview.join(" | ")}.`
            : "No flagged-agent names are available in the current response.",
        ],
        actions:
          autoFlagged > 0
            ? [
                "Open the flagged agent list and review Critical agents first.",
                "Listen to those calls before random QA sampling.",
                "Validate the evidence column before coaching the agent.",
                "Separate agent behavior issues from staffing/coverage issues.",
              ]
            : [
                "Let the monitor run another snapshot.",
                "Check whether Google Sheets returned Daily Critical and Watchlist rows.",
                "Confirm the Apps Script dashboard action is returning agent records.",
              ],
        primaryActionLabel: autoFlagged > 0 ? "Open flagged agent list" : "Open flagged agent list anyway",
        primaryAction: "flaggedAgents",
        footerNote:
          "Best leadership use: this card tells you exactly where to start coaching instead of guessing.",
      },

      unassignedRisk: {
        eyebrow: "Data quality risk",
        title: "Unassigned Risk",
        subtitle: "This catches high-risk queue rows that could not be tied to a named agent.",
        valueLabel: "High-risk rows without agent",
        value: unassignedRisk,
        status: unassignedRisk > 0 ? "Needs data review" : "No unassigned risk showing",
        statusClass: unassignedRisk > 0 ? "risk-high" : "risk-low",
        meaning:
          unassignedRisk > 0
            ? "The queue has high-risk rows, but Watchtower cannot attach them to a specific agent. That means the issue is visible, but the coaching owner is not."
            : "High-risk rows are currently linked to agent names or no high-risk unassigned rows are showing.",
        evidence: [
          `${unassignedRisk} high/critical live queue rows have no agent name.`,
          `${liveRows.length} live rows were loaded from the queue response.`,
          `${flaggedAgents.length} named agents were still flagged successfully.`,
          snapshotStamp,
        ],
        actions:
          unassignedRisk > 0
            ? [
                "Review the live queue row details and confirm why the agent name is missing.",
                "Check whether the source page changed its HTML/table structure.",
                "Improve the scraper mapping so the agent field is captured every time.",
                "Do not coach an agent from this row until the owner is identified.",
              ]
            : [
                "Keep monitoring for source-page changes.",
                "Confirm new queue snapshots still include agent names.",
                "Use named flagged agents for coaching priority.",
              ],
        footerNote:
          "Best leadership use: this card protects you from blaming the wrong agent when the queue row did not expose ownership.",
      },
    };
  }, [
    summary,
    snapshotStats,
    latestSnapshot,
    callbackExposure,
    flaggedAgents,
    unassignedHighRiskRows.length,
    dailyCritical.length,
    activeWatchlist.length,
    liveAgentMetrics.length,
    liveRows.length,
  ]);

  return (
    <main className="app-shell">
      <header className="top-header">
        <div className="logo-stack">
          <img src="/logo.png" alt="Watchtower logo" className="main-logo" />

          <div className="top-actions">
            <a
              className="database-btn"
              href={GOOGLE_SHEET_DATABASE_URL}
              target="_blank"
              rel="noreferrer"
            >
              <Database size={18} />
              Open Google Sheet Database
              <ExternalLink size={15} />
            </a>

            <div className="monitor-pill">
              <Radio size={14} />
              24/7 Monitor: {monitor?.monitoring ? "ON" : "CHECKING"}
            </div>
          </div>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">HotelPlanner Operations Intelligence</span>

          <h1>
            Watchtower exposes critical agents, score risk, queue failure, and vendor coverage gaps.{" "}
            <InfoTip text="Leadership meaning: this is not a blame board. It is an evidence-based system showing where coaching, staffing, or vendor support is needed." />
          </h1>

          <p>
            This tool reads the support queue link, calculates daily agent risk, auto-saves high and
            critical agents into Google Sheets, and keeps a live watchlist for coaching and leadership
            visibility.
          </p>
        </div>

        <div className="hero-actions auto-monitor-only">
          <div className="monitor-status-card">
            <span className="pulse-dot"></span>

            <div>
              <strong>24/7 Monitor Running Automatically</strong>
              <small>
                Watchtower checks the live queue on schedule, saves snapshots, tracks average scores,
                and auto-flags critical agents into Google Sheets.
              </small>
            </div>
          </div>
        </div>
      </section>

      <div className="monitoring-gif-wrap">
        <img
          src="/monitoring-live.gif"
          alt="Watchtower monitoring live"
          className="monitoring-live-gif"
        />
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {sheet.error ? (
        <div className="error-banner">Google Sheet error: {sheet.error}</div>
      ) : null}

      <div className="sheet-load-banner">
        {loading
          ? "Loading Watchtower data from Google Sheets and live queue..."
          : `Loaded todayâ€™s critical agents, average scores, and snapshot evidence from Google Sheets. Last update: ${lastLoaded} Â· Watchlist: ${activeWatchlist.length} Â· Daily Critical: ${dailyCritical.length} Â· Live Metrics: ${liveAgentMetrics.length} Â· Flagged Agents: ${flaggedAgents.length}`}
      </div>

      <section className="stats-grid">
        <StatCard
          icon={<Users size={22} />}
          label="Calls On Hold"
          value={summary.callsOnHold}
          sub="Click for queue details"
          danger={summary.callsOnHold >= 25}
          onClick={() => setStatDetail(statDetails.callsOnHold)}
          tip="Shows how many customers are waiting. High volume means staffing, scheduling, or availability may need attention."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
        />

        <StatCard
          icon={<UserCheck size={22} />}
          label="Agents Available"
          value={summary.agentsAvailable}
          sub={summary.agentsAvailable === 0 ? "Click: 0 available is critical" : "Click for coverage details"}
          danger={summary.agentsAvailable === 0 && summary.callsOnHold > 0}
          onClick={() => setStatDetail(statDetails.agentsAvailable)}
          tip="Shows whether agents are available while calls are waiting. 0 available with calls on hold is a major coverage gap."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
        />

        <StatCard
          icon={<Clock size={22} />}
          label="Past Callback"
          value={summary.pastCallback}
          sub="Click for 500+ sec details"
          warning={summary.pastCallback > 0}
          onClick={() => setStatDetail(statDetails.pastCallback)}
          tip="Calls over 500 seconds are at callback-risk. These are priority calls for operational review."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
        />

        <StatCard
          icon={<PhoneCall size={22} />}
          label="Callback Exposure"
          value={callbackExposure.currentCallbackRisk}
          sub={`Peak saved: ${callbackExposure.peakCallbackRisk}`}
          danger={callbackExposure.exposureLevel === "Critical"}
          warning={callbackExposure.exposureLevel === "High"}
          onClick={() => setStatDetail(statDetails.callbackExposure)}
          tip="Shows current callback-risk calls, peak saved exposure, recent average, and a simple 5-day/7-day projection if the pattern continues."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
        />

        <StatCard
          icon={<ShieldAlert size={22} />}
          label="Auto-Flag Agents"
          value={flaggedAgents.length}
          sub="Click for agent-risk details"
          warning={flaggedAgents.length > 0}
          onClick={() => setStatDetail(statDetails.autoFlagged)}
          tip="Click this card to understand the auto-flag count, then open the detailed flagged-agent list from the popup."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
        />

        <StatCard
          icon={<AlertTriangle size={22} />}
          label="Unassigned Risk"
          value={unassignedHighRiskRows.length}
          sub="Click for missing-agent details"
          warning={unassignedHighRiskRows.length > 0}
          onClick={() => setStatDetail(statDetails.unassignedRisk)}
          tip="These are high or critical queue rows where Watchtower could not find an agent name, so they cannot be auto-saved as agent flags yet."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
        />
      </section>

  

      <section className="story-command-center">
        <div className="story-header">
          <div>
            <span className="story-eyebrow">Operations Story Center</span>
            <h2>
              What happened, what it means, and what to fix first{" "}
              <InfoTip text="This section turns queue data into plain-English story cards so a new QA or manager can understand the issue without decoding raw numbers." />
            </h2>
            <p>
              Watchtower converts every snapshot into a readable operations story: time, queue
              pressure, callback risk, staffing need, and coaching priority.
            </p>
          </div>

          <div className={`story-risk-pill ${riskClass(operationsDiagnosis.level)}`}>
            {operationsDiagnosis.level}
          </div>
        </div>

        <div className="story-diagnosis-card">
          <span>Current diagnosis</span>
          <h3>{operationsDiagnosis.headline}</h3>
          <p>{operationsDiagnosis.mainProblem}</p>
        </div>

        <div className="story-action-grid">
          <div className="story-action-card story-action-urgent">
            <span>Recommended next steps</span>
            <h3>Coverage actions to validate now</h3>

            <ol>
              {operationsDiagnosis.actions.map((action, index) => (
                <li key={index}>{action}</li>
              ))}
            </ol>
          </div>

          <div className="story-action-card">
            <span>Why leadership should care</span>
            <h3>Business impact</h3>
            <p>{operationsDiagnosis.businessImpact}</p>

            <div className="story-proof-list">
              {operationsDiagnosis.leadershipMessage.map((item, index) => (
                <div key={index}>{item}</div>
              ))}
            </div>
          </div>
        </div>

        <div className="coverage-need-card">
          <div>
            <span>Coverage need estimate</span>
            <h3>{coverageNeedStory.headline}</h3>
            <p>{coverageNeedStory.recommendation}</p>
          </div>

          <div className="coverage-need-details">
            <div>
              <span>Call Center Signal</span>
              <strong>{coverageNeedStory.callCenterName}</strong>
              <small>{coverageNeedStory.callCenterMessage}</small>
            </div>

            <div>
              <span>Estimated Extra Agents</span>
              <strong>{coverageNeedStory.estimatedAgentsNeeded}</strong>
              <small>Based on calls on hold divided by 8.</small>
            </div>

            <div>
              <span>Current Pressure</span>
              <strong>{coverageNeedStory.callsOnHold}</strong>
              <small>Calls currently on hold.</small>
            </div>

            <div>
              <span>Callback Risk</span>
              <strong>{coverageNeedStory.pastCallback}</strong>
              <small>Calls already past callback threshold.</small>
            </div>
          </div>
        </div>

        <div className="callback-exposure-card">
          <div>
            <span>Callback exposure</span>
            <h3>{callbackExposure.headline}</h3>
            <p>{callbackExposure.meaning}</p>
          </div>

          <div className="callback-exposure-details">
            <div>
              <span>Current Risk</span>
              <strong>{callbackExposure.currentCallbackRisk}</strong>
              <small>Calls currently past callback threshold.</small>
            </div>

            <div>
              <span>Peak Saved</span>
              <strong>{callbackExposure.peakCallbackRisk}</strong>
              <small>Highest callback exposure found in loaded snapshots.</small>
            </div>

            <div>
              <span>Recent Average</span>
              <strong>{callbackExposure.averageCallbackRisk}</strong>
              <small>Average callback exposure from saved snapshots.</small>
            </div>

            <div>
              <span>5-Day Projection</span>
              <strong>{callbackExposure.projectedFiveDays}</strong>
              <small>Potential callback-risk calls if the pattern continues.</small>
            </div>

            <div>
              <span>7-Day Projection</span>
              <strong>{callbackExposure.projectedSevenDays}</strong>
              <small>Potential callback-risk calls if the pattern continues.</small>
            </div>
          </div>

          <div className="callback-fix-box">
            <span>Recommended fix</span>
            <p>{callbackExposure.recommendedFix}</p>
          </div>
        </div>

        <div className="story-summary-grid">
          <div>
            <span>Total snapshots</span>
            <strong>{snapshotStats.totalSnapshots}</strong>
            <p>Saved queue moments.</p>
          </div>

          <div>
            <span>0 available moments</span>
            <strong>{snapshotStats.zeroAvailableCount}</strong>
            <p>Calls waiting with no agents available.</p>
          </div>

          <div>
            <span>Critical / high risk</span>
            <strong>{snapshotStats.criticalCount + snapshotStats.highCount}</strong>
            <p>Leadership-visible moments.</p>
          </div>

          <div>
            <span>Peak hold</span>
            <strong>{snapshotStats.maxCallsOnHold}</strong>
            <p>Worst calls-on-hold moment.</p>
          </div>

          <div>
            <span>Peak callback</span>
            <strong>{snapshotStats.maxPastCallback}</strong>
            <p>Worst callback-risk moment.</p>
          </div>
        </div>

        {recentSnapshots.length === 0 ? (
          <EmptyState
            title="No snapshots saved yet."
            text="Once Render saves queue data, story cards will appear here."
          />
        ) : (
          <>
            <div className="story-card-grid">
              {recentSnapshots.slice(0, 6).map((snapshot, index) => {
                const story = buildSnapshotStory(snapshot);

                return (
                  <article className="story-card" key={`${snapshot["Snapshot ID"]}-${index}`}>
                    <div className="story-card-top">
                      <span className={`risk-badge ${riskClass(story.risk)}`}>
                        {story.risk}
                      </span>

                      <div>
                        <strong>{story.time}</strong>
                        <small>{story.date}</small>
                      </div>
                    </div>

                    <h3>{story.headline}</h3>

                    <div className="story-metrics">
                      <div>
                        <span>Hold</span>
                        <b>{story.callsOnHold}</b>
                      </div>

                      <div>
                        <span>Available</span>
                        <b>{story.available}</b>
                      </div>

                      <div>
                        <span>Callback</span>
                        <b>{story.pastCallback}</b>
                      </div>

                      <div>
                        <span>Need</span>
                        <b>{story.agentsNeeded}</b>
                      </div>
                    </div>

                    <p className="story-risk-meaning">{story.riskMeaning}</p>

                    {story.details.length > 0 ? (
                      <ul className="story-detail-list">
                        {story.details.map((item, itemIndex) => (
                          <li key={itemIndex}>{item}.</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="story-detail-empty">
                        No callback or voicemail threshold was triggered.
                      </p>
                    )}

                    <div className="story-recommended-fix">
                      <span>Recommended fix</span>
                      <p>{story.action}</p>
                    </div>
                  </article>
                );
              })}
            </div>

            <div className="agent-story-card">
              <span>Agent watch story</span>
              <h3>Who should QA/coaching review first?</h3>
              <p>{agentFlagStory.text}</p>
            </div>

            <div className="story-table-card">
              <div className="story-table-title">
                <h3>Evidence Behind The Story</h3>
                <span>Last {Math.min(recentSnapshots.length, 20)} snapshots</span>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Calls On Hold</th>
                      <th>Available</th>
                      <th>Past Callback</th>
                      <th>Past Voicemail</th>
                      <th>Risk</th>
                      <th>What happened</th>
                    </tr>
                  </thead>

                  <tbody>
                    {recentSnapshots.slice(0, 20).map((snapshot, index) => {
                      const risk = snapshotValue(snapshot, "Company Risk Level", "Unknown");

                      return (
                        <tr key={`${snapshot["Snapshot ID"]}-${index}`}>
                          <td>{formatSnapshotDate(snapshotValue(snapshot, "Date"))}</td>
                          <td>{formatSnapshotTime(snapshotValue(snapshot, "Time"))}</td>
                          <td className="strong-cell">
                            {snapshotValue(snapshot, "Calls On Hold", 0)}
                          </td>
                          <td className="strong-cell">
                            {snapshotValue(snapshot, "Agents Available", 0)}
                          </td>
                          <td>{snapshotValue(snapshot, "Past Callback Limit", 0)}</td>
                          <td>{snapshotValue(snapshot, "Past Voicemail Limit", 0)}</td>
                          <td>
                            <span className={`risk-badge ${riskClass(risk)}`}>{risk}</span>
                          </td>
                          <td className="evidence-cell">
                            {snapshotValue(snapshot, "Company Reasons")}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </section>

      <section className="dashboard-grid">
        <div className="panel large-panel">
          <div className="panel-title">
            <div>
              <h2>
                <AlertTriangle size={22} />
                Live Daily Critical Agents From Google Sheet{" "}
                <InfoTip text="This is your daily coaching list. It shows who needs review today based on evidence saved into the Google Sheet." />
              </h2>
              <p>Auto-saved agents that need review, coaching, or vendor follow-up.</p>
            </div>
          </div>

          {dailyCritical.length === 0 ? (
            <EmptyState
              title="No critical agents saved for today yet."
              text="When the monitor identifies high or critical agent risk, they will appear here automatically."
            />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Agent</th>
                    <th>Vendor</th>
                    <th>Issue</th>
                    <th>Risk</th>
                    <th>Avg Score</th>
                    <th>Calls</th>
                    <th>Evidence</th>
                  </tr>
                </thead>

                <tbody>
                  {dailyCritical.slice(0, 12).map((item, index) => (
                    <tr key={`${item["Watchlist ID"] || item["Agent Name"]}-${index}`}>
                      <td className="strong-cell">{formatValue(item["Agent Name"])}</td>
                      <td>{formatValue(item.Vendor)}</td>
                      <td>{formatValue(item["Issue Type"])}</td>
                      <td>
                        <span className={`severity-badge ${severityClass(item.Severity)}`}>
                          {formatValue(item.Severity)}
                        </span>
                      </td>
                      <td>{formatValue(item["Average Score"])}</td>
                      <td>{formatValue(item["Calls Seen Today"])}</td>
                      <td className="evidence-cell">{formatValue(item.Evidence)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <h2>
              <BarChart3 size={22} />
              Agent Average Scores From The Link{" "}
              <InfoTip text="This tracks agent score averages from the queue link. Low averages become coaching opportunities and may trigger auto-watchlist records." />
            </h2>
          </div>

          {scoreAverages.length === 0 ? (
            <EmptyState
              title="No score averages yet."
              text="Once snapshots are saved, agent averages will appear here."
            />
          ) : (
            <div className="score-list">
              {scoreAverages.slice(0, 10).map((agent, index) => (
                <div className="score-row" key={`${agent["Agent Name"]}-${index}`}>
                  <div>
                    <strong>{formatValue(agent["Agent Name"])}</strong>
                    <span>
                      {formatValue(agent.Vendor)} Â· {formatValue(agent["Calls Seen"])} calls
                    </span>
                  </div>

                  <div className="score-number">{formatValue(agent["Average Score"])}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="dashboard-grid">
        <div className="panel">
          <div className="panel-title">
            <h2>
              <Wifi size={22} />
              Vendor Coverage Exposure{" "}
              <InfoTip text="This helps leadership see whether the issue is agent-level, vendor-level, or staffing coverage related." />
            </h2>
          </div>

          {vendorMetrics.length === 0 ? (
            <EmptyState
              title="No vendor metrics yet."
              text="Vendor metrics populate after the monitor saves queue snapshots."
            />
          ) : (
            <div className="vendor-grid">
              {vendorMetrics.map((vendor, index) => (
                <div className="vendor-card" key={`${vendor.Vendor}-${index}`}>
                  <strong>{formatValue(vendor.Vendor)}</strong>

                  <div>
                    <span>Calls Seen</span>
                    <b>{formatValue(vendor["Calls Seen"])}</b>
                  </div>

                  <div>
                    <span>Agents Seen</span>
                    <b>{formatValue(vendor["Agents Seen"])}</b>
                  </div>

                  <div>
                    <span>Avg Score</span>
                    <b>{formatValue(vendor["Average Score"])}</b>
                  </div>

                  <div>
                    <span>Critical</span>
                    <b>{formatValue(vendor["Critical Flags"])}</b>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="panel">
          <div className="panel-title">
            <h2>
              <Eye size={22} />
              Active Watchlist{" "}
              <InfoTip text="This is the ongoing coaching tracker. Agents stay here until marked resolved in the Google Sheet." />
            </h2>
          </div>

          {activeWatchlist.length === 0 ? (
            <EmptyState
              title="No active watchlist items."
              text="Agents will appear here when the system auto-saves or when you add them manually."
            />
          ) : (
            <div className="watchlist-stack">
              {activeWatchlist.slice(0, 8).map((item, index) => (
                <button
                  type="button"
                  className="watch-card watch-card-clickable"
                  key={`${item.ID}-${index}`}
                  onClick={() => setFlaggedModalOpen(true)}
                >
                  <div>
                    <strong>{formatValue(item["Agent Name"])}</strong>
                    <span>
                      {formatValue(item.Vendor)} Â· {formatValue(item["Issue Type"])}
                    </span>
                  </div>

                  <span className={`severity-badge ${severityClass(item.Severity)}`}>
                    {formatValue(item.Severity)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="panel full-panel">
        <div className="panel-title">
          <div>
            <h2>
              What We Can Take From The Queue Link{" "}
              <InfoTip text="This section explains the business value to leadership. It turns a simple queue page into an operations intelligence tool." />
            </h2>
            <p>Boss-friendly explanation of why this tool matters.</p>
          </div>
        </div>

        <div className="value-grid">
          <div>
            <strong>Agent Risk</strong>
            <p>
              Shows agents with low average scores, long call exposure, callback risk, or repeated
              daily flags.
            </p>
          </div>

          <div>
            <strong>Queue Failure</strong>
            <p>
              Exposes when calls are waiting while no agents are available, which creates customer
              experience risk.
            </p>
          </div>

          <div>
            <strong>Vendor Coverage</strong>
            <p>
              Highlights whether WNS, TEP, Buwelo, Concentrix, Telus, or other vendors are creating
              coverage gaps.
            </p>
          </div>

          <div>
            <strong>Coaching Priority</strong>
            <p>
              Creates a daily list of agents to review first so QA work is targeted and
              evidence-based.
            </p>
          </div>
        </div>
      </section>

      <section className="panel full-panel">
        <div className="panel-title">
          <div>
            <h2>
              Live Queue Rows / Calls To Review First{" "}
              <InfoTip text="These are the queue rows currently visible from the support queue. Long waits, low scores, and high severity rows should be reviewed first." />
            </h2>
            <p>Use this as your starting point for call listening and coaching.</p>
          </div>
        </div>

        {liveRows.length === 0 ? (
          <EmptyState
            title="No live rows loaded."
            text="If the HotelPlanner page requires login, add HP_COOKIE on Render or use the Google Sheet data as the source."
          />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Call ID</th>
                  <th>Agent</th>
                  <th>Vendor</th>
                  <th>Duration</th>
                  <th>Score</th>
                  <th>Last Action</th>
                  <th>Severity</th>
                  <th>Reasons</th>
                </tr>
              </thead>

              <tbody>
                {liveRows.slice(0, 25).map((row, index) => (
                  <tr key={`${row.callId}-${index}`}>
                    <td>{formatValue(row.callId)}</td>
                    <td className="strong-cell">{formatValue(row.agent)}</td>
                    <td>{formatValue(row.vendor)}</td>
                    <td>{formatValue(row.durationLabel)}</td>
                    <td>{formatValue(row.score)}</td>
                    <td>{formatValue(row.lastAction)}</td>
                    <td>
                      <span className={`severity-badge ${severityClass(row.severity)}`}>
                        {formatValue(row.severity)}
                      </span>
                    </td>
                    <td className="evidence-cell">
                      {Array.isArray(row.reasons)
                        ? row.reasons.join(" | ")
                        : formatValue(row.reasons)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="footer">
        Watchtower Â· QA & Utilization Intelligence Â· Automatic monitoring every{" "}
        {AUTO_REFRESH_SECONDS} seconds
      </footer>

      <StatDetailModal
        detail={statDetail}
        onClose={() => setStatDetail(null)}
        onPrimaryAction={() => {
          if (statDetail?.primaryAction === "flaggedAgents") {
            setStatDetail(null);
            setFlaggedModalOpen(true);
          }
        }}
      />

      <FlaggedAgentsModal
        open={flaggedModalOpen}
        onClose={() => setFlaggedModalOpen(false)}
        agents={flaggedAgents}
      />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
