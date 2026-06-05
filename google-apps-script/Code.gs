/***************************************
 * HotelPlanner Watchtower Backend v3
 * Automatic 24/7 Agent Watchlist + Daily Live Critical Agents
 * Sheet ID: 13IxCpTTyUXF-ssFI7PcSbO8xfsauJvkZkOPQcpETJc4
 ***************************************/

const SPREADSHEET_ID = '13IxCpTTyUXF-ssFI7PcSbO8xfsauJvkZkOPQcpETJc4';

const SHEETS = {
  WATCHLIST: 'Agent Watchlist',
  DAILY: 'Daily Critical Agents',
  SCORES: 'Agent Score Averages',
  SNAPSHOTS: 'Queue Snapshots',
  ROWS: 'Queue Rows',
  VENDORS: 'Vendor Daily Metrics',
  CONFIG: 'Config',
  AUDIT: 'Audit Log',
};

const HEADERS = {
  WATCHLIST: [
    'ID', 'Created At', 'Updated At', 'Date First Flagged', 'Date Last Seen', 'Agent Name', 'Vendor',
    'Issue Type', 'Severity', 'Status', 'Evidence', 'Things To Watch Out', 'Coaching Action', 'Owner',
    'Follow Up Date', 'Last Queue Call ID', 'Average Score', 'Calls Seen Today', 'Critical Flags Today',
    'High Flags Today', 'Times Flagged Total', 'Times Flagged Today', 'Auto Saved', 'Resolved At'
  ],
  DAILY: [
    'Date', 'Updated At', 'Agent Name', 'Vendor', 'Issue Type', 'Severity', 'Status', 'Evidence',
    'Things To Watch Out', 'Last Queue Call ID', 'Average Score', 'Calls Seen Today', 'Critical Flags Today',
    'High Flags Today', 'Times Flagged Today', 'Watchlist ID'
  ],
  SCORES: [
    'Date', 'Updated At', 'Agent Name', 'Vendor', 'Calls Seen', 'Scored Calls', 'Average Score',
    'Lowest Score', 'Highest Score', 'Max Duration Seconds', 'Max Duration', 'Callback Risk Calls',
    'Critical Flags', 'High Flags', 'Last Queue Call ID', 'Things To Watch Out'
  ],
  SNAPSHOTS: [
    'Snapshot ID', 'Captured At', 'Saved At', 'Source', 'Calls On Hold', 'Agents Available', 'Rows Count',
    'Past Callback Limit', 'Past Voicemail Limit', 'Critical Count', 'High Count', 'Auto Flagged Agents',
    'Company Risk Level', 'Company Reasons', 'Monitor Reason'
  ],
  ROWS: [
    'Snapshot ID', 'Captured At', 'Call ID', 'Duration Seconds', 'Duration', 'Score', 'Called', 'Caller',
    'Agent Name', 'Vendor', 'Last Action', 'Severity', 'Reasons', 'Notes'
  ],
  VENDORS: [
    'Date', 'Updated At', 'Vendor', 'Calls Seen', 'Agents Seen', 'Average Score', 'Critical Flags',
    'High Flags', 'Max Duration Seconds', 'Max Duration'
  ],
  CONFIG: ['Key', 'Value', 'Description'],
  AUDIT: ['At', 'Action', 'Details']
};

const DEFAULT_CONFIG = [
  ['critical_score_threshold', '15', 'Agent score at or below this value becomes Critical.'],
  ['high_score_threshold', '25', 'Agent score at or below this value becomes High.'],
  ['callback_after_seconds', '500', 'Calls at or above this duration are callback-risk calls.'],
  ['voicemail_after_seconds', '1500', 'Calls at or above this duration are voicemail-risk calls.'],
  ['auto_save_high_agents', 'true', 'Automatically save high/critical agents from queue snapshots.'],
  ['company_calls_on_hold_high', '25', 'Queue size considered high risk.'],
  ['follow_up_days_default', '3', 'Default follow-up date offset for new watchlist rows.'],
];

