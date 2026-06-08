import "dotenv/config";
import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";

const app = express();

const PORT = Number(process.env.PORT || 8080);

const HP_QUEUE_URL =
  process.env.HP_QUEUE_URL ||
  "https://www.hotelplanner.com/common/schedtasks/ProcessSupportCallQueue.htm?readOnly=1";

const HP_COOKIE = process.env.HP_COOKIE || "";
const GOOGLE_SCRIPT_URL = process.env.GOOGLE_SCRIPT_URL || "";

const POLL_INTERVAL_SECONDS = Number(process.env.POLL_INTERVAL_SECONDS || 60);

const AUTO_MONITOR_ENABLED =
  String(process.env.AUTO_MONITOR_ENABLED || "true").toLowerCase() === "true";

const CALLBACK_AFTER_SECONDS = Number(process.env.CALLBACK_AFTER_SECONDS || 500);
const VOICEMAIL_AFTER_SECONDS = Number(process.env.VOICEMAIL_AFTER_SECONDS || 1500);

const MIN_SCORE_CRITICAL = Number(
  process.env.MIN_SCORE_CRITICAL ||
    process.env.CRITICAL_SCORE_THRESHOLD ||
    15
);

const MIN_SCORE_HIGH = Number(
  process.env.MIN_SCORE_HIGH ||
    process.env.HIGH_SCORE_THRESHOLD ||
    25
);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

// Hotfix: the old code aborted Google dashboard reads after exactly 12s.
// Keep the live HotelPlanner fetch tight, but allow Sheets a little more time
// and cache the last good dashboard so the React app still opens.
const HP_QUEUE_TIMEOUT_MS = Number(process.env.HP_QUEUE_TIMEOUT_MS || 12000);
const GOOGLE_DASHBOARD_TIMEOUT_MS = Number(
  process.env.GOOGLE_DASHBOARD_TIMEOUT_MS || 30000
);
const GOOGLE_POST_TIMEOUT_MS = Number(process.env.GOOGLE_POST_TIMEOUT_MS || 60000);
const SHEET_DASHBOARD_CACHE_MS = Number(process.env.SHEET_DASHBOARD_CACHE_MS || 60000);

app.use(
  cors({
    origin:
      CORS_ORIGIN === "*"
        ? true
        : CORS_ORIGIN.split(",").map((x) => x.trim()),
  })
);

app.use(express.json({ limit: "10mb" }));

let monitorTimer = null;
let lastMonitorRun = null;
let lastMonitorResult = null;
let lastLiveQueue = null;
let monitorRunCount = 0;
let monitorErrors = [];
let lastSheetDashboard = null;
let lastSheetDashboardAt = 0;

function nowIso() {
  return new Date().toISOString();
}

function cleanText(value = "") {
  return String(value).replace(/\s+/g, " ").trim();
}

function secondsToClock(seconds = 0) {
  const value = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(value / 3600);
  const m = Math.floor((value % 3600) / 60);
  const s = value % 60;

  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  return `${m}:${String(s).padStart(2, "0")}`;
}

function durationFromText(text = "") {
  const t = cleanText(text);

  if (!t) return 0;

  if (/^\d+$/.test(t)) return Number(t);

  const clock = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);

  if (clock) {
    if (clock[3] !== undefined) {
      return Number(clock[1]) * 3600 + Number(clock[2]) * 60 + Number(clock[3]);
    }

    return Number(clock[1]) * 60 + Number(clock[2]);
  }

  const hms = t.match(/(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i);

  if (hms && (hms[1] || hms[2] || hms[3])) {
    return (
      Number(hms[1] || 0) * 3600 +
      Number(hms[2] || 0) * 60 +
      Number(hms[3] || 0)
    );
  }

  const seconds = t.match(/(\d+)\s*(?:sec|second|seconds|s)\b/i);
  if (seconds) return Number(seconds[1]);

  const minutes = t.match(/(\d+)\s*(?:min|minute|minutes|m)\b/i);
  if (minutes) return Number(minutes[1]) * 60;

  return 0;
}

function normalizeVendor(text = "") {
  const t = String(text).toLowerCase();

  if (t.includes("wns")) return "WNS";
  if (t.includes("tep") || t.includes("teleperformance")) return "TEP";
  if (t.includes("concentrix") || /\bcon\b/.test(t)) return "Concentrix";
  if (t.includes("buwelo-c")) return "Buwelo-C";
  if (t.includes("buwelo-g")) return "Buwelo-G";
  if (t.includes("buw") || t.includes("buwelo")) return "Buwelo-G";
  if (t.includes("telus")) return "Telus";

  return "Unknown";
}

