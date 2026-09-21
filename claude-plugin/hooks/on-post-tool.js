#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const EVENTS_FILE = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/events.jsonl');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  if (!input.trim()) process.exit(0);

  try {
    const data = JSON.parse(input);
    const event = {
      type: 'POST_TOOL_USE',
      timestamp: new Date().toISOString(),
      tool: data.tool_name || data.tool,
      summary: data.tool_input ? Object.keys(data.tool_input).join(', ') : ''
    };
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf8');
  } catch (e) {}

  process.exit(0);
});
