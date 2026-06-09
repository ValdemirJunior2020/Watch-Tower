import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  AlertTriangle,
  BarChart3,
  CalendarCheck,
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
  "https://docs.google.com/spreadsheets/d/1aOfpStv8ZApqvG5-cKuEKiKuVwO0u-DE_s2vgK83A8M/edit?usp=sharing";

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

function secondsToClock(seconds) {
  const total = Math.max(0, safeNumber(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;

  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatValue(value, fallback = "—") {
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

function snapshotValue(snapshot, key, fallback = "—") {
  const value = snapshot?.[key];

  if (value === undefined || value === null || value === "") {
    return fallback;
  }

  return value;
}

function formatSnapshotDate(value) {
  if (!value) return "—";

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
  if (!value) return "—";

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


function parseScheduleTimeParts(value) {
  if (value === undefined || value === null || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return {
      hour: value.getHours(),
      minute: value.getMinutes(),
    };
  }

  const raw = String(value).trim();
  if (!raw || raw === "—") return null;

  // Google Sheets often returns time-only values as fake ISO dates like
  // 1899-12-30T14:00:00.000Z. That means 2:00 PM, not Dec 30, 1899.
  const isoTimeOnly = raw.match(/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})(?::\d{2})?(?:\.\d+)?Z?$/);
  if (isoTimeOnly) {
    return {
      hour: Number(isoTimeOnly[1]),
      minute: Number(isoTimeOnly[2]),
    };
  }

  const standardTime = raw.match(/^(\d{1,2}):(\d{2})\s*([AP]M)?$/i);
  if (standardTime) {
    let hour = Number(standardTime[1]);
    const minute = Number(standardTime[2]);
    const ampm = standardTime[3] ? standardTime[3].toUpperCase() : "";

    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return { hour, minute };
  }

  const compactTime = raw.match(/^(\d{1,2})\s*([AP]M)$/i);
  if (compactTime) {
    let hour = Number(compactTime[1]);
    const ampm = compactTime[2].toUpperCase();

    if (ampm === "PM" && hour < 12) hour += 12;
    if (ampm === "AM" && hour === 12) hour = 0;

    return { hour, minute: 0 };
  }

  return null;
}

function formatScheduleTime(value, fallback = "—") {
  const parts = parseScheduleTimeParts(value);
  if (!parts) {
    return formatValue(value, fallback);
  }

  const date = new Date(2000, 0, 1, parts.hour, parts.minute, 0);
  return date.toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatScheduleRange(start, end) {
  const startLabel = formatScheduleTime(start);
  const endLabel = formatScheduleTime(end);
  if (startLabel === "—" && endLabel === "—") return "—";
  return `${startLabel} - ${endLabel}`;
}

function getScheduleAgentMatchStatus(agent) {
  return String(
    agent?.matchStatus ||
      agent?.["Name Match Status"] ||
      agent?.nameMatchStatus ||
      agent?.["Match Quality"] ||
      agent?.matchQuality ||
      ""
  ).trim();
}

function needsNameMap(agent) {
  return getScheduleAgentMatchStatus(agent).toLowerCase().includes("needs name map");
}

function getQueueVisibilityLabel(agent) {
  if (needsNameMap(agent)) return "Cannot check yet";
  if (agent?.seen === true) return "Visible in queue link";
  if (agent?.seen === false) return "Not visible in queue snapshot";
  return "Not checked";
}

function getQueueVisibilityClass(agent) {
  if (needsNameMap(agent)) return "severity-medium";
  if (agent?.seen === true) return "severity-low";
  if (agent?.seen === false) return "severity-high";
  return "severity-neutral";
}

function getNameMapInstruction(agent) {
  const vendor = formatValue(agent?.vendor, "Vendor");
  const agentId = formatValue(agent?.agentId, "Agent ID");
  return `Add this in Schedule Name Map: Vendor=${vendor}, Agent ID=${agentId}, Queue Name Override=exact live queue agent name, Active=Yes.`;
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
    averageScore: item["Average Score"] || item.averageScore || "—",
    callsSeen: item["Calls Seen Today"] || item.callsSeenToday || item.callsSeen || "—",
    lastCallId: item["Last Queue Call ID"] || item.lastQueueCallId || item.lastCallId || "—",
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
    averageScore: item.avgScore || item["Average Score"] || "—",
    callsSeen: item.callsSeen || item["Calls Seen"] || "—",
    lastCallId: item.lastCallId || item["Last Queue Call ID"] || "—",
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
      score: "—",
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
    callCenterMessage = `${topVendor.Vendor} is the strongest call-center signal in today’s saved vendor data.`;
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



function readCallerValue(row, keys, fallback = "") {
  for (const key of keys) {
    const value = row?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function normalizePhoneForUi(value) {
  return String(value || "").replace(/\D/g, "");
}

function maskPhoneForUi(value) {
  const digits = normalizePhoneForUi(value);
  if (!digits) return "—";
  if (digits.length <= 4) return digits;
  const last4 = digits.slice(-4);
  if (digits.length === 10) return `***-***-${last4}`;
  return `***${last4}`;
}

function normalizeCallerExposureRow(row, index, fallbackSummary = {}) {
  const callerPhone = readCallerValue(row, ["Caller Phone", "caller", "Caller", "callerPhone"]);
  const normalizedPhone = readCallerValue(row, ["Caller Phone Normalized", "callerPhoneNormalized", "normalizedPhone"]);
  const maskedPhone = readCallerValue(row, ["Caller Phone Masked", "callerPhoneMasked", "maskedPhone"], maskPhoneForUi(normalizedPhone || callerPhone));
  const durationSeconds = safeNumber(readCallerValue(row, ["Duration Seconds", "durationSeconds"], 0));
  const callbackRisk = String(readCallerValue(row, ["Callback Risk", "callbackRisk"], durationSeconds >= 500 ? "Yes" : "No"));
  const voicemailRisk = String(readCallerValue(row, ["Voicemail Risk", "voicemailRisk"], "No"));
  const capturedAt = readCallerValue(row, ["Captured At", "capturedAt", "Checked At", "checkedAt"]);
  const time = readCallerValue(row, ["Time", "time"], capturedAt);
  const callsOnHold = safeNumber(readCallerValue(row, ["Calls On Hold", "callsOnHold"], fallbackSummary.callsOnHold || 0));
  const agentsAvailable = safeNumber(readCallerValue(row, ["Agents Available", "agentsAvailable"], fallbackSummary.agentsAvailable || 0));

  return {
    id: `${readCallerValue(row, ["Snapshot ID", "snapshotId"], "snapshot")}-${readCallerValue(row, ["Call ID", "callId"], index)}-${index}`,
    date: readCallerValue(row, ["Date", "date"]),
    time,
    capturedAt,
    snapshotId: readCallerValue(row, ["Snapshot ID", "snapshotId"]),
    callId: readCallerValue(row, ["Call ID", "callId"]),
    callerPhone,
    normalizedPhone: normalizePhoneForUi(normalizedPhone || callerPhone),
    maskedPhone,
    calledNumber: readCallerValue(row, ["Called Number", "Called", "calledNumber", "called"]),
    durationSeconds,
    duration: readCallerValue(row, ["Duration", "duration", "durationLabel"], secondsToClock(durationSeconds)),
    callbackThreshold: safeNumber(readCallerValue(row, ["Callback Threshold Seconds", "callbackThreshold"], 500)),
    callbackRisk,
    voicemailThreshold: safeNumber(readCallerValue(row, ["Voicemail Threshold Seconds", "voicemailThreshold"], 1500)),
    voicemailRisk,
    agentName: readCallerValue(row, ["Agent Name", "agent", "agentName"]),
    vendor: readCallerValue(row, ["Vendor", "vendor"], "Unknown"),
    lastAction: readCallerValue(row, ["Last Action", "lastAction"]),
    severity: readCallerValue(row, ["Severity", "severity"], callbackRisk.toLowerCase() === "yes" ? "High" : "Low"),
    reasons: readCallerValue(row, ["Reasons", "reasons"]),
    notes: readCallerValue(row, ["Notes", "notes"]),
    callsOnHold,
    agentsAvailable,
    exposureType: readCallerValue(row, ["Exposure Type", "exposureType"], callbackRisk.toLowerCase() === "yes" ? "Callback-risk caller" : "Caller captured"),
    matchKey: readCallerValue(row, ["Match Key", "matchKey"]),
  };
}

function buildCallerExposureView(sheetRows, sheetSummary, liveRows, queueSummary) {
  const sheetSource = Array.isArray(sheetRows) ? sheetRows : [];
  const liveFallback = sheetSource.length
    ? []
    : (Array.isArray(liveRows) ? liveRows : []).filter((row) => normalizePhoneForUi(row?.caller || row?.Caller));

  const sourceRows = sheetSource.length ? sheetSource : liveFallback;
  const normalizedRows = sourceRows
    .map((row, index) => normalizeCallerExposureRow(row, index, queueSummary))
    .filter((row) => row.normalizedPhone)
    .sort((a, b) => {
      const aDate = new Date(a.capturedAt || a.time || 0);
      const bDate = new Date(b.capturedAt || b.time || 0);
      return bDate - aDate;
    });

  const uniqueCallers = new Set();
  const callbackRiskCallers = new Set();
  const voicemailRiskCallers = new Set();
  let maxWaitSeconds = 0;

  normalizedRows.forEach((row) => {
    if (row.normalizedPhone) uniqueCallers.add(row.normalizedPhone);
    if (String(row.callbackRisk).toLowerCase() === "yes") callbackRiskCallers.add(row.normalizedPhone);
    if (String(row.voicemailRisk).toLowerCase() === "yes") voicemailRiskCallers.add(row.normalizedPhone);
    maxWaitSeconds = Math.max(maxWaitSeconds, safeNumber(row.durationSeconds));
  });

  return {
    rows: normalizedRows,
    totalRows: safeNumber(sheetSummary?.rows, normalizedRows.length),
    uniqueCallers: safeNumber(sheetSummary?.uniqueCallers, uniqueCallers.size),
    callbackRiskCallers: safeNumber(sheetSummary?.callbackRiskCallers, callbackRiskCallers.size),
    voicemailRiskCallers: safeNumber(sheetSummary?.voicemailRiskCallers, voicemailRiskCallers.size),
    maxWaitSeconds: safeNumber(sheetSummary?.maxWaitSeconds, maxWaitSeconds),
    maxWaitDuration: sheetSummary?.maxWaitDuration || secondsToClock(maxWaitSeconds),
    source: sheetSource.length ? "Google Sheet: Caller Queue Exposure" : "Live queue fallback",
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



function CallerExposureModal({ open, onClose, data }) {
  if (!open) return null;

  const rows = Array.isArray(data?.rows) ? data.rows : [];

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="caller-exposure-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Caller phone exposure details"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flagged-modal-header">
          <div>
            <span>Caller phone exposure</span>
            <h2>Caller numbers captured from the queue link</h2>
            <p>
              This card saves the caller phone numbers seen in the live queue so you can later
              compare them against the Tableau callback report. It proves queue exposure by caller;
              it does not claim the callback happened until Tableau confirms the same phone number.
            </p>
          </div>

          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        <div className="caller-exposure-summary-grid">
          <div>
            <span>Unique caller numbers</span>
            <strong>{data?.uniqueCallers || 0}</strong>
            <small>Phone numbers captured today</small>
          </div>
          <div>
            <span>Callback-risk callers</span>
            <strong>{data?.callbackRiskCallers || 0}</strong>
            <small>Callers that crossed the callback-risk wait threshold</small>
          </div>
          <div>
            <span>Voicemail-risk callers</span>
            <strong>{data?.voicemailRiskCallers || 0}</strong>
            <small>Callers that crossed the voicemail-risk wait threshold</small>
          </div>
          <div>
            <span>Longest wait</span>
            <strong>{data?.maxWaitDuration || "0:00"}</strong>
            <small>Longest caller wait captured today</small>
          </div>
        </div>

        <div className="caller-exposure-note">
          <strong>Simple use:</strong> export or compare these caller numbers against Tableau Callback Report.
          If the same phone number appears later in Tableau, mark it as a confirmed callback match.
        </div>

        {rows.length === 0 ? (
          <div className="flagged-modal-empty">
            <PhoneCall size={34} />
            <h3>No caller phone exposure saved yet.</h3>
            <p>
              Let Watchtower save one new queue snapshot after replacing Code.gs. The new tab should be
              called Caller Queue Exposure.
            </p>
          </div>
        ) : (
          <div className="table-wrap caller-exposure-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Caller</th>
                  <th>Call ID</th>
                  <th>Wait</th>
                  <th>Callback Risk</th>
                  <th>Voicemail Risk</th>
                  <th>Calls / Available</th>
                  <th>Agent</th>
                  <th>Vendor</th>
                  <th>Last Action</th>
                  <th>Exposure Type</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, 250).map((row, index) => (
                  <tr key={row.id || `${row.normalizedPhone}-${index}`}>
                    <td>{formatSnapshotTime(row.capturedAt || row.time)}</td>
                    <td className="strong-cell">{formatValue(row.maskedPhone)}</td>
                    <td>{formatValue(row.callId)}</td>
                    <td>{formatValue(row.duration)}</td>
                    <td>
                      <span className={`severity-badge ${String(row.callbackRisk).toLowerCase() === "yes" ? "severity-high" : "severity-low"}`}>
                        {formatValue(row.callbackRisk)}
                      </span>
                    </td>
                    <td>
                      <span className={`severity-badge ${String(row.voicemailRisk).toLowerCase() === "yes" ? "severity-critical" : "severity-low"}`}>
                        {formatValue(row.voicemailRisk)}
                      </span>
                    </td>
                    <td>{row.callsOnHold} / {row.agentsAvailable}</td>
                    <td>{formatValue(row.agentName)}</td>
                    <td>{formatValue(row.vendor)}</td>
                    <td>{formatValue(row.lastAction)}</td>
                    <td className="evidence-cell">{formatValue(row.exposureType)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
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


function getScheduleMetric(source, camelKey, sheetKey) {
  return safeNumber(source?.[camelKey] ?? source?.[sheetKey] ?? 0);
}

function scheduleField(row, sheetKey, camelKey, fallback = "") {
  return row?.[sheetKey] ?? row?.[camelKey] ?? fallback;
}

function normalizeScheduleStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function agentNameKey(name) {
  let raw = String(name || "").toLowerCase().trim();

  try {
    raw = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  } catch (err) {}

  raw = raw.replace(/[^a-z0-9, ]+/g, " ").replace(/\s+/g, " ").trim();

  if (raw.includes(",")) {
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (parts.length >= 2) raw = `${parts.slice(1).join(" ")} ${parts[0]}`;
  }

  return raw.replace(/\s+/g, " ").trim();
}

function agentTokenKey(name) {
  return agentNameKey(name)
    .split(" ")
    .filter((part) => part.length > 1)
    .sort()
    .join("|");
}

function buildVisibleAgentMap(liveRows = [], liveAgentMetrics = []) {
  const exact = new Set();
  const token = new Set();

  function add(name) {
    const raw = String(name || "").trim();
    if (!raw) return;
    const exactKey = agentNameKey(raw);
    const tokenKey = agentTokenKey(raw);
    if (exactKey) exact.add(exactKey);
    if (tokenKey) token.add(tokenKey);
  }

  liveRows.forEach((row) => add(row.agent || row["Agent Name"]));
  liveAgentMetrics.forEach((agent) => add(agent.agent || agent["Agent Name"]));

  return { exact, token };
}

function isAgentVisibleInQueue(name, visibleMap) {
  const exactKey = agentNameKey(name);
  const tokenKey = agentTokenKey(name);
  return Boolean(visibleMap.exact.has(exactKey) || visibleMap.token.has(tokenKey));
}

function parseTimeParts(timeText) {
  return parseScheduleTimeParts(timeText);
}

function dateTimeFromDateAndTime(dateKey, timeText) {
  const parts = parseTimeParts(timeText);
  if (!parts) return null;

  const dateParts = String(dateKey || "").split("-").map(Number);
  if (dateParts.length < 3 || dateParts.some((part) => Number.isNaN(part))) return null;

  return new Date(dateParts[0], dateParts[1] - 1, dateParts[2], parts.hour, parts.minute, 0);
}

function isNowWithinWindow(dateKey, startText, endText, now = new Date(), graceMinutes = 0) {
  const start = dateTimeFromDateAndTime(dateKey, startText);
  const end = dateTimeFromDateAndTime(dateKey, endText);

  if (!start || !end) return false;
  if (end <= start) end.setDate(end.getDate() + 1);

  const safeStart = new Date(start.getTime() + Number(graceMinutes || 0) * 60000);
  return now >= safeStart && now <= end;
}

function getCurrentBreakWindow(schedule, now = new Date()) {
  const dateKey = scheduleField(schedule, "Date", "date");
  const windows = [
    ["Break 1", scheduleField(schedule, "Break 1 Start", "break1Start"), scheduleField(schedule, "Break 1 End", "break1End")],
    ["Lunch", scheduleField(schedule, "Lunch Start", "lunchStart"), scheduleField(schedule, "Lunch End", "lunchEnd")],
    ["Break 2", scheduleField(schedule, "Break 2 Start", "break2Start"), scheduleField(schedule, "Break 2 End", "break2End")],
  ];

  for (const [label, startText, endText] of windows) {
    if (!startText || !endText) continue;
    if (isNowWithinWindow(dateKey, startText, endText, now, 0)) {
      return `${label} ${startText} - ${endText}`;
    }
  }

  return "";
}

function isScheduleRowWorkingNow(schedule, now = new Date()) {
  const status = normalizeScheduleStatus(scheduleField(schedule, "Schedule Status", "scheduleStatus"));
  if (status !== "scheduled") return false;

  const dateKey = scheduleField(schedule, "Date", "date");
  const start = scheduleField(schedule, "Scheduled Start", "scheduledStart");
  const end = scheduleField(schedule, "Scheduled End", "scheduledEnd");

  return isNowWithinWindow(dateKey, start, end, now, 10);
}

function buildScheduleCoverageFromImportedSchedules(schedulesToday, liveRows, liveAgentMetrics, now = new Date()) {
  const visibleMap = buildVisibleAgentMap(liveRows, liveAgentMetrics);
  const shouldBeWorkingAgents = [];
  const exposedAgents = [];
  const onBreakAgents = [];
  const needsNameMapAgents = [];

  (Array.isArray(schedulesToday) ? schedulesToday : []).forEach((schedule) => {
    const vendor = scheduleField(schedule, "Vendor", "vendor", "Unknown");
    const agentId = scheduleField(schedule, "Agent ID", "agentId", "");
    const agentName = scheduleField(schedule, "Agent Name", "agentName", "");
    const matchStatus = scheduleField(schedule, "Name Match Status", "nameMatchStatus", "Source Name");
    const start = scheduleField(schedule, "Scheduled Start", "scheduledStart", "");
    const end = scheduleField(schedule, "Scheduled End", "scheduledEnd", "");
    const status = scheduleField(schedule, "Schedule Status", "scheduleStatus", "");

    const needsMap = String(matchStatus).toLowerCase().includes("needs name map");
    if (needsMap) {
      needsNameMapAgents.push({
        vendor,
        agentId,
        agentName,
        start,
        end,
        status,
        seen: null,
        matchStatus,
        source: schedule,
        evidence:
          "Cannot compare this schedule row to the live queue until the EDS/code is mapped to the exact queue agent name.",
      });
      return;
    }

    if (!isScheduleRowWorkingNow(schedule, now)) return;

    const breakWindow = getCurrentBreakWindow(schedule, now);
    if (breakWindow) {
      onBreakAgents.push({ vendor, agentId, agentName, start, end, breakWindow, status, matchStatus, source: schedule });
      return;
    }

    const seen = isAgentVisibleInQueue(agentName, visibleMap);
    const item = {
      vendor,
      agentId,
      agentName,
      start,
      end,
      status,
      seen,
      matchStatus,
      source: schedule,
      evidence: seen
        ? "Agent is scheduled now and was seen in the live queue snapshot."
        : "Agent is scheduled now, not on break/lunch, and was not visible in the live queue snapshot.",
    };

    shouldBeWorkingAgents.push(item);
    if (!seen) exposedAgents.push(item);
  });

  return {
    shouldBeWorkingAgents,
    exposedAgents,
    onBreakAgents,
    needsNameMapAgents,
    scheduledNow: shouldBeWorkingAgents.length,
    seenInQueue: shouldBeWorkingAgents.filter((agent) => agent.seen).length,
    scheduledButNotSeen: exposedAgents.length,
    onBreakLunch: onBreakAgents.length,
    missingNameMap: needsNameMapAgents.length,
  };
}

function isActiveScheduleFlag(flag) {
  const resolved = String(flag?.Resolved || flag?.resolved || "No").toLowerCase();
  if (resolved === "yes" || resolved === "resolved" || resolved === "true") return false;

  const type = String(flag?.["Flag Type"] || flag?.flagType || "").toLowerCase();
  return (
    type.includes("coverage validation") ||
    type.includes("scheduled during queue exposure") ||
    type.includes("scheduled but not seen") ||
    type.includes("scheduled not visible") ||
    type.includes("schedule mismatch") ||
    type.includes("not scheduled but seen") ||
    type.includes("off but seen")
  );
}

function buildScheduleSummary(coverage, flags, schedulesToday, importedCoverage, livePressure) {
  const activeFlags = (Array.isArray(flags) ? flags : []).filter(isActiveScheduleFlag);
  const scheduledButNotSeenFlags = activeFlags.filter((flag) => {
    const type = String(flag["Flag Type"] || flag.flagType || "").toLowerCase();
    return type.includes("coverage validation") ||
      type.includes("scheduled during queue exposure") ||
      type.includes("scheduled but not seen") ||
      type.includes("scheduled not visible");
  }).length;
  const offButSeenFlags = activeFlags.filter((flag) => {
    const type = String(flag["Flag Type"] || flag.flagType || "").toLowerCase();
    return type.includes("schedule mismatch") || type.includes("not scheduled but seen") || type.includes("off but seen");
  }).length;

  const scheduledNow = Math.max(
    getScheduleMetric(coverage, "scheduledNow", "Scheduled Now"),
    safeNumber(importedCoverage?.scheduledNow)
  );
  const seenInQueue = Math.max(
    getScheduleMetric(coverage, "seenInQueue", "Seen In Queue"),
    safeNumber(importedCoverage?.seenInQueue)
  );
  const scheduledButNotSeen = Math.max(
    getScheduleMetric(coverage, "scheduledButNotSeen", "Scheduled But Not Seen"),
    safeNumber(importedCoverage?.scheduledButNotSeen),
    scheduledButNotSeenFlags
  );
  const onBreakLunch = Math.max(
    getScheduleMetric(coverage, "onBreakLunch", "On Break/Lunch"),
    safeNumber(importedCoverage?.onBreakLunch)
  );
  const offButSeen = Math.max(
    getScheduleMetric(coverage, "offButSeen", "Off But Seen"),
    offButSeenFlags
  );
  const missingNameMap = Math.max(
    getScheduleMetric(coverage, "missingNameMap", "Missing Name Map"),
    safeNumber(importedCoverage?.missingNameMap)
  );
  const riskCount = Math.max(activeFlags.length, scheduledButNotSeen + offButSeen);
  const callsOnHold = safeNumber(livePressure?.callsOnHold);
  const agentsAvailable = safeNumber(livePressure?.agentsAvailable);
  const exposedPhoneAgents = importedCoverage?.exposedAgents || [];

  return {
    scheduledNow,
    seenInQueue,
    scheduledButNotSeen,
    onBreakLunch,
    offButSeen,
    missingNameMap,
    riskCount,
    phoneCoverageRisk: callsOnHold > 0 && exposedPhoneAgents.length > 0 ? exposedPhoneAgents.length : riskCount,
    callsOnHold,
    agentsAvailable,
    importedRowsToday: schedulesToday.length,
    flagsToday: activeFlags.length,
    activeFlags,
    shouldBeWorkingAgents: importedCoverage?.shouldBeWorkingAgents || [],
    exposedAgents: exposedPhoneAgents,
    onBreakAgents: importedCoverage?.onBreakAgents || [],
    needsNameMapAgents: importedCoverage?.needsNameMapAgents || [],
    checkedAt: coverage?.checkedAt || coverage?.["Checked At"] || "",
    snapshotId: coverage?.snapshotId || coverage?.["Snapshot ID"] || "",
    vendors: Array.isArray(coverage?.vendors) ? coverage.vendors : [],
  };
}



const CALL_CENTER_CONFIGS = [
  {
    id: "buwelo-colombia",
    label: "Buwelo Colombia",
    shortLabel: "Buwelo-C",
    className: "cc-buwelo-colombia",
    helper: "Buwelo rows with C/Colombia identifiers are grouped here.",
  },
  {
    id: "buwelo-ghana",
    label: "Buwelo Ghana",
    shortLabel: "Buwelo-G",
    className: "cc-buwelo-ghana",
    helper: "Buwelo rows with G/Ghana identifiers are grouped here.",
  },
  {
    id: "telus",
    label: "Telus",
    shortLabel: "Telus",
    className: "cc-telus",
    helper: "Shows Telus schedule, queue, and flag data when imported or seen live.",
  },
  {
    id: "wns",
    label: "WNS",
    shortLabel: "WNS",
    className: "cc-wns",
    helper: "Shows WNS Voice/Nesting coverage once WNS schedule data is connected.",
  },
  {
    id: "tep",
    label: "TEP",
    shortLabel: "TEP",
    className: "cc-tep",
    helper: "Teleperformance schedule rows with real names should show here.",
  },
  {
    id: "concentrix",
    label: "Concentrix",
    shortLabel: "Concentrix",
    className: "cc-concentrix",
    helper: "Shows Concentrix schedule, queue, and flag data when imported or seen live.",
  },
];

function normalizeVendorText(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function recordField(record, names, fallback = "") {
  for (const name of names) {
    const value = record?.[name];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}

function getRecordVendor(record) {
  return recordField(record, ["Vendor", "vendor"], "Unknown");
}

function getRecordAgentId(record) {
  return String(recordField(record, ["Agent ID", "agentId", "agentID", "Ident", "ident"], "")).trim();
}

function getRecordAgentName(record) {
  return recordField(record, ["Agent Name", "agentName", "agent", "Name", "name"], "Unknown Agent");
}

function getRecordCombinedText(record) {
  return normalizeVendorText(
    [
      getRecordVendor(record),
      getRecordAgentId(record),
      getRecordAgentName(record),
      recordField(record, ["Source Sheet", "sourceSheet"], ""),
      recordField(record, ["Schedule Source", "scheduleSource"], ""),
      recordField(record, ["Team Lead", "teamLead"], ""),
      recordField(record, ["LOB", "lob"], ""),
    ].join(" ")
  );
}

function callCenterIdForRecord(record) {
  const vendor = normalizeVendorText(getRecordVendor(record));
  const agentId = getRecordAgentId(record).toUpperCase();
  const text = getRecordCombinedText(record);

  if (vendor.includes("teleperformance") || vendor === "tep" || text.includes(" tep ") || text.startsWith("tep ")) {
    return "tep";
  }
  if (vendor.includes("wns") || text.includes(" wns ") || text.startsWith("wns ")) {
    return "wns";
  }
  if (vendor.includes("telus") || text.includes(" telus ") || text.startsWith("telus ")) {
    return "telus";
  }
  if (vendor.includes("concentrix") || text.includes(" concentrix ") || text.startsWith("concentrix ")) {
    return "concentrix";
  }
  if (vendor.includes("buwelo") || text.includes("buwelo")) {
    if (text.includes("ghana") || text.includes(" buwelo g") || text.includes("buwelo g ") || agentId.startsWith("G")) {
      return "buwelo-ghana";
    }
    if (text.includes("colombia") || text.includes(" buwelo c") || text.includes("buwelo c ") || agentId.startsWith("C")) {
      return "buwelo-colombia";
    }

    // Current Buwelo schedule rows are mostly C-style EDS rows. Until the source distinguishes
    // Ghana vs Colombia, keep unsplit Buwelo rows under Colombia so they are not hidden.
    return "buwelo-colombia";
  }

  return "other";
}

function belongsToCallCenter(record, callCenterId) {
  return callCenterIdForRecord(record) === callCenterId;
}

function getCallCenterStatus(card) {
  if (card.scheduledNotSeen > 0) return "Scheduled not visible";
  if (card.offButSeen > 0) return "Off/leave visible";
  if (card.needsNameMap > 0) return "Mapping needed";
  if (card.scheduledNow > 0 && card.seenInQueue === card.scheduledNow) return "All scheduled visible";
  if (card.totalRecords > 0) return "Rows loaded";
  return "No data yet";
}

function getCallCenterCardTone(card) {
  if (card.scheduledNotSeen > 0) return "has-critical-risk";
  if (card.offButSeen > 0) return "has-medium-risk";
  if (card.needsNameMap > 0) return "has-mapping-risk";
  if (card.totalRecords > 0) return "has-data";
  return "has-no-data";
}

function getFlagType(flag) {
  return String(flag?.["Flag Type"] || flag?.flagType || "");
}

function getFlagRowType(flag) {
  const type = getFlagType(flag).toLowerCase();
  if (type.includes("scheduled but not seen")) return "Scheduled not visible";
  if (type.includes("not scheduled but seen") || type.includes("off but seen")) return "Off/leave but seen";
  return type ? getFlagType(flag) : "Saved schedule flag";
}

function makeCallCenterAgentRow(agent, rowType, evidenceOverride = "") {
  return {
    rowType,
    vendor: agent.vendor || getRecordVendor(agent.source || agent),
    agentName: agent.agentName || getRecordAgentName(agent.source || agent),
    agentId: agent.agentId || getRecordAgentId(agent.source || agent),
    start: agent.start || recordField(agent.source || agent, ["Scheduled Start", "scheduledStart"], ""),
    end: agent.end || recordField(agent.source || agent, ["Scheduled End", "scheduledEnd"], ""),
    status: agent.status || recordField(agent.source || agent, ["Schedule Status", "scheduleStatus"], ""),
    queueVisibility:
      agent.seen === true ? "Visible in queue link" : agent.seen === false ? "Not visible in queue snapshot" : "Cannot check yet",
    matchStatus: agent.matchStatus || recordField(agent.source || agent, ["Name Match Status", "nameMatchStatus"], ""),
    breakWindow: agent.breakWindow || "",
    evidence: evidenceOverride || agent.evidence || "No evidence text saved yet.",
  };
}

function makeCallCenterFlagRow(flag) {
  return {
    rowType: getFlagRowType(flag),
    vendor: flag.Vendor || flag.vendor || "Unknown",
    agentName: flag["Agent Name"] || flag.agentName || "Unknown Agent",
    agentId: flag["Agent ID"] || flag.agentId || "",
    start: flag["Scheduled Start"] || flag.scheduledStart || "",
    end: flag["Scheduled End"] || flag.scheduledEnd || "",
    status: flag["Expected Status"] || flag.expectedStatus || "",
    queueVisibility: flag["Actual Status"] || flag.actualStatus || "",
    matchStatus: flag["Match Quality"] || flag.matchQuality || "",
    breakWindow: flag["Break/Lunch Window"] || flag.breakLunchWindow || "",
    evidence: flag.Evidence || flag.evidence || "No evidence text saved yet.",
  };
}

function buildCallCenterCards({
  shouldBeWorkingAgents,
  seenAgents,
  exposedAgents,
  onBreakAgents,
  needsNameMapAgents,
  visibleFlags,
}) {
  return CALL_CENTER_CONFIGS.map((config) => {
    const shouldRows = shouldBeWorkingAgents.filter((row) => belongsToCallCenter(row.source || row, config.id));
    const seenRows = seenAgents.filter((row) => belongsToCallCenter(row.source || row, config.id));
    const exposedRows = exposedAgents.filter((row) => belongsToCallCenter(row.source || row, config.id));
    const breakRows = onBreakAgents.filter((row) => belongsToCallCenter(row.source || row, config.id));
    const mapRows = needsNameMapAgents.filter((row) => belongsToCallCenter(row.source || row, config.id));
    const flagRows = visibleFlags.filter((row) => belongsToCallCenter(row, config.id));

    const offButSeenRows = flagRows.filter((flag) => {
      const type = getFlagType(flag).toLowerCase();
      return type.includes("schedule mismatch") || type.includes("not scheduled but seen") || type.includes("off but seen");
    });

    const issueCount = exposedRows.length + offButSeenRows.length;
    const blockerCount = mapRows.length;
    const totalRecords = shouldRows.length + breakRows.length + mapRows.length + flagRows.length;

    const detailRows = [
      ...exposedRows.map((row) =>
        makeCallCenterAgentRow(
          row,
          "Scheduled not visible",
          "This agent is scheduled now, not in an imported break/lunch window, and was not found in the live queue snapshot. Validate login/availability with the vendor lead."
        )
      ),
      ...offButSeenRows.map(makeCallCenterFlagRow),
      ...seenRows.map((row) =>
        makeCallCenterAgentRow(row, "Visible in queue link", "This agent is scheduled now and the agent name was found in the live queue snapshot. This confirms queue visibility, not exact availability status.")
      ),
      ...breakRows.map((row) =>
        makeCallCenterAgentRow(row, "On break/lunch", "This agent is inside an imported break/lunch window. Do not treat as missing without validation.")
      ),
      ...mapRows.map((row) =>
        makeCallCenterAgentRow(
          row,
          "Cannot match yet",
          "This schedule row has an ID/code but not an exact queue-matchable agent name. Fill Schedule Name Map before treating this as missing."
        )
      ),
    ];

    return {
      ...config,
      scheduledNow: shouldRows.length,
      seenInQueue: seenRows.length,
      scheduledNotSeen: exposedRows.length,
      onBreakLunch: breakRows.length,
      offButSeen: offButSeenRows.length,
      needsNameMap: blockerCount,
      issueCount,
      blockerCount,
      totalRecords,
      status: getCallCenterStatus({
        scheduledNotSeen: exposedRows.length,
        offButSeen: offButSeenRows.length,
        needsNameMap: blockerCount,
        scheduledNow: shouldRows.length,
        seenInQueue: seenRows.length,
        totalRecords,
      }),
      tone: getCallCenterCardTone({
        scheduledNotSeen: exposedRows.length,
        offButSeen: offButSeenRows.length,
        needsNameMap: blockerCount,
        totalRecords,
      }),
      detailRows,
    };
  });
}

function getCallCenterRowClass(rowType) {
  const type = String(rowType || "").toLowerCase();
  if (type.includes("scheduled not visible") || type.includes("scheduled not seen")) return "severity-high";
  if (type.includes("off") || type.includes("mismatch")) return "severity-medium";
  if (type.includes("name map") || type.includes("cannot")) return "severity-medium";
  if (type.includes("seen")) return "severity-low";
  if (type.includes("break") || type.includes("lunch")) return "severity-neutral";
  return "severity-neutral";
}

function ScheduleExposureModal({ detail, onClose }) {
  if (!detail) return null;

  const rows = Array.isArray(detail.rows) ? detail.rows : [];
  const mode = detail.mode || "agents";

  return (
    <div className="modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="schedule-exposure-modal"
        role="dialog"
        aria-modal="true"
        aria-label={`${detail.title} details`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flagged-modal-header">
          <div>
            <span>{detail.eyebrow || "Schedule coverage"}</span>
            <h2>{detail.title}</h2>
            <p>{detail.subtitle}</p>
          </div>

          <button type="button" className="modal-close-btn" onClick={onClose}>
            <X size={22} />
          </button>
        </div>

        {detail.note ? <div className="schedule-modal-explain-box">{detail.note}</div> : null}

        <div className="schedule-modal-summary-row">
          <div>
            <span>Total records</span>
            <strong>{rows.length}</strong>
          </div>
          <div>
            <span>Purpose</span>
            <strong>{detail.purpose || "Investigation"}</strong>
          </div>
        </div>

        {rows.length === 0 ? (
          <div className="flagged-modal-empty">
            <Eye size={34} />
            <h3>No records found for this card.</h3>
            <p>{detail.emptyText || "There is no saved data behind this schedule card yet."}</p>
          </div>
        ) : mode === "callCenter" ? (
          <div className="table-wrap schedule-modal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Result</th>
                  <th>Vendor</th>
                  <th>Agent</th>
                  <th>Agent ID</th>
                  <th>Scheduled shift</th>
                  <th>Queue visibility</th>
                  <th>Break/Lunch</th>
                  <th>Match</th>
                  <th>Evidence / Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr key={`${row.vendor}-${row.agentId || row.agentName}-${row.rowType}-${index}`}>
                    <td>
                      <span className={`severity-badge ${getCallCenterRowClass(row.rowType)}`}>
                        {formatValue(row.rowType)}
                      </span>
                    </td>
                    <td>{formatValue(row.vendor)}</td>
                    <td className="strong-cell">{formatValue(row.agentName)}</td>
                    <td>{formatValue(row.agentId)}</td>
                    <td>{formatScheduleRange(row.start, row.end)}</td>
                    <td>{formatValue(row.queueVisibility)}</td>
                    <td>{formatValue(row.breakWindow)}</td>
                    <td>{formatValue(row.matchStatus)}</td>
                    <td className="evidence-cell">{formatValue(row.evidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : mode === "nameMap" ? (
          <div className="table-wrap schedule-modal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>EDS / Agent ID</th>
                  <th>Schedule placeholder</th>
                  <th>Scheduled shift</th>
                  <th>Status</th>
                  <th>Match problem</th>
                  <th>What to do</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((agent, index) => (
                  <tr key={`${agent.vendor}-${agent.agentId || agent.agentName}-${index}`}>
                    <td>{formatValue(agent.vendor)}</td>
                    <td className="strong-cell">{formatValue(agent.agentId)}</td>
                    <td>{formatValue(agent.agentName)}</td>
                    <td>{formatScheduleRange(agent.start, agent.end)}</td>
                    <td>{formatValue(agent.status)}</td>
                    <td>
                      <span className="severity-badge severity-medium">Needs Name Map</span>
                    </td>
                    <td className="evidence-cell">{getNameMapInstruction(agent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : mode === "flags" ? (
          <div className="table-wrap schedule-modal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Checked</th>
                  <th>Vendor</th>
                  <th>Agent</th>
                  <th>Agent ID</th>
                  <th>Finding</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Calls / Available</th>
                  <th>Schedule</th>
                  <th>Reason</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((flag, index) => (
                  <tr key={`${flag["Snapshot ID"] || "snapshot"}-${flag["Agent ID"] || index}-${index}`}>
                    <td>{formatSnapshotTime(flag["Checked At"] || flag.checkedAt)}</td>
                    <td>{formatValue(flag.Vendor || flag.vendor)}</td>
                    <td className="strong-cell">{formatValue(flag["Agent Name"] || flag.agentName)}</td>
                    <td>{formatValue(flag["Agent ID"] || flag.agentId)}</td>
                    <td>
                      <span className={`severity-badge ${severityClass(flag.Severity || flag.severity)}`}>
                        {formatValue(flag["Flag Type"] || flag.flagType)}
                      </span>
                    </td>
                    <td>{formatValue(flag["Expected Status"] || flag.expectedStatus)}</td>
                    <td>{formatValue(flag["Actual Status"] || flag.actualStatus)}</td>
                    <td>{formatValue(flag["Calls On Hold"] || flag.callsOnHold, 0)} / {formatValue(flag["Agents Available"] || flag.agentsAvailable, 0)}</td>
                    <td>
                      {formatScheduleRange(
                        flag["Scheduled Start"] || flag.scheduledStart,
                        flag["Scheduled End"] || flag.scheduledEnd
                      )}
                    </td>
                    <td>{formatValue(flag["Watchtower Reason"] || flag.watchtowerReason, "Cannot determine from schedules + queue link")}</td>
                    <td className="evidence-cell">{formatValue(flag.Evidence || flag.evidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="table-wrap schedule-modal-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Agent</th>
                  <th>Agent ID</th>
                  <th>Scheduled shift</th>
                  <th>Schedule status</th>
                  <th>Queue visibility</th>
                  <th>Break/Lunch</th>
                  <th>Match status</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((agent, index) => (
                  <tr key={`${agent.vendor}-${agent.agentId || agent.agentName}-${index}`}>
                    <td>{formatValue(agent.vendor)}</td>
                    <td className="strong-cell">{formatValue(agent.agentName)}</td>
                    <td>{formatValue(agent.agentId)}</td>
                    <td>{formatScheduleRange(agent.start, agent.end)}</td>
                    <td>{formatValue(agent.status)}</td>
                    <td>
                      <span className={`severity-badge ${getQueueVisibilityClass(agent)}`}>
                        {getQueueVisibilityLabel(agent)}
                      </span>
                    </td>
                    <td>{formatValue(agent.breakWindow)}</td>
                    <td>{formatValue(agent.matchStatus)}</td>
                    <td className="evidence-cell">{formatValue(agent.evidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function ScheduleAdherenceSection({ summary, flags }) {
  const [scheduleDetail, setScheduleDetail] = useState(null);

  const visibleFlags = Array.isArray(summary.activeFlags) ? summary.activeFlags.slice(0, 100) : [];
  const exposedAgents = Array.isArray(summary.exposedAgents) ? summary.exposedAgents : [];
  const shouldBeWorkingAgents = Array.isArray(summary.shouldBeWorkingAgents)
    ? summary.shouldBeWorkingAgents
    : [];
  const seenAgents = shouldBeWorkingAgents.filter((agent) => agent.seen);
  const onBreakAgents = Array.isArray(summary.onBreakAgents) ? summary.onBreakAgents : [];
  const needsNameMapAgents = Array.isArray(summary.needsNameMapAgents)
    ? summary.needsNameMapAgents
    : [];

  const queueExposureActive = Number(summary.callsOnHold || 0) > 0;
  const scheduledDuringExposure = queueExposureActive ? shouldBeWorkingAgents : [];
  const visibleDuringExposure = queueExposureActive ? seenAgents : [];
  const notVisibleDuringExposure = queueExposureActive ? exposedAgents : [];

  const scheduledButNotSeenFlags = visibleFlags.filter((flag) => {
    const type = String(flag["Flag Type"] || flag.flagType || "").toLowerCase();
    return type.includes("coverage validation") ||
      type.includes("scheduled during queue exposure") ||
      type.includes("scheduled but not seen") ||
      type.includes("scheduled not visible");
  });

  const offButSeenFlags = visibleFlags.filter((flag) => {
    const type = String(flag["Flag Type"] || flag.flagType || "").toLowerCase();
    return type.includes("schedule mismatch") || type.includes("not scheduled but seen") || type.includes("off but seen");
  });

  const callCenterCards = useMemo(() => {
    return buildCallCenterCards({
      shouldBeWorkingAgents: scheduledDuringExposure,
      seenAgents: visibleDuringExposure,
      exposedAgents: notVisibleDuringExposure,
      onBreakAgents,
      needsNameMapAgents,
      visibleFlags,
    });
  }, [shouldBeWorkingAgents, seenAgents, exposedAgents, onBreakAgents, needsNameMapAgents, visibleFlags]);

  const openAgentModal = (title, subtitle, rows, purpose, emptyText, mode = "agents", note = "") => {
    setScheduleDetail({
      title,
      subtitle,
      rows,
      purpose,
      emptyText,
      mode,
      note,
    });
  };

  const openFlagModal = (title, subtitle, rows, purpose, emptyText) => {
    setScheduleDetail({
      title,
      subtitle,
      rows,
      purpose,
      emptyText,
      mode: "flags",
    });
  };

  return (
    <section className="schedule-adherence-panel phone-exposure-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Agent Utilization</span>
          <h2>Coverage validation from schedules + queue link</h2>
          <p>
            Watchtower keeps this simple: it shows the queue pressure, who was scheduled during that same time,
            and whether their name appeared in the queue link. The tool does not guess why an agent did not answer.
          </p>
          <div className="schedule-meaning-note">
            <strong>Boss-facing meaning:</strong> If calls were waiting, these are the scheduled agents/vendors that need live-status confirmation.
            Reason shown by Watchtower: cannot determine from schedules + queue link. Vendor must confirm available, on call, AUX/not ready, break, lunch, logged out, or assigned to another queue.
          </div>
        </div>
      </div>

      <button
        type="button"
        className="phone-exposure-alert phone-exposure-alert-button"
        onClick={() =>
          openAgentModal(
            "Coverage validation needed",
            "These rows show scheduled agents during a queue exposure moment. The queue link cannot prove the reason, so vendor live-status confirmation is required.",
            notVisibleDuringExposure,
            "Vendor status needed",
            "No current queue exposure validation rows are found. If calls are not waiting right now, this card stays clean."
          )
        }
      >
        <div>
          <span>Current queue exposure</span>
          <strong>{summary.callsOnHold} calls on hold · {summary.agentsAvailable} agents available</strong>
          <p>
            {notVisibleDuringExposure.length > 0
              ? `${notVisibleDuringExposure.length} scheduled agents need vendor status confirmation. Click to review the validation list.`
              : summary.missingNameMap > 0
                ? `${summary.missingNameMap} schedule rows cannot be checked yet because they need ID-to-name mapping. Click Cannot Match Yet to fix the match.`
                : "No current queue exposure validation issue is showing. Click to inspect the backing list."}
          </p>
        </div>
      </button>

      <div className="call-center-coverage-section">
        <div className="story-table-title">
          <h3>Call center utilization validation by vendor</h3>
          <span>Click any card to see who needs status confirmation and what data is missing</span>
        </div>

        <div className="call-center-coverage-grid">
          {callCenterCards.map((card) => (
            <button
              type="button"
              className={`call-center-coverage-card ${card.className} ${card.tone}`}
              key={card.id}
              onClick={() =>
                setScheduleDetail({
                  eyebrow: "Call center coverage",
                  title: `${card.label} — utilization validation`,
                  subtitle:
                    card.totalRecords > 0
                      ? "This popup shows rows behind this vendor card: scheduled during queue exposure, visible/not visible in the queue link, break/lunch rows, schedule mismatches, and mapping blockers."
                      : "No schedule or queue rows are connected to this call center yet.",
                  rows: card.detailRows,
                  purpose: card.status,
                  emptyText:
                    "No imported schedule rows or saved schedule flags were found for this call center. Add/import that call center schedule first, then let Watchtower save a new snapshot.",
                  mode: "callCenter",
                  note:
                    card.needsNameMap > 0
                      ? `${card.needsNameMap} row(s) need name mapping before Watchtower can safely judge them as visible or not visible.`
                      : card.scheduledNotSeen > 0
                        ? `${card.scheduledNotSeen} scheduled agent(s) were not visible in the live queue snapshot. Validate live status before coaching.`
                        : card.totalRecords > 0
                          ? "No scheduled-not-visible exposure is showing from the rows currently loaded for this call center."
                          : card.helper,
                })
              }
            >
              <div className="call-center-card-topline">
                <span>{card.shortLabel}</span>
                <b>{card.status}</b>
              </div>

              <strong className="call-center-card-name">{card.label}</strong>

              <div className="call-center-card-main-number">
                <span>Review Items</span>
                <strong>{card.issueCount}</strong>
              </div>

              <div className="call-center-mini-grid">
                <div>
                  <span>Scheduled</span>
                  <b>{card.scheduledNow}</b>
                </div>
                <div>
                  <span>Visible</span>
                  <b>{card.seenInQueue}</b>
                </div>
                <div>
                  <span>Validate</span>
                  <b>{card.scheduledNotSeen}</b>
                </div>
                <div>
                  <span>Map Needed</span>
                  <b>{card.needsNameMap}</b>
                </div>
              </div>

              <small>Click to see all rows</small>
            </button>
          ))}
        </div>
      </div>

      <div className="schedule-kpi-grid phone-schedule-kpi-grid">
        <button
          type="button"
          className="schedule-kpi-tile"
          onClick={() =>
            openAgentModal(
              "Agents scheduled during current queue check",
              "These agents are inside the scheduled shift window. If calls are waiting, this is the pool to validate with the vendor.",
              shouldBeWorkingAgents,
              "Scheduled coverage pool",
              "No scheduled agents are inside the current shift window. Check Agent Schedules, schedule date, and timezone."
            )
          }
        >
          <span>Scheduled During Check</span>
          <strong>{summary.scheduledNow}</strong>
          <small>Click to expose</small>
        </button>

        <button
          type="button"
          className="schedule-kpi-tile"
          onClick={() =>
            openAgentModal(
              "Scheduled agents visible in queue link",
              "These scheduled agents had their names appear in the queue link. The queue link still does not prove if they were available, busy, or on another call.",
              seenAgents,
              "Visible in queue link",
              "No scheduled agents were visible in the current queue snapshot."
            )
          }
        >
          <span>Visible in Queue Link</span>
          <strong>{summary.seenInQueue}</strong>
          <small>Click to expose</small>
        </button>

        <button
          type="button"
          className={`schedule-kpi-tile ${summary.scheduledButNotSeen > 0 ? "schedule-risk-kpi" : ""}`}
          onClick={() =>
            openAgentModal(
              "Needs vendor status confirmation",
              "These scheduled agents were not visible in the queue link during a queue exposure moment. The reason cannot be proven from schedules + queue link alone.",
              notVisibleDuringExposure,
              "Vendor status needed",
              "No current queue exposure validation rows are found."
            )
          }
        >
          <span>Needs Vendor Status</span>
          <strong>{summary.scheduledButNotSeen}</strong>
          <small>Click to expose</small>
        </button>

        <button
          type="button"
          className="schedule-kpi-tile"
          onClick={() =>
            openAgentModal(
              "Agents inside scheduled break/lunch windows",
              "These agents are scheduled now but currently fall inside imported break/lunch windows, so they should not be treated as missing without validation.",
              onBreakAgents,
              "Protected break/lunch",
              "No imported break/lunch windows are active right now."
            )
          }
        >
          <span>Scheduled Break/Lunch</span>
          <strong>{summary.onBreakLunch}</strong>
          <small>Click to expose</small>
        </button>

        <button
          type="button"
          className={`schedule-kpi-tile ${summary.offButSeen > 0 ? "schedule-risk-kpi" : ""}`}
          onClick={() =>
            openFlagModal(
              "Agents marked off/leave but visible in queue",
              "These saved flags show agents whose imported schedule said Off/Leave, but the queue snapshot showed their name as visible.",
              offButSeenFlags,
              "Off/leave visibility mismatch",
              "No off/leave-but-visible flags are saved for today."
            )
          }
        >
          <span>Off/Leave But Visible</span>
          <strong>{summary.offButSeen}</strong>
          <small>Click to expose</small>
        </button>

        <button
          type="button"
          className={`schedule-kpi-tile ${summary.missingNameMap > 0 ? "schedule-warning-kpi" : ""}`}
          onClick={() =>
            openAgentModal(
              "Schedule rows that cannot be matched yet",
              "These rows are not counted as visible or not visible yet. They must be mapped first because the schedule only shows an ID/code, not the exact agent name from the live queue.",
              needsNameMapAgents,
              "Map schedule IDs to queue names",
              "No schedule rows need name mapping right now.",
              "nameMap",
              "Do not treat these rows as missing yet. Fill the Schedule Name Map tab so Watchtower can compare schedule IDs/codes to the real live queue agent names."
            )
          }
        >
          <span>Cannot Match Yet</span>
          <strong>{summary.missingNameMap}</strong>
          <small>Click to expose</small>
        </button>
      </div>

      {notVisibleDuringExposure.length > 0 ? (
        <div className="phone-exposure-list">
          <div className="story-table-title">
            <h3>Priority list: scheduled during queue exposure — reason needs vendor status</h3>
            <span>{notVisibleDuringExposure.length} agents</span>
          </div>
          <div className="table-wrap schedule-flags-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Agent</th>
                  <th>Agent ID</th>
                  <th>Scheduled</th>
                  <th>Watchtower Finding</th>
                  <th>Reason</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {notVisibleDuringExposure.slice(0, 100).map((agent, index) => (
                  <tr key={`${agent.vendor}-${agent.agentId || agent.agentName}-${index}`}>
                    <td>{formatValue(agent.vendor)}</td>
                    <td className="strong-cell">{formatValue(agent.agentName)}</td>
                    <td>{formatValue(agent.agentId)}</td>
                    <td>{formatScheduleRange(agent.start, agent.end)}</td>
                    <td>
                      <span className="severity-badge severity-high">Needs Vendor Status</span>
                    </td>
                    <td>Cannot determine from schedules + queue link</td>
                    <td className="evidence-cell">{agent.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : shouldBeWorkingAgents.length > 0 ? (
        <div className="phone-exposure-list">
          <div className="story-table-title">
            <h3>Scheduled coverage checked now</h3>
            <span>{shouldBeWorkingAgents.length} scheduled agents checked</span>
          </div>
          <div className="table-wrap schedule-flags-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Vendor</th>
                  <th>Agent</th>
                  <th>Agent ID</th>
                  <th>Scheduled</th>
                  <th>Queue visibility</th>
                </tr>
              </thead>
              <tbody>
                {shouldBeWorkingAgents.slice(0, 60).map((agent, index) => (
                  <tr key={`${agent.vendor}-${agent.agentId || agent.agentName}-${index}`}>
                    <td>{formatValue(agent.vendor)}</td>
                    <td className="strong-cell">{formatValue(agent.agentName)}</td>
                    <td>{formatValue(agent.agentId)}</td>
                    <td>{formatScheduleRange(agent.start, agent.end)}</td>
                    <td>
                      <span className={`severity-badge ${getQueueVisibilityClass(agent)}`}>
                        {getQueueVisibilityLabel(agent)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No scheduled coverage rows found for the current time."
          text="This can happen outside the imported shift windows, or when the schedule date/time does not match the live snapshot. Check Agent Schedules and the current timezone."
        />
      )}

      {visibleFlags.length > 0 ? (
        <div className="phone-exposure-list">
          <div className="story-table-title">
            <h3>All coverage validation rows saved today</h3>
            <span>{visibleFlags.length} flags</span>
          </div>
          <div className="table-wrap schedule-flags-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Checked</th>
                  <th>Vendor</th>
                  <th>Agent</th>
                  <th>Flag</th>
                  <th>Expected</th>
                  <th>Actual</th>
                  <th>Schedule</th>
                  <th>Evidence</th>
                </tr>
              </thead>

              <tbody>
                {visibleFlags.map((flag, index) => (
                  <tr key={`${flag["Snapshot ID"] || "snapshot"}-${flag["Agent ID"] || index}-${index}`}>
                    <td>{formatSnapshotTime(flag["Checked At"] || flag.checkedAt)}</td>
                    <td>{formatValue(flag.Vendor || flag.vendor)}</td>
                    <td className="strong-cell">{formatValue(flag["Agent Name"] || flag.agentName)}</td>
                    <td>
                      <span className={`severity-badge ${severityClass(flag.Severity || flag.severity)}`}>
                        {formatValue(flag["Flag Type"] || flag.flagType)}
                      </span>
                    </td>
                    <td>{formatValue(flag["Expected Status"] || flag.expectedStatus)}</td>
                    <td>{formatValue(flag["Actual Status"] || flag.actualStatus)}</td>
                    <td>
                      {formatScheduleRange(
                        flag["Scheduled Start"] || flag.scheduledStart,
                        flag["Scheduled End"] || flag.scheduledEnd
                      )}
                    </td>
                    <td className="evidence-cell">{formatValue(flag.Evidence || flag.evidence)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <ScheduleExposureModal detail={scheduleDetail} onClose={() => setScheduleDetail(null)} />
    </section>
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
  const [callerExposureModalOpen, setCallerExposureModalOpen] = useState(false);

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
  const scheduleFlagsToday = sheet.scheduleFlagsToday || [];
  const scheduleCoverageLatest = sheet.scheduleCoverageLatest || {};
  const schedulesToday = sheet.schedulesToday || [];
  const callerExposureToday = sheet.callerExposureToday || [];
  const callerExposureSummary = sheet.callerExposureSummary || {};
  const liveRows = live.rows || [];
  const cardsAreLoading = loading || refreshing;
  const liveAgentMetrics = live.agentMetrics || [];

  const importedScheduleCoverage = useMemo(() => {
    return buildScheduleCoverageFromImportedSchedules(
      schedulesToday,
      liveRows,
      liveAgentMetrics,
      new Date()
    );
  }, [schedulesToday, liveRows, liveAgentMetrics]);

  const scheduleSummary = useMemo(() => {
    const callsOnHold =
      safeNumber(live?.summary?.callsOnHold) ||
      safeNumber(latestSnapshot["Calls On Hold"]) ||
      safeNumber(latestSnapshot.callsOnHold);

    const agentsAvailable =
      safeNumber(live?.summary?.agentsAvailable) ||
      safeNumber(latestSnapshot["Agents Available"]) ||
      safeNumber(latestSnapshot.agentsAvailable);

    return buildScheduleSummary(
      scheduleCoverageLatest,
      scheduleFlagsToday,
      schedulesToday,
      importedScheduleCoverage,
      { callsOnHold, agentsAvailable }
    );
  }, [scheduleCoverageLatest, scheduleFlagsToday, schedulesToday, importedScheduleCoverage, live, latestSnapshot]);

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
      scheduleRisk: scheduleSummary.riskCount,
      companyRisk,
    };
  }, [live, latestSnapshot, flaggedAgents.length, unassignedHighRiskRows.length, scheduleSummary.riskCount]);

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
    const scheduleRisk = scheduleSummary.riskCount;

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

    if (scheduleRisk > 0) {
      actions.push(`Review the ${scheduleRisk} schedule-adherence flags before assuming this is an agent QA issue.`);
      leadershipMessage.push(`${scheduleRisk} schedule-adherence risk flags were found from the imported June schedules.`);
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
  }, [summary, snapshotStats, flaggedAgents.length, unassignedHighRiskRows.length, scheduleSummary.riskCount]);

  const agentFlagStory = useMemo(() => {
    return buildAgentFlagStory(dailyCritical, activeWatchlist);
  }, [dailyCritical, activeWatchlist]);

  const coverageNeedStory = useMemo(() => {
    return buildCoverageNeedStory(summary, snapshotStats, vendorMetrics);
  }, [summary, snapshotStats, vendorMetrics]);

  const callbackExposure = useMemo(() => {
    return buildCallbackExposureStory(summary, snapshotStats, todaySnapshots, recentSnapshots);
  }, [summary, snapshotStats, todaySnapshots, recentSnapshots]);

  const callerExposureView = useMemo(() => {
    return buildCallerExposureView(callerExposureToday, callerExposureSummary, liveRows, summary);
  }, [callerExposureToday, callerExposureSummary, liveRows, summary]);

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
      snapshotDate === "—" && snapshotTime === "—"
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


      scheduleRisk: {
        eyebrow: "Schedule visibility",
        title: "Schedule Visibility Review",
        subtitle: "This uses only schedules + the queue link to show who needs vendor status confirmation during queue exposure.",
        valueLabel: "Rows needing validation",
        value: scheduleSummary.phoneCoverageRisk,
        status: scheduleSummary.phoneCoverageRisk > 0 ? "Schedule visibility review needed" : "No schedule visibility issue showing",
        statusClass: scheduleSummary.riskCount > 0 ? "risk-high" : "risk-low",
        meaning:
          scheduleSummary.phoneCoverageRisk > 0
            ? "These are schedule rows where expected coverage does not line up with queue visibility. When customers are waiting, Scheduled Not Visible is the priority validation list."
            : "No scheduled-not-visible coverage issue is showing from the latest imported schedule comparison.",
        evidence: [
          `${scheduleSummary.scheduledNow} agents are scheduled now based on imported schedules.`,
          `${scheduleSummary.seenInQueue} scheduled agents were visible in the queue snapshot.`,
          `${scheduleSummary.scheduledButNotSeen} scheduled agents were not visible in the queue snapshot.`,
          `${scheduleSummary.callsOnHold} calls are currently on hold while ${scheduleSummary.agentsAvailable} agents are available.`,
          `${scheduleSummary.offButSeen} agents marked off/leave were visible in the queue snapshot.`,
          `${scheduleSummary.onBreakLunch} agents are inside scheduled break/lunch windows.`,
          `${scheduleSummary.missingNameMap} schedule rows need name mapping before they can be matched safely.`,
          scheduleSummary.checkedAt
            ? `Last schedule check: ${formatSnapshotTime(scheduleSummary.checkedAt)}.`
            : "No schedule check timestamp loaded yet.",
        ],
        actions:
          scheduleSummary.phoneCoverageRisk > 0
            ? [
                "Open the Scheduled Not Visible list in the Schedule Adherence panel.",
                "Send the vendor/team lead the agent names and ask who is logged in, available, on a call, unavailable, on break/lunch, or not logged in.",
                "When calls are waiting, prioritize scheduled agents not visible before random QA review.",
                "For Buwelo EDS codes, fill the Schedule Name Map tab if the agent name is missing.",
                "Coach only after confirming the live status; use this as the starting point for investigation.",
              ]
            : [
                "Keep schedules imported for June.",
                "Let Watchtower save new snapshots throughout the day.",
                "Keep the Schedule Name Map updated so agent names match the live queue.",
              ],
        footerNote:
          "Best leadership use: this card separates staffing/adherence risk from QA behavior risk so the right vendor issue is addressed.",
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
    scheduleSummary,
    flaggedAgents,
    unassignedHighRiskRows.length,
    dailyCritical.length,
    activeWatchlist.length,
    liveAgentMetrics.length,
    liveRows.length,
    scheduleFlagsToday.length,
    schedulesToday.length,
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
    : `Loaded today's critical agents, average scores, and snapshot evidence from Google Sheets. Last update: ${lastLoaded} | Watchlist: ${activeWatchlist.length} | Daily Critical: ${dailyCritical.length} | Live Metrics: ${liveAgentMetrics.length} | Flagged Agents: ${flaggedAgents.length} | Phone Coverage Risk: ${scheduleSummary.phoneCoverageRisk} | Caller Numbers: ${callerExposureView.uniqueCallers}`}
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
          icon={<PhoneCall size={22} />}
          label="Caller Exposure"
          value={callerExposureView.uniqueCallers}
          sub={`${callerExposureView.callbackRiskCallers} callback-risk callers`}
          danger={callerExposureView.voicemailRiskCallers > 0}
          warning={callerExposureView.callbackRiskCallers > 0}
          onClick={() => setCallerExposureModalOpen(true)}
          tip="Saves caller phone numbers from the queue link so they can later be matched against the Tableau callback report."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
          className="caller-exposure-stat-card"
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

        <StatCard
          icon={<CalendarCheck size={22} />}
          label="Schedule Visibility"
          value={scheduleSummary.phoneCoverageRisk}
          sub="Click for schedule visibility"
          danger={scheduleSummary.callsOnHold > 0 && scheduleSummary.scheduledButNotSeen > 0}
          warning={scheduleSummary.riskCount > 0 || scheduleSummary.missingNameMap > 0}
          onClick={() => setStatDetail(statDetails.scheduleRisk)}
          tip="Uses schedules + queue link only. It identifies who needs vendor live-status confirmation during queue exposure."
          loading={cardsAreLoading}
          countdown={refreshCountdown}
          refreshSeconds={AUTO_REFRESH_SECONDS}
        />

      </section>

      <ScheduleAdherenceSection summary={scheduleSummary} flags={scheduleFlagsToday} />

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
                      {formatValue(agent.Vendor)} · {formatValue(agent["Calls Seen"])} calls
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
                      {formatValue(item.Vendor)} · {formatValue(item["Issue Type"])}
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
        Watchtower · QA & Utilization Intelligence · Automatic monitoring every{" "}
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

      <CallerExposureModal
        open={callerExposureModalOpen}
        onClose={() => setCallerExposureModalOpen(false)}
        data={callerExposureView}
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