function doGet(e) {
  setupWorkbook();
  const action = (e && e.parameter && e.parameter.action) || '';
  if (action === 'listWatchlist') return json_({ ok: true, items: listWatchlist_() });
  if (action === 'listDailyCritical') return json_({ ok: true, items: listDailyCritical_(e.parameter || {}) });
  if (action === 'listScoreAverages') return json_({ ok: true, items: listScoreAverages_(e.parameter || {}) });
  if (action === 'dashboard') return json_({ ok: true, dashboard: getDashboard_() });
  return json_({ ok: true, app: 'HotelPlanner Watchtower', version: '3.0.0', message: 'Workbook ready.' });
}

function doPost(e) {
  try {
    setupWorkbook();
    const body = parseBody_(e);
    const action = body.action;
    const payload = body.payload || {};

    if (action === 'setupWorkbook') return json_({ ok: true, message: 'Workbook ready.' });
    if (action === 'dashboard') return json_({ ok: true, dashboard: getDashboard_() });
    if (action === 'listWatchlist') return json_({ ok: true, items: listWatchlist_() });
    if (action === 'listDailyCritical') return json_({ ok: true, items: listDailyCritical_(payload) });
    if (action === 'listScoreAverages') return json_({ ok: true, items: listScoreAverages_(payload) });
    if (action === 'upsertWatchlist') return json_({ ok: true, item: upsertWatchlist_(payload) });
    if (action === 'resolveWatchlist') return json_({ ok: true, item: resolveWatchlist_(payload.id) });
    if (action === 'saveQueueSnapshot') {
      const result = saveQueueSnapshot_(payload);
      return json_({ ok: true, result: result });
    }

    throw new Error('Unknown action: ' + action);
  } catch (err) {
    return json_({ ok: false, error: err.message, stack: err.stack });
  }
}

function setupWorkbook() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(SHEETS).forEach(function(key) {
    ensureSheet_(ss, SHEETS[key], HEADERS[key]);
  });
  seedConfig_(ss);
}

function saveQueueSnapshot_(queue) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const config = getConfig_();
  const savedAt = new Date();
  const capturedAt = queue.capturedAt ? new Date(queue.capturedAt) : savedAt;
  const dateKey = formatDate_(capturedAt);
  const snapshotId = 'SNP-' + Utilities.formatDate(savedAt, Session.getScriptTimeZone(), 'yyyyMMdd-HHmmss') + '-' + Math.floor(Math.random() * 10000);
  const rows = queue.rows || [];
  const summary = queue.summary || buildSummary_(queue, config);
  const companyReasons = (summary.companyReasons || []).join(' | ');

  appendRows_(ss.getSheetByName(SHEETS.SNAPSHOTS), [[
    snapshotId,
    capturedAt,
    savedAt,
    queue.source || 'unknown',
    Number(summary.callsOnHold || queue.callsOnHold || 0),
    Number(summary.agentsAvailable || queue.agentsAvailable || 0),
    Number(summary.rowsCount || rows.length || 0),
    Number(summary.pastCallback || 0),
    Number(summary.pastVoicemail || 0),
    Number(summary.criticalCount || 0),
    Number(summary.highCount || 0),
    Number(summary.autoFlaggedAgents || 0),
    summary.companyRisk || 'Low',
    companyReasons,
    queue.monitorReason || ''
  ]]);

  if (rows.length) {
    appendRows_(ss.getSheetByName(SHEETS.ROWS), rows.map(function(r) {
      return [
        snapshotId,
        capturedAt,
        r.callId || '',
        Number(r.durationSeconds || 0),
        r.durationLabel || secondsToClock_(r.durationSeconds || 0),
        Number(r.score || 0),
        r.called || '',
        r.caller || '',
        r.agent || '',
        r.vendor || 'Unknown',
        r.lastAction || '',
        r.severity || 'Low',
        (r.reasons || []).join(' | '),
        r.notes || ''
      ];
    }));
  }

  const agentMetrics = queue.agentMetrics && queue.agentMetrics.length ? queue.agentMetrics : buildAgentMetrics_(rows, config);
  const vendorMetrics = queue.vendorMetrics && queue.vendorMetrics.length ? queue.vendorMetrics : buildVendorMetrics_(rows);

  upsertScoreAverages_(ss, dateKey, agentMetrics);
  upsertVendorMetrics_(ss, dateKey, vendorMetrics);

  const autoFlagged = [];
  const shouldAutoSave = String(config.auto_save_high_agents || 'true').toLowerCase() === 'true';
  if (shouldAutoSave) {
    agentMetrics.forEach(function(agent) {
      if (['Critical', 'High'].indexOf(agent.severity) === -1) return;
      const item = autoUpsertWatchlistAgent_(ss, dateKey, agent, capturedAt);
      autoFlagged.push(item);
    });
  }

  log_(ss, 'saveQueueSnapshot', JSON.stringify({ snapshotId: snapshotId, autoFlagged: autoFlagged.length, companyRisk: summary.companyRisk }));
  return { snapshotId: snapshotId, autoFlagged: autoFlagged.length, companyRisk: summary.companyRisk || 'Low', date: dateKey };
}

