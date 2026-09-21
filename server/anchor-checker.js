#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const HistoricalSynthesizer = require('./historical-synthesizer');
const PartitionManager = require('./partition-manager');
const ModelRouter = require('./model-router');
const { loadActiveContext } = require('./audit-wizard');

class AnchorChecker {
  constructor() {
    this.partitionMgr = new PartitionManager();
    this.modelRouter = new ModelRouter();
  }

  getCheckStatus() {
    // 1. Historical Synthesis Status
    const historical = HistoricalSynthesizer.getStatus();

    // 2. Active Background Workers & Tmux Sessions
    let tmuxSessions = [];
    try {
      const out = execSync('tmux list-sessions -F "#{session_name}|#{session_windows}|#{session_created_string}" 2>/dev/null', { encoding: 'utf8' }).trim();
      if (out) {
        tmuxSessions = out.split('\n').map(line => {
          const [name, windows, created] = line.split('|');
          return { name, windows, created };
        });
      }
    } catch {}

    const workerSession = tmuxSessions.find(s => s.name === 'anchor-lab-worker');
    const trainingSessions = tmuxSessions.filter(s => s.name.startsWith('anchor-train') || s.name.startsWith('anchor-colab') || s.name.startsWith('anchor-ssh'));
    const councilSessions = tmuxSessions.filter(s => s.name.startsWith('anchor-council'));

    // 3. Active in-flight training / quantization runs
    const activeRuns = this.partitionMgr.listActiveRuns();

    // 4. Subagent & Governance Invariants
    const mainAnchorInvariants = {
      role: 'CENTRAL_CONTROLLER_AND_SUPERVISOR',
      governance_mode: 'ANCHORED_STRICT',
      web_search_policy: 'PROHIBITED_ON_MAIN_ANCHOR (Main anchor stays anchored; heavy exploration delegated to subagents)',
      context_drift_guard: 'ACTIVE (Main anchor maintains ground-truth ledger and monitors subagents without context window inflation)',
      harvester_model: this.modelRouter.getModel(),
      active_context: loadActiveContext()
    };

    return {
      timestamp: new Date().toISOString(),
      historical,
      subagents: {
        total_subagent_tasks: (workerSession ? 1 : 0) + trainingSessions.length + councilSessions.length + activeRuns.length,
        worker_daemon: {
          active: !!workerSession,
          session: 'anchor-lab-worker',
          details: workerSession ? `Active (${workerSession.windows} windows, created ${workerSession.created})` : 'Inactive'
        },
        training_sessions: trainingSessions,
        council_sessions: councilSessions,
        in_flight_runs: activeRuns
      },
      governance: mainAnchorInvariants
    };
  }

  renderReport() {
    const status = this.getCheckStatus();
    const h = status.historical;
    const sub = status.subagents;
    const gov = status.governance;

    let out = `\n\x1b[1m\x1b[36m=====================================================\x1b[0m\n`;
    out += `\x1b[1m\x1b[36m  ANCHOR-LAB-AI OVERSIGHT & SUBAGENT AUDIT CARD\x1b[0m\n`;
    out += `\x1b[1m\x1b[36m=====================================================\x1b[0m\n`;

    // 1. Main Anchor Governance
    out += `\x1b[1mMAIN ANCHOR SUPERVISOR:\x1b[0m\n`;
    out += `  • \x1b[1mRole:\x1b[0m            ${gov.role}\n`;
    out += `  • \x1b[1mAnti-Drift Guard:\x1b[0m \x1b[32m✔ ACTIVE\x1b[0m (Strictly controller mode; no stray web searches)\n`;
    out += `  • \x1b[1mActive Model:\x1b[0m    ${gov.harvester_model}\n`;
    out += `  • \x1b[1mContext Track:\x1b[0m   [${gov.active_context.model}][${gov.active_context.activity}/${gov.active_context.experiment}]\n\n`;

    // 2. Historical Synthesis State
    out += `\x1b[1mHISTORICAL SYNTHESIZER STATUS:\x1b[0m\n`;
    if (h.status === 'running') {
      out += `  • \x1b[33m● RUNNING\x1b[0m (${h.progress_pct}% complete)\n`;
      out += `  • \x1b[1mCurrent Target:\x1b[0m  ${h.current_file || 'Processing...'}\n`;
      out += `  • \x1b[1mProgress:\x1b[0m        ${h.files_scanned} of ${h.total_files} session transcripts scanned\n`;
      out += `  • \x1b[1mTraps Found:\x1b[0m     ${h.traps_found}\n`;
      out += `  • \x1b[1mStatus Msg:\x1b[0m      ${h.message}\n\n`;
    } else if (h.status === 'completed') {
      out += `  • \x1b[32m✔ COMPLETED\x1b[0m (${h.progress_pct}%)\n`;
      out += `  • \x1b[1mFinished At:\x1b[0m     ${h.completed_at}\n`;
      out += `  • \x1b[1mBest Validated PPL:\x1b[0m \x1b[32m${h.best_ppl ? h.best_ppl.toFixed(4) : 'N/A'}\x1b[0m\n`;
      out += `  • \x1b[1mTraps Cataloged:\x1b[0m ${h.traps_found} failure traps in FAILURE_GRAVEYARD.md\n`;
      out += `  • \x1b[1mStatus Msg:\x1b[0m      ${h.message}\n\n`;
    } else if (h.status === 'error') {
      out += `  • \x1b[31m✖ ERROR\x1b[0m: ${h.message}\n\n`;
    } else {
      out += `  • \x1b[90m○ IDLE\x1b[0m: No scan currently in-flight. (Run '/anchorscan' or 'anchor-lab-ai scan')\n\n`;
    }

    // 3. Subagents & Background Workers
    out += `\x1b[1mSPAWNED SUBAGENTS & WORKER FLEET:\x1b[0m\n`;
    out += `  • \x1b[1mWorker Daemon:\x1b[0m   ${sub.worker_daemon.active ? '\x1b[32m● Running\x1b[0m (tmux: ' + sub.worker_daemon.session + ')' : '\x1b[90m○ Inactive\x1b[0m'}\n`;

    if (sub.in_flight_runs.length > 0) {
      out += `  • \x1b[1mIn-Flight Runs:\x1b[0m  ${sub.in_flight_runs.length} active\n`;
      sub.in_flight_runs.forEach(r => {
        out += `      ▶ [${r.model}][${r.run_id}] Step ${r.progress.step}/${r.progress.total_steps} (${r.progress.status})\n`;
      });
    } else {
      out += `  • \x1b[1mIn-Flight Runs:\x1b[0m  0 active training/eval runs\n`;
    }

    if (sub.council_sessions.length > 0) {
      out += `  • \x1b[1mCouncil Agents:\x1b[0m  ${sub.council_sessions.length} active deliberation sessions\n`;
    } else {
      out += `  • \x1b[1mCouncil Agents:\x1b[0m  0 active (Standby)\n`;
    }

    out += `\x1b[1m\x1b[36m=====================================================\x1b[0m\n`;
    return out;
  }
}

if (require.main === module) {
  const checker = new AnchorChecker();
  console.log(checker.renderReport());
}

module.exports = AnchorChecker;
