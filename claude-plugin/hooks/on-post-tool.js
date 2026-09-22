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
    let summary = '';
    let command = undefined;

    if (data.tool_input) {
      if (typeof data.tool_input === 'string') {
        summary = data.tool_input;
      } else {
        command = data.tool_input.command || data.tool_input.cmd || undefined;
        const desc = data.tool_input.description || '';
        const filePath = data.tool_input.file_path || data.tool_input.path || data.tool_input.target || '';
        if (command) {
          summary = command + (desc ? ` (${desc})` : '');
        } else if (filePath) {
          summary = `file: ${filePath}` + (desc ? ` (${desc})` : '');
        } else if (desc) {
          summary = desc;
        } else {
          summary = JSON.stringify(data.tool_input);
        }
      }
    }

    const event = {
      type: 'POST_TOOL_USE',
      timestamp: new Date().toISOString(),
      session_id: data.session_id || undefined,
      cwd: data.cwd || undefined,
      tool: data.tool_name || data.tool || 'unknown',
      summary: summary.slice(0, 500),
      command: command ? command.slice(0, 500) : undefined,
      input: (data.tool_input && typeof data.tool_input === 'object') ? data.tool_input : undefined
    };
    fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf8');
  } catch (e) {}

  process.exit(0);
});
