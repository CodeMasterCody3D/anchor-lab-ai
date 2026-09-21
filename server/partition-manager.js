#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const VALID_ACTIVITIES = ['training', 'quantization', 'experiment', 'evaluation'];

class PartitionManager {
  constructor(baseDir = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects/quantization-side-lab')) {
    this.baseDir = baseDir;
    this.modelsDir = path.join(this.baseDir, 'models');
    this.ensureDir(this.modelsDir);
  }

  ensureDir(dirPath) {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  }

  getExperimentPath(model, activity, experiment) {
    const act = VALID_ACTIVITIES.includes(activity) ? activity : 'experiment';
    const p = path.join(this.modelsDir, model, act, experiment);
    this.ensureDir(path.join(p, 'active'));
    this.ensureDir(path.join(p, 'completed'));
    return p;
  }

  createRun({ model, activity, experiment, run_id, run_spec = {} }) {
    const expPath = this.getExperimentPath(model, activity, experiment);
    const runDir = path.join(expPath, 'active', run_id);
    this.ensureDir(runDir);

    const specFile = path.join(runDir, 'run_spec.json');
    const initialSpec = {
      model,
      activity,
      experiment,
      run_id,
      created_at: new Date().toISOString(),
      ...run_spec
    };
    fs.writeFileSync(specFile, JSON.stringify(initialSpec, null, 2), 'utf8');

    const progressFile = path.join(runDir, 'live_progress.json');
    const initialProgress = {
      status: 'INITIALIZING',
      step: 0,
      total_steps: run_spec.total_steps || 0,
      percent: 0,
      loss: null,
      ppl: null,
      updated_at: new Date().toISOString()
    };
    fs.writeFileSync(progressFile, JSON.stringify(initialProgress, null, 2), 'utf8');

    return { runDir, specFile, progressFile };
  }

  updateLiveProgress({ model, activity, experiment, run_id, telemetry }) {
    const expPath = this.getExperimentPath(model, activity, experiment);
    const runDir = path.join(expPath, 'active', run_id);
    if (!fs.existsSync(runDir)) return null;

    const progressFile = path.join(runDir, 'live_progress.json');
    const updated = {
      status: 'RUNNING',
      ...telemetry,
      updated_at: new Date().toISOString()
    };
    fs.writeFileSync(progressFile, JSON.stringify(updated, null, 2), 'utf8');

    if (telemetry.log_chunk) {
      const streamLog = path.join(runDir, 'live_stream.log');
      fs.appendFileSync(streamLog, telemetry.log_chunk, 'utf8');
    }

    return updated;
  }

  completeRun({ model, activity, experiment, run_id, final_metrics = {}, full_stdout = '' }) {
    const expPath = this.getExperimentPath(model, activity, experiment);
    const activeDir = path.join(expPath, 'active', run_id);
    const completedDir = path.join(expPath, 'completed', run_id);

    if (fs.existsSync(activeDir)) {
      this.ensureDir(path.dirname(completedDir));
      fs.renameSync(activeDir, completedDir);
    } else {
      this.ensureDir(completedDir);
    }

    const metricsFile = path.join(completedDir, 'final_metrics.json');
    const metricsPayload = {
      model,
      activity,
      experiment,
      run_id,
      completed_at: new Date().toISOString(),
      final_metrics
    };
    fs.writeFileSync(metricsFile, JSON.stringify(metricsPayload, null, 2), 'utf8');

    if (full_stdout) {
      fs.writeFileSync(path.join(completedDir, 'full_stdout.log'), full_stdout, 'utf8');
    }

    // Update experiment ledger
    const ledgerFile = path.join(expPath, 'ledger.json');
    let ledger = [];
    if (fs.existsSync(ledgerFile)) {
      try {
        ledger = JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
      } catch {}
    }
    ledger.push(metricsPayload);
    fs.writeFileSync(ledgerFile, JSON.stringify(ledger, null, 2), 'utf8');

    return metricsPayload;
  }

  listActiveRuns() {
    const activeRuns = [];
    if (!fs.existsSync(this.modelsDir)) return activeRuns;

    const models = fs.readdirSync(this.modelsDir);
    for (const model of models) {
      const modelPath = path.join(this.modelsDir, model);
      if (!fs.statSync(modelPath).isDirectory()) continue;

      for (const act of VALID_ACTIVITIES) {
        const actPath = path.join(modelPath, act);
        if (!fs.existsSync(actPath) || !fs.statSync(actPath).isDirectory()) continue;

        const experiments = fs.readdirSync(actPath);
        for (const exp of experiments) {
          const activeDir = path.join(actPath, exp, 'active');
          if (fs.existsSync(activeDir) && fs.statSync(activeDir).isDirectory()) {
            const runs = fs.readdirSync(activeDir);
            for (const r of runs) {
              const runPath = path.join(activeDir, r);
              if (!fs.statSync(runPath).isDirectory()) continue;
              const progFile = path.join(runPath, 'live_progress.json');
              let prog = {};
              if (fs.existsSync(progFile)) {
                try { prog = JSON.parse(fs.readFileSync(progFile, 'utf8')); } catch {}
              }
              activeRuns.push({
                model,
                activity: act,
                experiment: exp,
                run_id: r,
                progress: prog
              });
            }
          }
        }
      }
    }
    return activeRuns;
  }

  getExperimentLedger(model, activity, experiment) {
    const expPath = this.getExperimentPath(model, activity, experiment);
    const ledgerFile = path.join(expPath, 'ledger.json');
    if (!fs.existsSync(ledgerFile)) return [];
    try {
      return JSON.parse(fs.readFileSync(ledgerFile, 'utf8'));
    } catch {
      return [];
    }
  }
}

module.exports = PartitionManager;
