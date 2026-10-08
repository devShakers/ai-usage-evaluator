#!/usr/bin/env node
// Create (or reuse) a GitHub Release for a tag and attach the .mcpb asset.
// Zero-dep (node:https + node:fs only — no curl/jq). Idempotent: re-running for the
// same tag reuses the release and replaces a same-named asset, so a pipeline retry
// never fails on "asset already exists".
//
// Required env:
//   GITHUB_TOKEN   fine-grained/classic token with Contents: Read & Write on GH_REPO
//   GH_REPO        owner/repo         (e.g. devShakers/shakers-mcp)
//   CI_COMMIT_TAG  the release tag     (e.g. v1.2.3) — also the release name
//   MCPB_ASSET     asset filename      (e.g. shakers-ai-usage-staging.mcpb)
//   MCPB_FILE      local path to the .mcpb to upload
// Optional:
//   GH_TARGET_BRANCH  target_commitish for a freshly created release (default: release)

import fs from 'node:fs';
import https from 'node:https';

const token = required('GITHUB_TOKEN');
const repo = required('GH_REPO');
const tag = required('CI_COMMIT_TAG');
const asset = required('MCPB_ASSET');
const file = required('MCPB_FILE');
const target = process.env.GH_TARGET_BRANCH || 'release';

function required(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`missing env ${name}`);
    process.exit(1);
  }
  return v;
}

function api(host, path, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host,
        path,
        method,
        headers: Object.assign(
          {
            'User-Agent': 'shakers-ci',
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
          headers,
        ),
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function fail(label, res) {
  console.error(`${label} failed: HTTP ${res.status}\n${res.body.toString()}`);
  process.exit(1);
}

(async () => {
  // 1) Find or create the release for the tag.
  let releaseId;
  const found = await api('api.github.com', `/repos/${repo}/releases/tags/${encodeURIComponent(tag)}`, 'GET', {});
  if (found.status === 200) {
    releaseId = JSON.parse(found.body).id;
    console.log(`reusing existing release for ${tag} (id ${releaseId})`);
  } else if (found.status === 404) {
    const payload = JSON.stringify({
      tag_name: tag,
      target_commitish: target,
      name: tag,
      body: `Automated release ${tag}\n\nBuilt from ${process.env.CI_PROJECT_PATH || 'gitlab'}@${process.env.CI_COMMIT_SHA || 'unknown'}`,
    });
    const created = await api('api.github.com', `/repos/${repo}/releases`, 'POST', { 'Content-Type': 'application/json' }, payload);
    if (created.status >= 300) fail('create release', created);
    releaseId = JSON.parse(created.body).id;
    console.log(`created release for ${tag} (id ${releaseId})`);
  } else {
    fail('lookup release by tag', found);
  }

  // 2) Delete a pre-existing same-named asset so re-runs are idempotent.
  const list = await api('api.github.com', `/repos/${repo}/releases/${releaseId}/assets`, 'GET', {});
  if (list.status !== 200) fail('list assets', list);
  for (const a of JSON.parse(list.body)) {
    if (a.name === asset) {
      const del = await api('api.github.com', `/repos/${repo}/releases/assets/${a.id}`, 'DELETE', {});
      if (del.status >= 300 && del.status !== 404) fail('delete existing asset', del);
      console.log(`deleted existing asset ${asset} (id ${a.id})`);
    }
  }

  // 3) Upload the .mcpb.
  const data = fs.readFileSync(file);
  const up = await api(
    'uploads.github.com',
    `/repos/${repo}/releases/${releaseId}/assets?name=${encodeURIComponent(asset)}`,
    'POST',
    { 'Content-Type': 'application/octet-stream', 'Content-Length': data.length },
    data,
  );
  if (up.status >= 300) fail('upload asset', up);
  const url = JSON.parse(up.body).browser_download_url;
  console.log(`released ${tag} -> ${asset}`);
  console.log(`asset: ${url}`);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
