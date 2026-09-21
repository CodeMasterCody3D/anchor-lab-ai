#!/usr/bin/env node
const { renderBanner } = require('/home/cody/.anchor-lab-ai/server/audit-wizard');

try {
  const banner = renderBanner();
  console.log(banner);
} catch (e) {
  console.log(`[ANCHOR-LAB-AI] Session initialized.`);
}
