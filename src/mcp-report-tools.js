'use strict';

const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    root: { type: 'string', description: 'Repository root whose report to materialize. Defaults to the server working directory. Ignored when stored is true.' },
    lang: { type: 'string', enum: ['es', 'en'] },
    stored: { type: 'boolean', description: "When true, return the talent's ENTIRE stored server report (inventory + activity + AI-fluency level + prompting/interaction level) as plain text, read from the certs endpoint WITHOUT re-running any scan. When false/omitted, build the local shareable HTML report and return its file path." },
  },
};

const SHARE_SCHEMA = {
  type: 'object',
  properties: {
    root: { type: 'string', description: 'Repository root whose share card to generate. Defaults to the server working directory.' },
  },
};

function makeReportTools(deps = {}) {
  const {
    materializeProjectReport = require('./report-store').materializeProjectReport,
    loadFootprint = require('./report-store').loadFootprint,
    generateShareCard = require('./share-card').generateShareCard,
    loadAuthSession = require('./auth-session-store').loadAuthSession,
    sessionStatus = require('./auth-session-store').sessionStatus,
    getUsageReportEndpoint = require('./config').getUsageReportEndpoint,
    requestUsageReport = require('./report-view-client').requestUsageReport,
    renderUsageReportText = require('./render-usage-report-text').renderUsageReportText,
    renderFullReportText = require('./render-report-text').renderFullReportText,
    detectFlowLang = require('./i18n').detectFlowLang,
  } = deps;

  const requireSession = () => {
    const session = loadAuthSession();
    if (sessionStatus(session) !== 'active') {
      throw new Error('no active Shakers session — call the login tool (or run `shakers login`) first.');
    }
    return session;
  };

  async function storedReport(session, lang) {
    const endpoint = getUsageReportEndpoint();
    if (!endpoint) {
      return { ok: false, reason: 'no-endpoint', message: 'no certs endpoint configured to read the stored report.' };
    }
    const res = await requestUsageReport({ accessToken: session.accessToken }, { endpoint });
    if (!res.ok) {
      return { ok: false, reason: res.reason || 'read-failed', message: `could not read the stored report (${res.reason || 'unknown'}).` };
    }
    if (!res.report) {
      return { ok: true, hasReport: false, message: 'no stored report for this talent yet — run ai_usage first (and share the report).' };
    }
    return { ok: true, hasReport: true, text: renderUsageReportText(res, { lang }) };
  }

  async function report(args = {}) {
    const session = requireSession();
    if (args.stored === true) {
      return storedReport(session, args.lang || detectFlowLang());
    }
    const result = materializeProjectReport({ root: args.root || null, lang: args.lang || null });
    if (!result.hasData) {
      return { ok: false, reason: 'no-data', message: 'no report yet — run ai_usage (and optionally certify) for this repo first.' };
    }
    const ret = { ok: true, path: result.htmlPath, fileUrl: result.fileUrl };
    const footprint = loadFootprint({ root: args.root || null });
    if (footprint && footprint.report) {
      const preview = footprint.report.aiWorkPreview;
      const aiProfile = preview ? { status: 'ready', preview } : { status: 'unavailable', preview: null };
      const text = renderFullReportText(footprint.report, footprint.maturity, aiProfile, { lang: args.lang || detectFlowLang() });
      if (text) ret.text = text;
    }
    return ret;
  }

  async function share(args = {}) {
    requireSession();
    const result = generateShareCard({ root: args.root || null });
    if (!result.ok) {
      return { ok: false, reason: 'no-footprint', message: 'no report yet — run ai_usage for this repo first.' };
    }
    return { ok: true, path: result.htmlPath, fileUrl: result.fileUrl };
  }

  return [
    {
      name: 'report',
      description: "Two modes. stored:true returns the talent's ENTIRE stored server report (inventory + activity + AI-fluency level + prompting/interaction level) as plain text, read from certs WITHOUT re-running any scan — says so cleanly when none is stored (this stored view does NOT include the Setup×Usage matrix or the vision/how-I-work narratives). Otherwise builds the local report for this repo from local state: it returns the full human-readable report in `text` (Markdown mirroring the CLI terminal — Setup level and rank rationale, tools, MCP servers, agents, activity, plus the Setup×Usage matrix and vision/how-I-work when available) AND the HTML file path (no browser). Render `text` verbatim to the talent; keep the fenced blocks fenced so the tables stay aligned. Requires an active session. Any internal ids/codes are handles for tools only — never show or mention them to the talent.",
      inputSchema: REPORT_SCHEMA,
      handler: report,
    },
    {
      name: 'share',
      description: "Generate the Shakers-branded LinkedIn share card for this repo and return its file path. Does not open a browser. Requires an active session.",
      inputSchema: SHARE_SCHEMA,
      handler: share,
    },
  ];
}

module.exports = { makeReportTools, REPORT_SCHEMA, SHARE_SCHEMA };