function extractAgentName(text = "") {
  const source = cleanText(text);

  const patterns = [
    /call\s+assigned\s+to\s+([A-Za-zÀ-ÿ' .-]{2,100})\s*\((?:Wns|WNS|Buw|BUW|Buwelo|Con|CON|Tep|TEP|Telus|TELUS)\)/i,
    /assigned\s+to\s+([A-Za-zÀ-ÿ' .-]{2,100})\s*\((?:Wns|WNS|Buw|BUW|Buwelo|Con|CON|Tep|TEP|Telus|TELUS)\)/i,
    /call\s+assigned\s+to\s+([A-Za-zÀ-ÿ' .-]{2,100})(?=\s+\(|\s+account_id|\s+support_id|\s+\||$)/i,
    /assigned\s+to\s+([A-Za-zÀ-ÿ' .-]{2,100})(?=\s+\(|\s+account_id|\s+support_id|\s+\||$)/i,
    /connectAgent\s+([A-Za-zÀ-ÿ' .-]{2,100})(?=\s+(?:Wns|WNS|Tep|TEP|Teleperformance|Con|Concentrix|Buw|Buwelo|Telus|support|call|$))/i,
    /agent\s*[:#-]?\s*([A-Za-zÀ-ÿ' .-]{2,100})(?=\s+(?:Wns|WNS|Tep|TEP|Teleperformance|Con|Concentrix|Buw|Buwelo|Telus|support|call|$))/i,
  ];

  for (const pattern of patterns) {
    const match = source.match(pattern);

    if (match?.[1]) {
      const name = cleanText(match[1])
        .replace(/\s*\(.*?\)\s*/g, "")
        .replace(/\baccount_id\b.*$/i, "")
        .replace(/\bsupport_id\b.*$/i, "")
        .replace(/[|,;:-]+$/g, "")
        .trim();

      if (
        name &&
        !/^(call|assigned|agent|notes|caller|score|duration|last action)$/i.test(name)
      ) {
        return name;
      }
    }
  }

  return "";
}

function isHeaderLikeRow(joined = "") {
  const t = cleanText(joined).toLowerCase();

  if (!t) return true;

  const headerSignals = [
    "call id",
    "duration",
    "score",
    "caller | notes",
    "last action",
    "called | caller",
  ];

  const signalCount = headerSignals.filter((signal) => t.includes(signal)).length;

  return signalCount >= 2;
}

function scoreRisk(score) {
  const n = Number(score) || 0;

  if (n > 0 && n <= MIN_SCORE_CRITICAL) return "Critical";
  if (n > 0 && n <= MIN_SCORE_HIGH) return "High";

  return "";
}

function analyzeRow(row) {
  const reasons = [];
  let severity = "Low";

  const duration = Number(row.durationSeconds) || 0;
  const score = Number(row.score) || 0;
  const text = `${row.notes || ""} ${row.lastAction || ""}`.toLowerCase();

  if (duration >= VOICEMAIL_AFTER_SECONDS) {
    severity = "Critical";
    reasons.push(`Past voicemail threshold: ${secondsToClock(duration)} waiting/active`);
  } else if (duration >= CALLBACK_AFTER_SECONDS) {
    severity = severity === "Critical" ? severity : "High";
    reasons.push(`Past callback threshold: ${secondsToClock(duration)} waiting/active`);
  }

  const sRisk = scoreRisk(score);

  if (sRisk === "Critical") {
    severity = "Critical";
    reasons.push(`Very low link score: ${score}`);
  } else if (sRisk === "High" && severity !== "Critical") {
    severity = "High";
    reasons.push(`Low link score: ${score}`);
  }

  if (!row.agent && (text.includes("waitingqueue") || text.includes("callbackprompt"))) {
    if (severity !== "Critical") severity = "High";
    reasons.push("No assigned agent shown while call is waiting/risking callback");
  }

  if (text.includes("callbackprompt")) {
    if (severity !== "Critical") severity = "High";
    reasons.push("Call was sent to callback prompt");
  }

  if (text.includes("waitingqueue")) {
    reasons.push("Still in waiting queue");
  }

  if (severity === "Low" && duration >= 300) {
    severity = "Medium";
  }

  if (!reasons.length) {
    reasons.push("Normal monitoring");
  }

  return {
    ...row,
    severity,
    reasons,
    durationLabel: row.durationLabel || secondsToClock(duration),
    riskScore:
      severity === "Critical"
        ? 100
        : severity === "High"
        ? 75
        : severity === "Medium"
        ? 45
        : 15,
  };
}

function buildAgentMetrics(rows = []) {
  const map = new Map();

  rows
    .filter((r) => r.agent)
    .forEach((row) => {
      const key = `${row.agent}__${row.vendor || "Unknown"}`;

      const current =
        map.get(key) || {
          agent: row.agent,
          vendor: row.vendor || "Unknown",
          callsSeen: 0,
          scoredCalls: 0,
          scoreTotal: 0,
          avgScore: 0,
          lowestScore: 999,
          highestScore: 0,
          maxDurationSeconds: 0,
          callbackRiskCalls: 0,
          criticalFlags: 0,
          highFlags: 0,
          lastCallId: "",
          watchOut: [],
          severity: "Low",
        };

      const score = Number(row.score) || 0;
      const duration = Number(row.durationSeconds) || 0;

      current.callsSeen += 1;

      if (score > 0) {
        current.scoredCalls += 1;
        current.scoreTotal += score;
        current.avgScore = Number((current.scoreTotal / current.scoredCalls).toFixed(2));
        current.lowestScore = Math.min(current.lowestScore, score);
        current.highestScore = Math.max(current.highestScore, score);
      }

      current.maxDurationSeconds = Math.max(current.maxDurationSeconds, duration);

      if (duration >= CALLBACK_AFTER_SECONDS) {
        current.callbackRiskCalls += 1;
      }

      if (row.severity === "Critical") current.criticalFlags += 1;
      if (row.severity === "High") current.highFlags += 1;

      current.lastCallId = row.callId || current.lastCallId;

      current.watchOut = Array.from(
        new Set([...current.watchOut, ...(row.reasons || [])])
      ).slice(0, 6);

      if (
        current.criticalFlags > 0 ||
        (current.avgScore > 0 && current.avgScore <= MIN_SCORE_CRITICAL)
      ) {
        current.severity = "Critical";
      } else if (
        current.highFlags > 0 ||
        current.callbackRiskCalls > 0 ||
        (current.avgScore > 0 && current.avgScore <= MIN_SCORE_HIGH)
      ) {
        current.severity = "High";
      } else if (current.maxDurationSeconds >= 300) {
        current.severity = "Medium";
      }

      if (current.lowestScore === 999) {
        current.lowestScore = 0;
      }

      map.set(key, current);
    });

  return [...map.values()].sort(
    (a, b) =>
      b.criticalFlags - a.criticalFlags ||
      b.highFlags - a.highFlags ||
      a.avgScore - b.avgScore
  );
}

function buildVendorMetrics(rows = []) {
  const vendorMap = new Map();

  rows.forEach((row) => {
    const vendorName = row.vendor || "Unknown";

    const vendor =
      vendorMap.get(vendorName) || {
        vendor: vendorName,
        callsSeen: 0,
        agentsSeen: new Set(),
        criticalFlags: 0,
        highFlags: 0,
        avgScore: 0,
        scoredCalls: 0,
        scoreTotal: 0,
        maxDurationSeconds: 0,
      };

    const score = Number(row.score) || 0;

    vendor.callsSeen += 1;

    if (row.agent) vendor.agentsSeen.add(row.agent);

    if (row.severity === "Critical") vendor.criticalFlags += 1;
    if (row.severity === "High") vendor.highFlags += 1;

    if (score > 0) {
      vendor.scoredCalls += 1;
      vendor.scoreTotal += score;
      vendor.avgScore = Number((vendor.scoreTotal / vendor.scoredCalls).toFixed(2));
    }

    vendor.maxDurationSeconds = Math.max(
      vendor.maxDurationSeconds,
      Number(row.durationSeconds) || 0
    );

    vendorMap.set(vendorName, vendor);
  });

  return [...vendorMap.values()]
    .map((vendor) => ({
      ...vendor,
      agentsSeen: vendor.agentsSeen.size,
    }))
    .sort((a, b) => b.criticalFlags - a.criticalFlags || b.highFlags - a.highFlags);
}

function analyzeQueue(queue) {
  const rows = (queue.rows || []).map(analyzeRow);
  const agentMetrics = buildAgentMetrics(rows);
  const vendorMetrics = buildVendorMetrics(rows);

  const pastCallback = rows.filter(
    (r) => Number(r.durationSeconds) >= CALLBACK_AFTER_SECONDS
  ).length;

  const pastVoicemail = rows.filter(
    (r) => Number(r.durationSeconds) >= VOICEMAIL_AFTER_SECONDS
  ).length;

  const criticalCount = rows.filter((r) => r.severity === "Critical").length;
  const highCount = rows.filter((r) => r.severity === "High").length;

  const callsOnHold = Number(queue.callsOnHold) || 0;
  const agentsAvailable = Number(queue.agentsAvailable) || 0;

  let companyRisk = "Low";
  const companyReasons = [];

  if (agentsAvailable === 0 && callsOnHold > 0) {
    companyRisk = "Critical";
    companyReasons.push(`${callsOnHold} calls on hold with 0 agents available`);
  }

  if (pastVoicemail > 0) {
    companyRisk = "Critical";
    companyReasons.push(`${pastVoicemail} calls past voicemail threshold`);
  }

  if (
    companyRisk !== "Critical" &&
    (pastCallback > 0 || criticalCount > 0 || callsOnHold >= 25)
  ) {
    companyRisk = "High";
  }

  if (pastCallback > 0) {
    companyReasons.push(`${pastCallback} calls past callback threshold`);
  }

  if (criticalCount > 0) {
    companyReasons.push(`${criticalCount} critical call-level flags`);
  }

  if (highCount > 0) {
    companyReasons.push(`${highCount} high call-level flags`);
  }

  if (companyRisk === "Low" && (highCount > 0 || callsOnHold >= 10)) {
    companyRisk = "Medium";
  }

  return {
    ...queue,
    capturedAt: queue.capturedAt || nowIso(),
    callbackAfterSeconds: CALLBACK_AFTER_SECONDS,
    voicemailAfterSeconds: VOICEMAIL_AFTER_SECONDS,
    rows,
    agentMetrics,
    vendorMetrics,
    summary: {
      callsOnHold,
      agentsAvailable,
      rowsCount: rows.length,
      pastCallback,
      pastVoicemail,
      criticalCount,
      highCount,
      companyRisk,
      companyReasons,
      autoFlaggedAgents: agentMetrics.filter((a) =>
        ["Critical", "High"].includes(a.severity)
      ).length,
    },
  };
}

function parseQueueHtml(html) {
  const $ = cheerio.load(html || "");
  const bodyText = cleanText($("body").text());

  const callsOnHold = Number(
    (bodyText.match(/Customer Service Calls on Hold:\s*(\d+)/i) || [])[1] || 0
  );

  const agentsAvailable = Number(
    (bodyText.match(/Agents Available To Take Call:\s*(\d+)/i) || [])[1] || 0
  );

  const callbackAfterSeconds = Number(
    (bodyText.match(/Call Back Prompt After:\s*(\d+)/i) || [])[1] ||
      CALLBACK_AFTER_SECONDS
  );

  const voicemailAfterSeconds = Number(
    (bodyText.match(/Voicemail After:\s*(\d+)/i) || [])[1] ||
      VOICEMAIL_AFTER_SECONDS
  );

  const rows = [];

  $("tr").each((_, tr) => {
    const cells = $(tr)
      .find("td")
      .map((__, td) => cleanText($(td).text()))
      .get();

    if (cells.length < 5) return;

    const joined = cleanText(cells.join(" | "));

    if (isHeaderLikeRow(joined)) return;

    const numericCells = cells
      .map((c) => Number(c))
      .filter((n) => Number.isFinite(n));

    const durationCell =
      cells.find((c, idx) => idx > 0 && durationFromText(c) > 0) || "0";

    const durationSeconds =
      durationFromText(durationCell) || Number(numericCells[0] || 0);

    const score = Number(cells[2]) || Number(numericCells[1] || 0);

    const notes = cells.slice(5, -1).join(" | ") || joined;
    const agent = extractAgentName(notes) || extractAgentName(joined);
    const vendor = normalizeVendor(notes) || normalizeVendor(joined);

    rows.push({
      callId: cells[0] || `row-${rows.length + 1}`,
      durationSeconds,
      durationLabel: secondsToClock(durationSeconds),
      score,
      called: cells[3] || "",
      caller: cells[4] || "",
      notes,
      lastAction: cells[cells.length - 1] || "",
      agent,
      vendor,
    });
  });

  return analyzeQueue({
    source: "server-live-fetch",
    capturedAt: nowIso(),
    callsOnHold,
    agentsAvailable,
    callbackAfterSeconds,
    voicemailAfterSeconds,
    rows,
  });
}

async function readResponseOnceAsJson(response) {
  const raw = await response.text();

  try {
    return raw ? JSON.parse(raw) : { ok: false, error: "Empty response." };
  } catch {
    const preview = raw.slice(0, 500).replace(/\s+/g, " ").trim();

    throw new Error(
      `Expected JSON but received something else. Status ${response.status}. Preview: ${preview}`
    );
  }
}

async function fetchQueue() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HP_QUEUE_TIMEOUT_MS);

  try {
    const response = await fetch(HP_QUEUE_URL, {
      signal: controller.signal,
      headers: {
        "User-Agent": "HotelPlanner-Watchtower/3.0",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        ...(HP_COOKIE ? { Cookie: HP_COOKIE } : {}),
      },
    });

    const html = await response.text();

    if (!response.ok) {
      throw new Error(`HotelPlanner returned ${response.status}: ${html.slice(0, 180)}`);
    }

    if (/login|password|sign in/i.test(html) && !/Customer Service Calls on Hold/i.test(html)) {
      throw new Error(
        "HotelPlanner page appears to require a valid login/session cookie. Add HP_COOKIE in Render environment variables."
      );
    }

    const queue = parseQueueHtml(html);
    lastLiveQueue = queue;

    return queue;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`HotelPlanner queue fetch timed out after ${Math.round(HP_QUEUE_TIMEOUT_MS / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function googleScriptGet(action) {
  if (!GOOGLE_SCRIPT_URL) {
    throw new Error("GOOGLE_SCRIPT_URL is missing in server environment variables.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_DASHBOARD_TIMEOUT_MS);

  try {
    const url = new URL(GOOGLE_SCRIPT_URL);
    url.searchParams.set("action", action);
    url.searchParams.set("cacheBust", Date.now().toString());

    const response = await fetch(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    const data = await readResponseOnceAsJson(response);

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Google Apps Script GET failed: ${response.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Google Apps Script dashboard fetch timed out after ${Math.round(GOOGLE_DASHBOARD_TIMEOUT_MS / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function postToGoogleScript(action, payload) {
  if (!GOOGLE_SCRIPT_URL) {
    throw new Error("GOOGLE_SCRIPT_URL is missing in server environment variables.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GOOGLE_POST_TIMEOUT_MS);

  try {
    const response = await fetch(GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        action,
        payload,
      }),
      redirect: "follow",
      signal: controller.signal,
    });

    const data = await readResponseOnceAsJson(response);

    if (!response.ok || data.ok === false) {
      throw new Error(data.error || `Google Script returned ${response.status}`);
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error(`Google Apps Script POST timed out after ${Math.round(GOOGLE_POST_TIMEOUT_MS / 1000)} seconds.`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function buildLimitedQueueForSheet(queue, reason) {
  const limitedQueueForSheet = {
    ...queue,
    monitorReason: reason,
    rows: Array.isArray(queue.rows) ? queue.rows.slice(0, 80) : [],
    agentMetrics: Array.isArray(queue.agentMetrics) ? queue.agentMetrics.slice(0, 80) : [],
    vendorMetrics: Array.isArray(queue.vendorMetrics) ? queue.vendorMetrics : [],
  };

  limitedQueueForSheet.rows = limitedQueueForSheet.rows.map((row) => ({
    callId: row.callId || "",
    durationSeconds: Number(row.durationSeconds || 0),
    durationLabel: row.durationLabel || "",
    score: Number(row.score || 0),
    called: row.called || "",
    caller: row.caller || "",
    agent: row.agent || "",
    vendor: row.vendor || "Unknown",
    lastAction: row.lastAction || "",
    severity: row.severity || "Low",
    reasons: Array.isArray(row.reasons) ? row.reasons.slice(0, 4) : [],
    notes: String(row.notes || "").slice(0, 300),
  }));

  limitedQueueForSheet.agentMetrics = limitedQueueForSheet.agentMetrics.map((agent) => ({
    agent: agent.agent || "",
    vendor: agent.vendor || "Unknown",
    callsSeen: Number(agent.callsSeen || 0),
    scoredCalls: Number(agent.scoredCalls || 0),
    avgScore: Number(agent.avgScore || 0),
    lowestScore: Number(agent.lowestScore || 0),
    highestScore: Number(agent.highestScore || 0),
    maxDurationSeconds: Number(agent.maxDurationSeconds || 0),
    callbackRiskCalls: Number(agent.callbackRiskCalls || 0),
    criticalFlags: Number(agent.criticalFlags || 0),
    highFlags: Number(agent.highFlags || 0),
    lastCallId: agent.lastCallId || "",
    watchOut: Array.isArray(agent.watchOut) ? agent.watchOut.slice(0, 6) : [],
    severity: agent.severity || "Low",
  }));

  return limitedQueueForSheet;
}

async function runMonitorOnce(reason = "scheduled") {
  const startedAt = nowIso();

  try {
    const queue = await fetchQueue();

    const limitedQueueForSheet = buildLimitedQueueForSheet(queue, reason);

    const sheetResult = GOOGLE_SCRIPT_URL
      ? await postToGoogleScript("saveQueueSnapshot", limitedQueueForSheet)
      : {
          skipped: true,
          reason: "No GOOGLE_SCRIPT_URL configured",
        };

    lastMonitorRun = nowIso();
    monitorRunCount += 1;

    lastMonitorResult = {
      ok: true,
      startedAt,
      finishedAt: lastMonitorRun,
      reason,
      queueSummary: queue.summary,
      savedRows: limitedQueueForSheet.rows.length,
      savedAgentMetrics: limitedQueueForSheet.agentMetrics.length,
      sheetResult,
    };

    return {
      ok: true,
      queue,
      sheetResult,
    };
  } catch (error) {
    lastMonitorRun = nowIso();

    const err = {
      at: lastMonitorRun,
      reason,
      error: error.message,
    };

    monitorErrors = [err, ...monitorErrors].slice(0, 10);

    lastMonitorResult = {
      ok: false,
      startedAt,
      finishedAt: lastMonitorRun,
      error: error.message,
    };

    throw error;
  }
}

function startMonitor() {
  if (monitorTimer) return;

  monitorTimer = setInterval(() => {
    runMonitorOnce("scheduled").catch((err) => {
      console.error("Scheduled monitor failed:", err.message);
    });
  }, Math.max(15, POLL_INTERVAL_SECONDS) * 1000);
}

function stopMonitor() {
  if (monitorTimer) {
    clearInterval(monitorTimer);
  }

  monitorTimer = null;
}

function getMonitorStatus() {
  return {
    ok: true,
    monitoring: Boolean(monitorTimer),
    autoMonitorEnabled: AUTO_MONITOR_ENABLED,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
    lastMonitorRun,
    lastMonitorResult,
    monitorRunCount,
    monitorErrors,
    hasGoogleScriptUrl: Boolean(GOOGLE_SCRIPT_URL),
    hasHotelPlannerCookie: Boolean(HP_COOKIE),
  };
}

function buildEmptyLiveQueue(errorMessage = "") {
  return {
    source: "live-queue-unavailable",
    capturedAt: nowIso(),
    callsOnHold: 0,
    agentsAvailable: 0,
    rows: [],
    agentMetrics: [],
    vendorMetrics: [],
    summary: {
      callsOnHold: 0,
      agentsAvailable: 0,
      rowsCount: 0,
      pastCallback: 0,
      pastVoicemail: 0,
      criticalCount: 0,
      highCount: 0,
      autoFlaggedAgents: 0,
      companyRisk: "Unknown",
      companyReasons: errorMessage ? [errorMessage] : [],
    },
  };
}

app.get("/", (_, res) => {
  res.json({
    ok: true,
    app: "HotelPlanner Watchtower Server",
    monitoring: Boolean(monitorTimer),
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
  });
});

app.get("/api/health", (_, res) => {
  res.json({
    ok: true,
    service: "HotelPlanner Watchtower Server",
    at: nowIso(),
    autoMonitorEnabled: AUTO_MONITOR_ENABLED,
    monitoring: Boolean(monitorTimer),
  });
});

app.get("/api/monitor-status", (_, res) => {
  res.json(getMonitorStatus());
});

app.get("/api/monitor/status", (_, res) => {
  res.json(getMonitorStatus());
});

app.post("/api/monitor/start", (_, res) => {
  startMonitor();

  res.json({
    ok: true,
    monitoring: true,
    pollIntervalSeconds: POLL_INTERVAL_SECONDS,
  });
});

app.post("/api/monitor/stop", (_, res) => {
  stopMonitor();

  res.json({
    ok: true,
    monitoring: false,
  });
});

app.post("/api/monitor/run-now", async (_, res) => {
  try {
    const result = await runMonitorOnce("manual-run-now");
    res.json(result);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.get("/api/queue", async (_, res) => {
  try {
    const queue = await fetchQueue();

    res.json({
      ok: true,
      queue,
      liveQueue: queue,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      lastLiveQueue,
    });
  }
});

app.get("/api/live-queue", async (_, res) => {
  try {
    const queue = await fetchQueue();

    res.json({
      ok: true,
      queue,
      liveQueue: queue,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
      lastLiveQueue,
    });
  }
});

app.get("/api/dashboard", async (_, res) => {
  const emptySheetDashboard = {
    latestSnapshot: null,
    recentSnapshots: [],
    todaySnapshots: [],
    watchlist: [],
    dailyCritical: [],
    scoreAverages: [],
    vendorMetrics: [],
  };

  const livePromise = fetchQueue()
    .then((queue) => ({ ok: true, queue }))
    .catch((error) => ({ ok: false, error }));

  const shouldUseCachedSheet =
    lastSheetDashboard && Date.now() - lastSheetDashboardAt < SHEET_DASHBOARD_CACHE_MS;

  const sheetPromise = shouldUseCachedSheet
    ? Promise.resolve({ ok: true, dashboard: lastSheetDashboard, cached: true })
    : GOOGLE_SCRIPT_URL
    ? googleScriptGet("dashboard")
        .then((data) => ({
          ok: true,
          dashboard: data.dashboard || data.sheetDashboard || emptySheetDashboard,
          cached: false,
        }))
        .catch((error) => ({ ok: false, error }))
    : Promise.resolve({
        ok: false,
        error: new Error("Missing GOOGLE_SCRIPT_URL in server environment variables."),
      });

  const [liveResult, sheetResult] = await Promise.all([livePromise, sheetPromise]);

  let liveQueue = lastLiveQueue;
  if (liveResult.ok) {
    liveQueue = liveResult.queue;
  } else {
    console.error("Live queue fetch failed:", liveResult.error.message);
    liveQueue = liveQueue
      ? { ...liveQueue, warning: liveResult.error.message }
      : buildEmptyLiveQueue(liveResult.error.message);
  }

  let sheetDashboard = lastSheetDashboard || emptySheetDashboard;
  if (sheetResult.ok) {
    sheetDashboard = sheetResult.dashboard || emptySheetDashboard;
    if (!sheetResult.cached) {
      lastSheetDashboard = sheetDashboard;
      lastSheetDashboardAt = Date.now();
    }
    if (sheetResult.cached) {
      sheetDashboard = { ...sheetDashboard, cached: true };
    }
  } else {
    console.error("Google Sheet dashboard fetch failed:", sheetResult.error.message);
    sheetDashboard = {
      ...sheetDashboard,
      error: sheetResult.error.message,
      usedLastGoodCache: Boolean(lastSheetDashboard),
    };
  }

  res.json({
    ok: true,
    liveQueue,
    queue: liveQueue,
    sheetDashboard,
    dashboard: sheetDashboard,
    monitor: getMonitorStatus(),
  });
});

app.post("/api/parse-html", (req, res) => {
  try {
    const html = req.body?.html || "";

    if (!html.trim()) {
      throw new Error("Missing html in body.");
    }

    const queue = parseQueueHtml(html);

    res.json({
      ok: true,
      queue,
      liveQueue: queue,
    });
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error.message,
    });
  }
});

app.post("/api/save-queue", async (req, res) => {
  try {
    const queue = analyzeQueue(req.body?.queue || req.body || {});
    const limitedQueueForSheet = buildLimitedQueueForSheet(queue, "manual-save-queue");
    const sheetResult = await postToGoogleScript("saveQueueSnapshot", limitedQueueForSheet);

    res.json({
      ok: true,
      queue,
      liveQueue: queue,
      sheetResult,
    });
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`HotelPlanner Watchtower server running on :${PORT}`);

  if (AUTO_MONITOR_ENABLED) {
    startMonitor();

    console.log(
      `Automatic monitor started. First scheduled run will happen in ${Math.max(
        15,
        POLL_INTERVAL_SECONDS
      )} seconds.`
    );
  }
});