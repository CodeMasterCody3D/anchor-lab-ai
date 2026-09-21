#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const PartitionManager = require('../server/partition-manager');
const ColabController = require('../server/colab-controller');
const KaggleController = require('../server/kaggle-controller');
const SSHController = require('../server/ssh-controller');
const ModelRouter = require('../server/model-router');

const BASE_DIR = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects/quantization-side-lab');
const EVENTS_QUEUE = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/events.jsonl');
const DAEMON_LOG = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/daemon.log');

const partitionMgr = new PartitionManager(BASE_DIR);
const colabCtrl = new ColabController();
const kaggleCtrl = new KaggleController();
const sshCtrl = new SSHController();
const modelRouter = new ModelRouter();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  fs.appendFileSync(DAEMON_LOG, line, 'utf8');
  process.stdout.write(line);
}

log(`Anchor-Lab-Ai Watcher Daemon started. Active Model Engine: ${modelRouter.getModel()}`);

async function pollActiveRuns() {
  const activeRuns = partitionMgr.listActiveRuns();
  if (activeRuns.length === 0) return;

  log(`Polling ${activeRuns.length} active in-flight run(s)...`);

  for (const run of activeRuns) {
    const backend = run.progress.backend || 'colab';

    if (backend === 'colab') {
      const logs = colabCtrl.getLog();
      if (logs.latest_step) {
        partitionMgr.updateLiveProgress({
          model: run.model,
          activity: run.activity,
          experiment: run.experiment,
          run_id: run.run_id,
          telemetry: logs.latest_step
        });
        log(`Updated progress for [${run.model}][${run.activity}/${run.experiment}] run ${run.run_id}: Step ${logs.latest_step.step}/${logs.latest_step.total_steps}`);
      }

      if (logs.finished) {
        partitionMgr.completeRun({
          model: run.model,
          activity: run.activity,
          experiment: run.experiment,
          run_id: run.run_id,
          final_metrics: logs.finished.metrics,
          full_stdout: logs.raw
        });
        log(`Run ${run.run_id} finished! Moved to completed/ and updated ledger.`);
      }
    }
  }
}

function processEventQueue() {
  if (!fs.existsSync(EVENTS_QUEUE)) return;
  try {
    const data = fs.readFileSync(EVENTS_QUEUE, 'utf8').trim();
    if (!data) return;
    fs.writeFileSync(EVENTS_QUEUE, '', 'utf8'); // flush queue

    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        log(`Event received: ${event.type} (${event.summary || ''})`);
      } catch {}
    }
  } catch (e) {
    log(`Error reading event queue: ${e.message}`);
  }
}

// Main polling loop every 30 seconds
setInterval(async () => {
  try {
    processEventQueue();
    await pollActiveRuns();
  } catch (err) {
    log(`Error in poller tick: ${err.message}`);
  }
}, 30000);

// Run first check immediately
processEventQueue();
pollActiveRuns();