function autoUpsertWatchlistAgent_(ss, dateKey, agent, capturedAt) {
  const watchSheet = ss.getSheetByName(SHEETS.WATCHLIST);
  const dailySheet = ss.getSheetByName(SHEETS.DAILY);
  const config = getConfig_();
  const data = getObjects_(watchSheet);
  const existingIndex = data.findIndex(function(x) {
    return String(x['Agent Name']).toLowerCase() === String(agent.agent || agent['Agent Name']).toLowerCase() &&
      String(x['Status']).toLowerCase() !== 'resolved';
  });
  const now = new Date();
  const followUp = new Date(now.getTime() + Number(config.follow_up_days_default || 3) * 86400000);
  const watchOut = Array.isArray(agent.watchOut) ? agent.watchOut.join(' | ') : (agent.watchOut || agent['Things To Watch Out'] || '');
  const issueType = buildIssueType_(agent);
  const evidence = buildEvidence_(agent);
  let id;
  let timesTotal = 1;

  if (existingIndex >= 0) {
    const rowNumber = existingIndex + 2;
    const old = data[existingIndex];
    id = old.ID;
    timesTotal = Number(old['Times Flagged Total'] || 0) + 1;
    patchRow_(watchSheet, rowNumber, HEADERS.WATCHLIST, {
      'Updated At': now,
      'Date Last Seen': capturedAt || now,
      'Vendor': agent.vendor || old.Vendor || 'Unknown',
      'Issue Type': issueType,
      'Severity': strongerSeverity_(old.Severity, agent.severity),
      'Status': old.Status === 'Resolved' ? 'Monitoring' : (old.Status || 'Monitoring'),
      'Evidence': evidence,
      'Things To Watch Out': watchOut,
      'Last Queue Call ID': agent.lastCallId || old['Last Queue Call ID'] || '',
      'Average Score': Number(agent.avgScore || 0),
      'Calls Seen Today': Number(agent.callsSeen || 0),
      'Critical Flags Today': Number(agent.criticalFlags || 0),
      'High Flags Today': Number(agent.highFlags || 0),
      'Times Flagged Total': timesTotal,
      'Auto Saved': 'Yes'
    });
  } else {
    id = 'WL-' + Utilities.getUuid().slice(0, 8).toUpperCase();
    appendRows_(watchSheet, [[
      id, now, now, capturedAt || now, capturedAt || now, agent.agent || '', agent.vendor || 'Unknown',
      issueType, agent.severity || 'High', 'Monitoring', evidence, watchOut,
      'Review calls, confirm matrix adherence, and coach on queue/score risk.', '', followUp,
      agent.lastCallId || '', Number(agent.avgScore || 0), Number(agent.callsSeen || 0), Number(agent.criticalFlags || 0),
      Number(agent.highFlags || 0), 1, 1, 'Yes', ''
    ]]);
  }

  upsertDaily_(dailySheet, dateKey, id, agent, issueType, evidence, watchOut);
  return { id: id, agent: agent.agent, severity: agent.severity, averageScore: agent.avgScore };
}

