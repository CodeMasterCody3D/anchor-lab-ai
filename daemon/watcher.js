#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const PartitionManager = require('../server/partition-manager');
const ColabController = require('../server/colab-controller');
const KaggleController = require('../server/kaggle-controller');
const SSHController = require('../server/ssh-controller');
const ModelRouter = require('../server/model-router');
const ChatIngester = require('../server/chat-ingester');
const { getProjectBaseDir } = require('../server/project-resolver');
const { loadActiveContext } = require('../server/audit-wizard');

const BASE_DIR = getProjectBaseDir();
const EVENTS_QUEUE = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/events.jsonl');
const EVENTS_ARCHIVE = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/events_archive.jsonl');
const DAEMON_LOG = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/daemon.log');

const partitionMgr = new PartitionManager(BASE_DIR);
const colabCtrl = new ColabController();
const kaggleCtrl = new KaggleController();
const sshCtrl = new SSHController();
const modelRouter = new ModelRouter();
const chatIngester = new ChatIngester();

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try {
    fs.appendFileSync(DAEMON_LOG, line, 'utf8');
  } catch (_) {}
  process.stdout.write(line);
}

log(`Anchor-Lab-Ai Watcher Daemon started. Active Model Engine: ${modelRouter.getModel()} | Project: ${path.basename(BASE_DIR)}`);

async function pollActiveRuns() {
  const currentCtx = loadActiveContext();

  // 1. Auto-discover active Kaggle runs from the CLI fleet
  try {
    const activeKaggle = kaggleCtrl.getActiveKernels(5);
    for (const k of activeKaggle) {
      const runId = k.slug.split('/').pop() || k.slug;
      const kLogs = kaggleCtrl.getKernelLog(k.slug);
      partitionMgr.syncKaggleRun({
        model: (kLogs.latest_step && kLogs.latest_step.model) || currentCtx.model,
        activity: (kLogs.latest_step && kLogs.latest_step.activity) || currentCtx.activity,
        experiment: (kLogs.latest_step && kLogs.latest_step.experiment) || currentCtx.experiment,
        run_id: runId,
        slug: k.slug,
        status: k.status,
        latest_step: kLogs.latest_step,
        finished: kLogs.finished,
        rawLog: kLogs.raw
      });
    }
  } catch (err) {
    log(`Kaggle discovery warning: ${err.message}`);
  }

  const activeRuns = partitionMgr.listActiveRuns();
  if (activeRuns.length === 0) return;

  log(`Polling ${activeRuns.length} active in-flight run(s)...`);

  for (const run of activeRuns) {
    const backend = run.progress.backend || 'colab';

    if (backend === 'colab') {
      const logs = colabCtrl.getLog();
      if (logs && logs.latest_step) {
        partitionMgr.updateLiveProgress({
          model: run.model,
          activity: run.activity,
          experiment: run.experiment,
          run_id: run.run_id,
          telemetry: logs.latest_step
        });
        log(`Updated progress for Colab [${run.model}][${run.activity}/${run.experiment}] run ${run.run_id}: Step ${logs.latest_step.step}/${logs.latest_step.total_steps}`);
      }

      if (logs && logs.finished) {
        partitionMgr.completeRun({
          model: run.model,
          activity: run.activity,
          experiment: run.experiment,
          run_id: run.run_id,
          final_metrics: logs.finished.metrics,
          full_stdout: logs.raw
        });
        log(`Colab Run ${run.run_id} finished! Moved to completed/ and updated ledger.`);
      }
    } else if (backend === 'kaggle') {
      const slug = (run.progress && run.progress.slug) || run.run_id;
      const logs = kaggleCtrl.getKernelLog(slug);
      if (logs && logs.latest_step) {
        partitionMgr.updateLiveProgress({
          model: run.model,
          activity: run.activity,
          experiment: run.experiment,
          run_id: run.run_id,
          telemetry: {
            ...logs.latest_step,
            backend: 'kaggle',
            slug,
            status: (logs.status && logs.status.statusText) || 'RUNNING'
          }
        });
        log(`Updated progress for Kaggle [${run.model}][${run.activity}/${run.experiment}] run ${run.run_id}: Step ${logs.latest_step.step}/${logs.latest_step.total_steps} (loss=${logs.latest_step.loss})`);
      }

      if (logs && (logs.finished || (logs.status && logs.status.complete))) {
        partitionMgr.completeRun({
          model: run.model,
          activity: run.activity,
          experiment: run.experiment,
          run_id: run.run_id,
          final_metrics: (logs.finished && logs.finished.metrics) || {},
          full_stdout: logs.raw || ''
        });
        log(`Kaggle Run ${run.run_id} (${slug}) finished! Moved to completed/ and updated ledger.`);
      }
    }
  }
}

function processEventQueue() {
  if (!fs.existsSync(EVENTS_QUEUE)) return;
  try {
    const data = fs.readFileSync(EVENTS_QUEUE, 'utf8').trim();
    if (!data) return;

    // 1. Append to permanent events archive before flushing queue
    try {
      fs.appendFileSync(EVENTS_ARCHIVE, data + '\n', 'utf8');
    } catch (_) {}

    // 2. Flush queue
    fs.writeFileSync(EVENTS_QUEUE, '', 'utf8');

    // 3. Log meaningful event contents
    const lines = data.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        const detail = event.command || event.summary || '';
        log(`Event: ${event.type} [${event.tool || 'hook'}] ${detail}`.trim());
      } catch {}
    }

    // 4. Ingest latest chat notes when new events land
    try {
      const res = chatIngester.ingestSession();
      if (res && res.findings_count > 0) {
        log(`Chat Ingester: Synced ${res.findings_count} confirmed findings & active plan for ${res.project}.`);
      }
    } catch (ingestErr) {
      log(`Chat Ingester warning: ${ingestErr.message}`);
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
try {
  const initRes = chatIngester.ingestSession();
  log(`Initial chat ingestion: ${initRes.findings_count} findings cataloged in CONFIRMED_FINDINGS.md`);
} catch (_) {}
pollActiveRuns();
