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
  Radio,
  ShieldAlert,
  UserCheck,
  Users,
  Wifi,
} from "lucide-react";
import "./styles.css";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || "http://localhost:8080";

const GOOGLE_SHEET_DATABASE_URL =
  import.meta.env.VITE_GOOGLE_SHEET_DATABASE_URL ||
  "https://docs.google.com/spreadsheets/d/13IxCpTTyUXF-ssFI7PcSbO8xfsauJvkZkOPQcpETJc4/edit?gid=1129431701#gid=1129431701";

const AUTO_REFRESH_SECONDS = Number(import.meta.env.VITE_AUTO_REFRESH_SECONDS || 60);

function safeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function formatValue(value, fallback = "—") {
  if (value === undefined || value === null || value === "") return fallback;
  return value;
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
      ? `Watchtower estimates at least ${agentsNeeded} more agents were needed at this time.`
      : "No additional agent estimate was triggered at this moment.";

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

  const agentName =
    agent["Agent Name"] ||
    agent.agentName ||
    agent.agent ||
    "Unknown Agent";

  const vendor =
    agent.Vendor ||
    agent.vendor ||
    "Unknown";

  const issue =
    agent["Issue Type"] ||
    agent.issueType ||
    "queue risk";

  const score =
    agent["Average Score"] ||
    agent.averageScore ||
    "not available";

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

function InfoTip({ text }) {
  return (
    <span className="info-tip" tabIndex={0}>
      <HelpCircle size={16} />
      <span className="info-bubble">{text}</span>
    </span>
  );
}

function StatCard({ icon, label, value, sub, danger, warning, tip }) {
  return (
    <div className={`stat-card ${danger ? "danger-card" : ""} ${warning ? "warning-card" : ""}`}>
      <div className="stat-top">
        <div className="stat-icon">{icon}</div>
        <InfoTip text={tip} />
      </div>

      <p>{label}</p>
      <h2>{value}</h2>
      <span>{sub}</span>
    </div>
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

function App() {
  const [dashboard, setDashboard] = useState(null);
  const [monitor, setMonitor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastLoaded, setLastLoaded] = useState("");
  const [error, setError] = useState("");

  async function loadDashboard() {
    try {
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
    }
  }

  useEffect(() => {
    loadDashboard();

    const interval = setInterval(() => {
      loadDashboard();
    }, AUTO_REFRESH_SECONDS * 1000);

    return () => clearInterval(interval);
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

    const autoFlagged =
      safeNumber(live?.summary?.autoFlaggedAgents) ||
      safeNumber(latestSnapshot["Auto Flagged Agents"]) ||
      safeNumber(latestSnapshot.autoFlaggedAgents);

    const companyRisk =
      live?.summary?.companyRisk ||
      latestSnapshot["Company Risk Level"] ||
      latestSnapshot.companyRisk ||
      "Unknown";

    return {
      callsOnHold,
      agentsAvailable,
      pastCallback,
      autoFlagged,
      companyRisk,
    };
  }, [live, latestSnapshot]);

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
    const autoFlagged = safeNumber(summary.autoFlagged);

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
      headline = "Critical staffing failure: calls are waiting with 0 agents available.";
      mainProblem = `${callsOnHold} calls are currently on hold, but there are no agents available to take calls.`;
      businessImpact =
        "Customers are waiting without live coverage. This can increase callback volume, repeat contacts, poor customer experience, and escalation pressure.";

      actions.push("Contact vendor/team leads immediately and ask why no agents are available.");
      actions.push("Compare scheduled agents vs agents actually available in the queue.");
      actions.push("Prioritize calls past callback threshold first.");
      actions.push("Check whether agents are logged in but not available, on break, idle, or off-schedule.");
    } else if (callsOnHold >= 25) {
      level = "High";
      headline = "High queue pressure: calls waiting are above safe level.";
      mainProblem = `${callsOnHold} calls are currently on hold.`;
      businessImpact =
        "The queue is building pressure. If staffing does not increase quickly, more calls may hit callback risk.";

      actions.push("Ask vendors to increase available agents now.");
      actions.push("Watch callback threshold closely.");
      actions.push("Review whether breaks/lunches are overlapping during peak volume.");
    }

    if (pastCallback > 0) {
      if (level !== "Critical") level = "High";

      actions.push(`Pull and review the ${pastCallback} calls past callback threshold first.`);
      leadershipMessage.push(`${pastCallback} calls are already past callback threshold.`);
    }

    if (autoFlagged > 0) {
      actions.push(`Review the ${autoFlagged} auto-flagged agents before random QA sampling.`);
      leadershipMessage.push(`${autoFlagged} agents were auto-flagged for coaching review.`);
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
  }, [summary, snapshotStats]);

  const agentFlagStory = useMemo(() => {
    return buildAgentFlagStory(dailyCritical, watchlist);
  }, [dailyCritical, watchlist]);

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

      <div className="sheet-load-banner">
        {loading
          ? "Loading Watchtower data from Google Sheets and live queue..."
          : `Loaded today’s critical agents, average scores, and snapshot evidence from Google Sheets. Last update: ${lastLoaded}`}
      </div>

      <section className="stats-grid">
        <StatCard
          icon={<Users size={22} />}
          label="Calls On Hold"
          value={summary.callsOnHold}
          sub="Live queue pressure"
          danger={summary.callsOnHold >= 25}
          tip="Shows how many customers are waiting. High volume means staffing, scheduling, or availability may need attention."
        />

        <StatCard
          icon={<UserCheck size={22} />}
          label="Agents Available"
          value={summary.agentsAvailable}
          sub={summary.agentsAvailable === 0 ? "0 available is critical" : "Available to take calls"}
          danger={summary.agentsAvailable === 0 && summary.callsOnHold > 0}
          tip="Shows whether agents are available while calls are waiting. 0 available with calls on hold is a major coverage gap."
        />

        <StatCard
          icon={<Clock size={22} />}
          label="Past Callback"
          value={summary.pastCallback}
          sub="500+ seconds"
          warning={summary.pastCallback > 0}
          tip="Calls over 500 seconds are at callback-risk. These are priority calls for operational review."
        />

        <StatCard
          icon={<ShieldAlert size={22} />}
          label="Auto-Flag Agents"
          value={summary.autoFlagged}
          sub="High/Critical daily watch"
          warning={summary.autoFlagged > 0}
          tip="Agents are automatically saved when score, duration, callback risk, or queue risk meets high/critical rules."
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
              Watchtower converts every snapshot into a readable operations story: time, queue pressure,
              callback risk, staffing need, and coaching priority.
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
            <span>What to fix first</span>
            <h3>Immediate actions</h3>

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

          {watchlist.length === 0 ? (
            <EmptyState
              title="No active watchlist items."
              text="Agents will appear here when the system auto-saves or when you add them manually."
            />
          ) : (
            <div className="watchlist-stack">
              {watchlist.slice(0, 8).map((item, index) => (
                <div className="watch-card" key={`${item.ID}-${index}`}>
                  <div>
                    <strong>{formatValue(item["Agent Name"])}</strong>
                    <span>
                      {formatValue(item.Vendor)} · {formatValue(item["Issue Type"])}
                    </span>
                  </div>

                  <span className={`severity-badge ${severityClass(item.Severity)}`}>
                    {formatValue(item.Severity)}
                  </span>
                </div>
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
            <p>Shows agents with low average scores, long call exposure, callback risk, or repeated daily flags.</p>
          </div>

          <div>
            <strong>Queue Failure</strong>
            <p>Exposes when calls are waiting while no agents are available, which creates customer experience risk.</p>
          </div>

          <div>
            <strong>Vendor Coverage</strong>
            <p>Highlights whether WNS, TEP, Buwelo, Concentrix, Telus, or other vendors are creating coverage gaps.</p>
          </div>

          <div>
            <strong>Coaching Priority</strong>
            <p>Creates a daily list of agents to review first so QA work is targeted and evidence-based.</p>
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
                      {Array.isArray(row.reasons) ? row.reasons.join(" | ") : formatValue(row.reasons)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <footer className="footer">
        Watchtower · QA & Utilization Intelligence · Automatic monitoring every {AUTO_REFRESH_SECONDS} seconds
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);