function upsertDaily_(sheet, dateKey, watchlistId, agent, issueType, evidence, watchOut) {
  const data = getObjects_(sheet);
  const idx = data.findIndex(function(x) {
    return String(x.Date) === String(dateKey) && String(x['Agent Name']).toLowerCase() === String(agent.agent || '').toLowerCase();
  });
  const now = new Date();
  const patch = {
    'Date': dateKey,
    'Updated At': now,
    'Agent Name': agent.agent || '',
    'Vendor': agent.vendor || 'Unknown',
    'Issue Type': issueType,
    'Severity': agent.severity || 'High',
    'Status': 'Monitoring',
    'Evidence': evidence,
    'Things To Watch Out': watchOut,
    'Last Queue Call ID': agent.lastCallId || '',
    'Average Score': Number(agent.avgScore || 0),
    'Calls Seen Today': Number(agent.callsSeen || 0),
    'Critical Flags Today': Number(agent.criticalFlags || 0),
    'High Flags Today': Number(agent.highFlags || 0),
    'Times Flagged Today': idx >= 0 ? Number(data[idx]['Times Flagged Today'] || 0) + 1 : 1,
    'Watchlist ID': watchlistId
  };
  if (idx >= 0) patchRow_(sheet, idx + 2, HEADERS.DAILY, patch);
  else appendRows_(sheet, [HEADERS.DAILY.map(function(h) { return patch[h] !== undefined ? patch[h] : ''; })]);
}

function upsertScoreAverages_(ss, dateKey, agentMetrics) {
  const sheet = ss.getSheetByName(SHEETS.SCORES);
  const data = getObjects_(sheet);
  const now = new Date();
  agentMetrics.forEach(function(a) {
    if (!a.agent) return;
    const idx = data.findIndex(function(x) {
      return String(x.Date) === String(dateKey) && String(x['Agent Name']).toLowerCase() === String(a.agent).toLowerCase();
    });
    const patch = {
      'Date': dateKey,
      'Updated At': now,
      'Agent Name': a.agent,
      'Vendor': a.vendor || 'Unknown',
      'Calls Seen': Number(a.callsSeen || 0),
      'Scored Calls': Number(a.scoredCalls || 0),
      'Average Score': Number(a.avgScore || 0),
      'Lowest Score': Number(a.lowestScore || 0),
      'Highest Score': Number(a.highestScore || 0),
      'Max Duration Seconds': Number(a.maxDurationSeconds || 0),
      'Max Duration': secondsToClock_(a.maxDurationSeconds || 0),
      'Callback Risk Calls': Number(a.callbackRiskCalls || 0),
      'Critical Flags': Number(a.criticalFlags || 0),
      'High Flags': Number(a.highFlags || 0),
      'Last Queue Call ID': a.lastCallId || '',
      'Things To Watch Out': Array.isArray(a.watchOut) ? a.watchOut.join(' | ') : (a.watchOut || '')
    };
    if (idx >= 0) patchRow_(sheet, idx + 2, HEADERS.SCORES, patch);
    else appendRows_(sheet, [HEADERS.SCORES.map(function(h) { return patch[h] !== undefined ? patch[h] : ''; })]);
  });
}

function upsertVendorMetrics_(ss, dateKey, vendorMetrics) {
  const sheet = ss.getSheetByName(SHEETS.VENDORS);
  const data = getObjects_(sheet);
  const now = new Date();
  vendorMetrics.forEach(function(v) {
    const idx = data.findIndex(function(x) { return String(x.Date) === String(dateKey) && String(x.Vendor) === String(v.vendor); });
    const patch = {
      'Date': dateKey,
      'Updated At': now,
      'Vendor': v.vendor || 'Unknown',
      'Calls Seen': Number(v.callsSeen || 0),
      'Agents Seen': Number(v.agentsSeen || 0),
      'Average Score': Number(v.avgScore || 0),
      'Critical Flags': Number(v.criticalFlags || 0),
      'High Flags': Number(v.highFlags || 0),
      'Max Duration Seconds': Number(v.maxDurationSeconds || 0),
      'Max Duration': secondsToClock_(v.maxDurationSeconds || 0)
    };
    if (idx >= 0) patchRow_(sheet, idx + 2, HEADERS.VENDORS, patch);
    else appendRows_(sheet, [HEADERS.VENDORS.map(function(h) { return patch[h] !== undefined ? patch[h] : ''; })]);
  });
}

