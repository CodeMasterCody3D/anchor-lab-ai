#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const EVENTS_FILE = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/events.jsonl');

try {
  const event = {
    type: 'SESSION_STOP',
    timestamp: new Date().toISOString()
  };
  fs.appendFileSync(EVENTS_FILE, JSON.stringify(event) + '\n', 'utf8');
} catch (e) {}

process.exit(0);