function upsertWatchlist_(payload) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.WATCHLIST);
  const data = getObjects_(sheet);
  const now = new Date();
  const id = payload.ID || payload.id || 'WL-' + Utilities.getUuid().slice(0, 8).toUpperCase();
  const idx = data.findIndex(function(x) { return String(x.ID) === String(id); });
  const patch = {
    'ID': id,
    'Created At': payload['Created At'] || payload.createdAt || now,
    'Updated At': now,
    'Date First Flagged': payload['Date First Flagged'] || payload.dateFirstFlagged || now,
    'Date Last Seen': payload['Date Last Seen'] || payload.dateLastSeen || now,
    'Agent Name': payload['Agent Name'] || payload.agentName || payload.agent || '',
    'Vendor': payload.Vendor || payload.vendor || 'Unknown',
    'Issue Type': payload['Issue Type'] || payload.issueType || 'Manual QA Watch',
    'Severity': payload.Severity || payload.severity || 'High',
    'Status': payload.Status || payload.status || 'Open',
    'Evidence': payload.Evidence || payload.evidence || '',
    'Things To Watch Out': payload['Things To Watch Out'] || payload.watchOut || '',
    'Coaching Action': payload['Coaching Action'] || payload.coachingAction || '',
    'Owner': payload.Owner || payload.owner || '',
    'Follow Up Date': payload['Follow Up Date'] || payload.followUpDate || '',
    'Last Queue Call ID': payload['Last Queue Call ID'] || payload.lastQueueCallId || '',
    'Average Score': Number(payload['Average Score'] || payload.averageScore || 0),
    'Calls Seen Today': Number(payload['Calls Seen Today'] || payload.callsSeenToday || 0),
    'Critical Flags Today': Number(payload['Critical Flags Today'] || payload.criticalFlagsToday || 0),
    'High Flags Today': Number(payload['High Flags Today'] || payload.highFlagsToday || 0),
    'Times Flagged Total': Number(payload['Times Flagged Total'] || payload.timesFlaggedTotal || 1),
    'Times Flagged Today': Number(payload['Times Flagged Today'] || payload.timesFlaggedToday || 1),
    'Auto Saved': payload['Auto Saved'] || payload.autoSaved || 'No',
    'Resolved At': payload['Resolved At'] || payload.resolvedAt || ''
  };
  if (idx >= 0) patchRow_(sheet, idx + 2, HEADERS.WATCHLIST, patch);
  else appendRows_(sheet, [HEADERS.WATCHLIST.map(function(h) { return patch[h] !== undefined ? patch[h] : ''; })]);
  return patch;
}

function resolveWatchlist_(id) {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.WATCHLIST);
  const data = getObjects_(sheet);
  const idx = data.findIndex(function(x) { return String(x.ID) === String(id); });
  if (idx < 0) throw new Error('Watchlist item not found: ' + id);
  patchRow_(sheet, idx + 2, HEADERS.WATCHLIST, { 'Status': 'Resolved', 'Updated At': new Date(), 'Resolved At': new Date() });
  return Object.assign({}, data[idx], { Status: 'Resolved' });
}

function listWatchlist_() {
  return getObjects_(SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.WATCHLIST))
    .filter(function(x) { return String(x.Status).toLowerCase() !== 'resolved'; })
    .sort(function(a, b) { return severityWeight_(b.Severity) - severityWeight_(a.Severity) || new Date(b['Updated At']) - new Date(a['Updated At']); });
}

function listDailyCritical_(payload) {
  const date = payload.date || formatDate_(new Date());
  return getObjects_(SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.DAILY))
    .filter(function(x) { return String(x.Date) === String(date); })
    .sort(function(a, b) { return severityWeight_(b.Severity) - severityWeight_(a.Severity) || Number(b['Times Flagged Today'] || 0) - Number(a['Times Flagged Today'] || 0); });
}

function listScoreAverages_(payload) {
  const date = payload.date || formatDate_(new Date());
  return getObjects_(SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.SCORES))
    .filter(function(x) { return String(x.Date) === String(date); })
    .sort(function(a, b) { return Number(a['Average Score'] || 999) - Number(b['Average Score'] || 999); });
}

function getDashboard_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const today = formatDate_(new Date());
  const snapshots = getObjects_(ss.getSheetByName(SHEETS.SNAPSHOTS));
  const latestSnapshot = snapshots.length ? snapshots[snapshots.length - 1] : null;
  return {
    today: today,
    latestSnapshot: latestSnapshot,
    watchlist: listWatchlist_(),
    dailyCritical: listDailyCritical_({ date: today }),
    scoreAverages: listScoreAverages_({ date: today }),
    vendorMetrics: getObjects_(ss.getSheetByName(SHEETS.VENDORS)).filter(function(x) { return String(x.Date) === String(today); })
  };
}

function buildSummary_(queue, config) {
  const rows = queue.rows || [];
  const callback = Number(config.callback_after_seconds || 500);
  const voicemail = Number(config.voicemail_after_seconds || 1500);
  const pastCallback = rows.filter(function(r) { return Number(r.durationSeconds || 0) >= callback; }).length;
  const pastVoicemail = rows.filter(function(r) { return Number(r.durationSeconds || 0) >= voicemail; }).length;
  const criticalCount = rows.filter(function(r) { return r.severity === 'Critical'; }).length;
  const highCount = rows.filter(function(r) { return r.severity === 'High'; }).length;
  const callsOnHold = Number(queue.callsOnHold || 0);
  const agentsAvailable = Number(queue.agentsAvailable || 0);
  const companyReasons = [];
  let companyRisk = 'Low';
  if (callsOnHold > 0 && agentsAvailable === 0) { companyRisk = 'Critical'; companyReasons.push(callsOnHold + ' calls on hold with 0 agents available'); }
  if (pastVoicemail > 0) { companyRisk = 'Critical'; companyReasons.push(pastVoicemail + ' calls past voicemail threshold'); }
  if (companyRisk !== 'Critical' && (pastCallback > 0 || criticalCount > 0)) companyRisk = 'High';
  if (pastCallback > 0) companyReasons.push(pastCallback + ' calls past callback threshold');
  return { callsOnHold: callsOnHold, agentsAvailable: agentsAvailable, rowsCount: rows.length, pastCallback: pastCallback, pastVoicemail: pastVoicemail, criticalCount: criticalCount, highCount: highCount, autoFlaggedAgents: 0, companyRisk: companyRisk, companyReasons: companyReasons };
}

function buildAgentMetrics_(rows, config) {
  const map = {};
  rows.forEach(function(r) {
    if (!r.agent) return;
    const key = String(r.agent).toLowerCase() + '|' + String(r.vendor || 'Unknown').toLowerCase();
    if (!map[key]) map[key] = { agent: r.agent, vendor: r.vendor || 'Unknown', callsSeen: 0, scoredCalls: 0, scoreTotal: 0, lowestScore: 999, highestScore: 0, avgScore: 0, maxDurationSeconds: 0, callbackRiskCalls: 0, criticalFlags: 0, highFlags: 0, lastCallId: '', watchOut: [], severity: 'Low' };
    const a = map[key];
    a.callsSeen++;
    const score = Number(r.score || 0);
    if (score > 0) { a.scoredCalls++; a.scoreTotal += score; a.lowestScore = Math.min(a.lowestScore, score); a.highestScore = Math.max(a.highestScore, score); a.avgScore = Number((a.scoreTotal / a.scoredCalls).toFixed(2)); }
    a.maxDurationSeconds = Math.max(a.maxDurationSeconds, Number(r.durationSeconds || 0));
    if (Number(r.durationSeconds || 0) >= Number(config.callback_after_seconds || 500)) a.callbackRiskCalls++;
    if (r.severity === 'Critical') a.criticalFlags++;
    if (r.severity === 'High') a.highFlags++;
    a.lastCallId = r.callId || a.lastCallId;
    (r.reasons || []).forEach(function(reason) { if (a.watchOut.indexOf(reason) === -1) a.watchOut.push(reason); });
  });
  return Object.keys(map).map(function(k) {
    const a = map[k];
    if (a.lowestScore === 999) a.lowestScore = 0;
    if (a.criticalFlags > 0 || (a.avgScore > 0 && a.avgScore <= Number(config.critical_score_threshold || 15))) a.severity = 'Critical';
    else if (a.highFlags > 0 || a.callbackRiskCalls > 0 || (a.avgScore > 0 && a.avgScore <= Number(config.high_score_threshold || 25))) a.severity = 'High';
    else if (a.maxDurationSeconds >= 300) a.severity = 'Medium';
    a.watchOut = a.watchOut.slice(0, 8);
    return a;
  });
}

function buildVendorMetrics_(rows) {
  const map = {};
  rows.forEach(function(r) {
    const vendor = r.vendor || 'Unknown';
    if (!map[vendor]) map[vendor] = { vendor: vendor, callsSeen: 0, agents: {}, scoredCalls: 0, scoreTotal: 0, avgScore: 0, criticalFlags: 0, highFlags: 0, maxDurationSeconds: 0 };
    const v = map[vendor];
    v.callsSeen++;
    if (r.agent) v.agents[r.agent] = true;
    const score = Number(r.score || 0);
    if (score > 0) { v.scoredCalls++; v.scoreTotal += score; v.avgScore = Number((v.scoreTotal / v.scoredCalls).toFixed(2)); }
    if (r.severity === 'Critical') v.criticalFlags++;
    if (r.severity === 'High') v.highFlags++;
    v.maxDurationSeconds = Math.max(v.maxDurationSeconds, Number(r.durationSeconds || 0));
  });
  return Object.keys(map).map(function(k) { const v = map[k]; return { vendor: v.vendor, callsSeen: v.callsSeen, agentsSeen: Object.keys(v.agents).length, avgScore: v.avgScore, criticalFlags: v.criticalFlags, highFlags: v.highFlags, maxDurationSeconds: v.maxDurationSeconds }; });
}

function buildIssueType_(agent) {
  const parts = [];
  if (Number(agent.avgScore || 0) > 0 && Number(agent.avgScore || 0) <= 25) parts.push('Low Average Link Score');
  if (Number(agent.callbackRiskCalls || 0) > 0) parts.push('Long Wait / Callback Risk');
  if (Number(agent.criticalFlags || 0) > 0) parts.push('Critical Queue Risk');
  if (Number(agent.highFlags || 0) > 0) parts.push('High Queue Risk');
  return parts.length ? parts.join(' + ') : 'Automatic Queue Watch';
}

function buildEvidence_(agent) {
  return [
    'Avg Score: ' + Number(agent.avgScore || 0),
    'Calls Seen: ' + Number(agent.callsSeen || 0),
    'Callback Risk Calls: ' + Number(agent.callbackRiskCalls || 0),
    'Critical Flags: ' + Number(agent.criticalFlags || 0),
    'High Flags: ' + Number(agent.highFlags || 0),
    'Max Duration: ' + secondsToClock_(agent.maxDurationSeconds || 0),
    'Last Call ID: ' + (agent.lastCallId || '')
  ].join(' | ');
}

function ensureSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  const firstRow = sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn() || 1)).getValues()[0];
  const missing = headers.some(function(h, i) { return firstRow[i] !== h; });
  if (missing) {
    sheet.clear();
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  const headerRange = sheet.getRange(1, 1, 1, headers.length);
  headerRange.setFontWeight('bold').setBackground('#0b1f3a').setFontColor('#ffffff');
  sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

function seedConfig_(ss) {
  const sheet = ss.getSheetByName(SHEETS.CONFIG);
  const values = sheet.getDataRange().getValues();
  if (values.length > 1) return;
  appendRows_(sheet, DEFAULT_CONFIG);
}

function getConfig_() {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.CONFIG);
  const rows = sheet.getDataRange().getValues().slice(1);
  const out = {};
  rows.forEach(function(r) { if (r[0]) out[String(r[0])] = r[1]; });
  return out;
}

function getObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  return values.slice(1).filter(function(row) { return row.some(function(v) { return v !== '' && v !== null; }); }).map(function(row) {
    const obj = {};
    headers.forEach(function(h, i) { obj[h] = row[i]; });
    return obj;
  });
}

function patchRow_(sheet, rowNumber, headers, patch) {
  const current = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  headers.forEach(function(h, i) { if (patch[h] !== undefined) current[i] = patch[h]; });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([current]);
}

function appendRows_(sheet, rows) {
  if (!rows || !rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  return JSON.parse(e.postData.contents);
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function log_(ss, action, details) {
  appendRows_(ss.getSheetByName(SHEETS.AUDIT), [[new Date(), action, details]]);
}

function formatDate_(date) {
  return Utilities.formatDate(new Date(date), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function secondsToClock_(seconds) {
  seconds = Math.max(0, Number(seconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  return h > 0 ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}

function severityWeight_(sev) {
  sev = String(sev || '').toLowerCase();
  if (sev === 'critical') return 4;
  if (sev === 'high') return 3;
  if (sev === 'medium') return 2;
  if (sev === 'low') return 1;
  return 0;
}

function strongerSeverity_(a, b) {
  return severityWeight_(a) >= severityWeight_(b) ? a : b;
}
