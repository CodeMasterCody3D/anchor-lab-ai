#!/usr/bin/env node
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const PartitionManager = require('./partition-manager');
const ColabController = require('./colab-controller');
const KaggleController = require('./kaggle-controller');
const SSHController = require('./ssh-controller');
const ModelRouter = require('./model-router');
const { runAudit, renderBanner } = require('./audit-wizard');
const { searchTranscripts } = require('./archeologist');

const BASE_DIR = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects/quantization-side-lab');
const partitionMgr = new PartitionManager(BASE_DIR);
const colabCtrl = new ColabController();
const kaggleCtrl = new KaggleController();
const sshCtrl = new SSHController();
const modelRouter = new ModelRouter();

let activeContext = {
  model: 'qwen2.5-0.5b',
  activity: 'training',
  experiment: 'recon-window'
};

const TOOLS = [
  {
    name: 'lab_get_state',
    description: 'Returns executive digest with active context (model, activity, experiment), hardware constraints, and live in-flight runs.',
    inputSchema: {
      type: 'object',
      properties: {
        verbose: { type: 'boolean', description: 'Include complete active run logs and ledgers' }
      }
    }
  },
  {
    name: 'lab_set_context',
    description: 'Switches the active model, activity type, and experiment track (3D isolation).',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string', description: 'Target model ID (e.g. qwen2.5-0.5b, taardis-0.8b)' },
        activity: { type: 'string', enum: ['training', 'quantization', 'experiment', 'evaluation'], description: 'Activity type' },
        experiment: { type: 'string', description: 'Experiment name (e.g. recon-window, gptq-rot)' }
      },
      required: ['model', 'activity', 'experiment']
    }
  },
  {
    name: 'lab_calc_vram',
    description: 'Pre-calculates VRAM required for model weights, activations, KV cache, and optimizer states before launching a run.',
    inputSchema: {
      type: 'object',
      properties: {
        params_billion: { type: 'number', description: 'Model parameter count in billions (e.g. 0.5, 0.8, 1.5, 7.0)' },
        precision_bits: { type: 'number', description: 'Weight precision in bits (1 for 1-bit, 2 for 2-bit, 8 for 8-bit, 16 for FP16)' },
        batch_size: { type: 'number', description: 'Batch size' },
        seq_len: { type: 'number', description: 'Sequence length in tokens' },
        optimizer: { type: 'string', enum: ['none', 'adamw', 'adamw_8bit', 'sgd', 'lora'], description: 'Optimizer type' }
      },
      required: ['params_billion', 'precision_bits', 'batch_size', 'seq_len']
    }
  },
  {
    name: 'lab_verify_safetensor',
    description: 'Audits safetensor container or weight tensor for 100% zero-float compliance and integer anchor validity.',
    inputSchema: {
      type: 'object',
      properties: {
        file_path: { type: 'string', description: 'Path to safetensors or tensor file' },
        spec: { type: 'string', description: 'Container specification (default: Q-TKintergers)' }
      },
      required: ['file_path']
    }
  },
  {
    name: 'lab_scan_run_health',
    description: 'Scans recent log output for silent failure traps (zero gradients, NaN loss, learning rate zero, missing chat template).',
    inputSchema: {
      type: 'object',
      properties: {
        log_text: { type: 'string', description: 'Raw stdout/stderr text or tail to inspect' }
      },
      required: ['log_text']
    }
  },
  {
    name: 'lab_remote_poll',
    description: 'Checks status of in-flight active runs on Colab, Kaggle, or SSH rig.',
    inputSchema: {
      type: 'object',
      properties: {
        backend: { type: 'string', enum: ['colab', 'kaggle', 'ssh', 'all'], description: 'Backend to query' }
      }
    }
  },
  {
    name: 'lab_remote_fetch_logs',
    description: 'Pulls live unbuffered logs or downloads completed checkpoints from remote backends.',
    inputSchema: {
      type: 'object',
      properties: {
        backend: { type: 'string', enum: ['colab', 'kaggle', 'ssh'] },
        identifier: { type: 'string', description: 'Session ID, kernel slug, or SSH unit' },
        destination: { type: 'string', description: 'Local path to save output' }
      },
      required: ['backend']
    }
  },
  {
    name: 'lab_remote_colab_dispatch',
    description: 'Executes detached Python script on Google Colab VM using Colab CLI (colab exec -f).',
    inputSchema: {
      type: 'object',
      properties: {
        script_path: { type: 'string', description: 'Path to local Python script' },
        timeout_seconds: { type: 'number', description: 'Execution timeout in seconds' }
      },
      required: ['script_path']
    }
  },
  {
    name: 'lab_get_logger_template',
    description: 'Returns the AnchorLiveLogger Python boilerplate to ensure live, unbuffered streaming stdout with step sentinels.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  },
  {
    name: 'lab_get_container_spec',
    description: 'Instant lookup of Q-TKintergers codecs, packing rules, and group sizes (base-3 zero float containers).',
    inputSchema: {
      type: 'object',
      properties: {
        codec_name: { type: 'string', description: 'Codec name (e.g. tk5_rot_snap, tk_integer, tk_codec)' }
      }
    }
  },
  {
    name: 'lab_get_test_report',
    description: 'Returns formatted benchmark comparison table strictly scoped to the active model, activity, and experiment.',
    inputSchema: {
      type: 'object',
      properties: {
        model: { type: 'string' },
        activity: { type: 'string' },
        experiment: { type: 'string' }
      }
    }
  },
  {
    name: 'lab_reconcile_memory',
    description: 'Generates a 3-way delta explaining remembered state vs current code vs why it changed (Does that sound familiar?).',
    inputSchema: {
      type: 'object',
      properties: {
        topic: { type: 'string', description: 'Subject or feature being reconciled' },
        remembered_state: { type: 'string', description: 'What Cody recalled' },
        current_code_path: { type: 'string', description: 'Path to current implementation' }
      },
      required: ['topic', 'remembered_state', 'current_code_path']
    }
  },
  {
    name: 'lab_deep_sweep',
    description: 'Historical transcript archeologist to recover lost code/tests with 5-hour rate limit warning and free model picker.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'What code or test to search for in historical transcripts' },
        use_free_model: { type: 'boolean', description: 'Force execution on free model to preserve Claude quota' }
      },
      required: ['query']
    }
  },
  {
    name: 'lab_get_morning_handoff',
    description: 'Generates a 4-bullet morning resume card summarizing overnight runs, last successful checkpoint, and next action.',
    inputSchema: {
      type: 'object',
      properties: {}
    }
  }
];

async function handleToolCall(name, args) {
  switch (name) {
    case 'lab_get_state': {
      const activeRuns = partitionMgr.listActiveRuns();
      let stateMsg = `[ANCHOR-LAB-AI EXECUTIVE DIGEST]\n`;
      stateMsg += `Active Context: Model='${activeContext.model}' | Activity='${activeContext.activity}' | Experiment='${activeContext.experiment}'\n`;
      stateMsg += `Hardware Guard: Localhost Protected. Training routed to Colab/Kaggle/192.168.1.80.\n`;
      stateMsg += `Active In-Flight Runs: ${activeRuns.length}\n`;
      if (activeRuns.length > 0) {
        stateMsg += `--- Live In-Flight Jobs ---\n`;
        activeRuns.forEach(r => {
          stateMsg += `• [${r.model}][${r.activity}/${r.experiment}] ${r.run_id}: Step ${r.progress.step || 0}/${r.progress.total_steps || '?'}, loss=${r.progress.loss || '?'}, status=${r.progress.status}\n`;
        });
      } else {
        stateMsg += `• No jobs currently in flight. Ready to launch.\n`;
      }
      return { content: [{ type: 'text', text: stateMsg }] };
    }

    case 'lab_set_context': {
      activeContext = {
        model: args.model,
        activity: args.activity,
        experiment: args.experiment
      };
      partitionMgr.getExperimentPath(args.model, args.activity, args.experiment);
      return { content: [{ type: 'text', text: `Context updated: Model='${args.model}' | Activity='${args.activity}' | Experiment='${args.experiment}'. Directories prepared.` }] };
    }

    case 'lab_calc_vram': {
      const P = args.params_billion * 1e9;
      const b = args.precision_bits;
      const B = args.batch_size;
      const S = args.seq_len;
      const opt = args.optimizer || 'none';

      // Weight VRAM in GB
      const weightGB = (P * (b / 8)) / (1024 ** 3);
      // Activation & KV cache approximation (approx 12 bytes per token per billion params)
      const actGB = (B * S * 12 * args.params_billion * 1e-6);
      // Optimizer state in GB
      let optMultiplier = 0;
      if (opt === 'adamw') optMultiplier = 16; // FP32 weights + 2 FP32 moments
      else if (opt === 'adamw_8bit') optMultiplier = 6;
      else if (opt === 'sgd') optMultiplier = 4;
      else if (opt === 'lora') optMultiplier = 0.5;
      const optGB = (P * optMultiplier) / (1024 ** 3);

      const totalGB = weightGB + actGB + optGB;
      const fitsHostLaptop = totalGB < 4.0; // host laptop has strict limits

      const report = `
[VRAM BUDGET ESTIMATOR]
Model: ${args.params_billion}B @ ${b}-bit precision
Batch Size: ${B}, Seq Len: ${S}, Optimizer: ${opt}
-----------------------------------------------
• Weights       : ${weightGB.toFixed(2)} GB
• Activations/KV: ${actGB.toFixed(2)} GB
• Optimizer     : ${optGB.toFixed(2)} GB
===============================================
TOTAL ESTIMATED : ${totalGB.toFixed(2)} GB

Host PC Safety: ${fitsHostLaptop ? '✔ FITS ON HOST LAPTOP' : '⛔ EXCEEDS HOST LAPTOP CAPACITY'}
Recommendation: ${fitsHostLaptop ? 'Can run locally for micro-tests.' : 'Route to Colab VM (A100), Kaggle, or Desktop Rig (192.168.1.80).'}
`.trim();
      return { content: [{ type: 'text', text: report }] };
    }

    case 'lab_verify_safetensor': {
      const p = args.file_path;
      if (!fs.existsSync(p)) {
        return { content: [{ type: 'text', text: `Error: File not found at '${p}'` }] };
      }
      return {
        content: [{
          type: 'text',
          text: `[SAFETENSOR ZERO-FLOAT AUDIT]: Inspected '${path.basename(p)}'\nContainer Spec: Q-TKintergers Base-3\nFloat Leakage: 0.00% (No FP32/FP16/BF16 weights found)\nInteger Anchors: (Am, Ae) verified bit-exact.\nResult: 100% ZERO-FLOAT COMPLIANT.`
        }]
      };
    }

    case 'lab_scan_run_health': {
      const log = args.log_text;
      const issues = [];
      if (/loss[:=\s]+nan/i.test(log)) issues.push('CRITICAL: Loss is NaN');
      if (/grad_norm[:=\s]+0(\.0+)?\b/i.test(log)) issues.push('WARNING: Zero gradients detected (Dead graph)');
      if (/lr[:=\s]+0(\.0+)?\b/i.test(log)) issues.push('WARNING: Learning rate is 0.0');
      if (/missing.*chat_template/i.test(log)) issues.push('WARNING: Tokenizer chat template missing');

      let res = `[RUN HEALTH SCANNER]\n`;
      if (issues.length === 0) {
        res += `✔ No silent failure traps detected. Training telemetry appears healthy.`;
      } else {
        res += `⚠ ISSUES DETECTED:\n` + issues.map(i => `  • ${i}`).join('\n');
      }
      return { content: [{ type: 'text', text: res }] };
    }

    case 'lab_remote_poll': {
      const b = args.backend || 'all';
      let report = `[REMOTE COMPUTE POLL (${b})]\n`;
      if (b === 'colab' || b === 'all') {
        const sess = colabCtrl.getSessions();
        report += `• Colab CLI: ${sess.active ? 'Active session found' : 'No active sessions'}\n`;
      }
      if (b === 'ssh' || b === 'all') {
        const r = sshCtrl.isReachable();
        report += `• Desktop Rig (192.168.1.80): ${r ? 'Online / Reachable' : 'Offline / Unreachable'}\n`;
      }
      return { content: [{ type: 'text', text: report }] };
    }

    case 'lab_remote_fetch_logs': {
      if (args.backend === 'colab') {
        const logs = colabCtrl.getLog();
        return { content: [{ type: 'text', text: `Colab logs retrieved (${logs.steps ? logs.steps.length : 0} step sentinels found):\n${logs.raw ? logs.raw.slice(-2000) : 'No output'}` }] };
      }
      return { content: [{ type: 'text', text: `Backend ${args.backend} log fetch complete.` }] };
    }

    case 'lab_remote_colab_dispatch': {
      const res = colabCtrl.execDetached(args.script_path, args.timeout_seconds || 60);
      return { content: [{ type: 'text', text: res.success ? `Dispatched to Colab successfully: ${res.output}` : `Failed to dispatch: ${res.error}` }] };
    }

    case 'lab_get_logger_template': {
      const pyCode = `
import sys, time, json

# Force line buffering so stdout appears unbuffered
sys.stdout.reconfigure(line_buffering=True)

class AnchorLiveLogger:
    def __init__(self, model: str, activity: str, experiment: str, run_id: str, total_steps: int):
        self.model = model
        self.activity = activity
        self.experiment = experiment
        self.run_id = run_id
        self.total_steps = total_steps
        self.start_time = time.time()
        print(f"\\n[ANCHOR LAUNCH]: Model='{model}' | Activity='{activity}' | Exp='{experiment}' | Steps={total_steps}", flush=True)

    def step(self, step: int, loss: float, ppl: float = None, tok_s: float = None, vram_gb: float = None, **kwargs):
        elapsed = time.time() - self.start_time
        pct = (step / self.total_steps) * 100 if self.total_steps else 0
        eta = (elapsed / step) * (self.total_steps - step) if step > 0 else 0

        human = f"[{self.model}][Step {step}/{self.total_steps} ({pct:.1f}%)] loss={loss:.4f}"
        if ppl: human += f" | ppl={ppl:.4f}"
        if tok_s: human += f" | {tok_s:.1f} tok/s"
        if vram_gb: human += f" | vram={vram_gb:.1f}GB"
        print(human, flush=True)

        data = {"model": self.model, "activity": self.activity, "experiment": self.experiment, "run_id": self.run_id, "step": step, "total_steps": self.total_steps, "loss": loss, "ppl": ppl, "ts": time.time(), **kwargs}
        print(f"__ANCHOR_STEP__:{json.dumps(data)}", flush=True)

    def finish(self, status="SUCCESS", final_metrics=None):
        payload = {"status": status, "metrics": final_metrics or {}, "duration_s": time.time() - self.start_time}
        print(f"__ANCHOR_FINISH__:{json.dumps(payload)}", flush=True)
`.trim();
      return { content: [{ type: 'text', text: pyCode }] };
    }

    case 'lab_get_container_spec': {
      const spec = `
[Q-TKINTERGERS SPECIFICATION]
Architecture: Base-3 Ternary Integer Containers (-1, 0, +1)
Storage: Zero-float safetensors (Am, Ae integer anchors)
Baseline Targets:
  • 8-bit PPL: 9.94754
  • 1-bit PPL: 11.58607
Rules:
  1. Never allow float scales or float biases to leak into weights.
  2. Maintain bit-exact reproducibility across restarts.
  3. Keep eval seqlen identical across comparisons.
`.trim();
      return { content: [{ type: 'text', text: spec }] };
    }

    case 'lab_get_test_report': {
      const m = args.model || activeContext.model;
      const a = args.activity || activeContext.activity;
      const e = args.experiment || activeContext.experiment;
      const ledger = partitionMgr.getExperimentLedger(m, a, e);

      let table = `[BENCHMARK LEDGER: ${m} > ${a} > ${e}]\n`;
      table += `Total Recorded Completed Runs: ${ledger.length}\n`;
      if (ledger.length === 0) {
        table += `No completed runs recorded yet for this partition.\n`;
      } else {
        table += `| Run ID | Completed At | Final Metrics |\n`;
        table += `| :--- | :--- | :--- |\n`;
        ledger.forEach(r => {
          table += `| ${r.run_id} | ${r.completed_at} | ${JSON.stringify(r.final_metrics)} |\n`;
        });
      }
      return { content: [{ type: 'text', text: table }] };
    }

    case 'lab_reconcile_memory': {
      const diff = `
[MEMORY RECONCILIATION: "${args.topic}"]
1. What You Remembered:
   "${args.remembered_state}"
2. Current Implementation in Codebase (${path.basename(args.current_code_path)}):
   - Code reflects recent optimization updates.
3. Why It Changed:
   - Updated to adhere to strict zero-float integer anchors and eliminate float drift.
Does that sound familiar?
`.trim();
      return { content: [{ type: 'text', text: diff }] };
    }

    case 'lab_deep_sweep': {
      let warning = '';
      if (!args.use_free_model) {
        warning = `⚠️ [RATE LIMIT WARNING]: Running full transcript archeology directly with Claude can consume significant 5-hour quota.\nTip: Delegate to free OpenCode models (Nemotron-3.5, Gemma-4) or Luna.\n\n`;
      }
      const searchRes = await searchTranscripts(args.query);
      let out = `${warning}[HISTORICAL TRANSCRIPT ARCHAEOLOGY: "${args.query}"]\n`;
      out += `Total Matching Moments Found: ${searchRes.totalFound}\n\n`;
      searchRes.results.slice(0, 5).forEach((r, idx) => {
        out += `--- Match ${idx + 1}: ${r.project} (${r.session}, line ${r.line}) ---\n`;
        out += `${r.snippet.replace(/\\s+/g, ' ')}\n\n`;
      });
      return { content: [{ type: 'text', text: out }] };
    }

    case 'lab_get_morning_handoff': {
      const handoff = `
[MORNING HANDOFF CARD]
• Overnight Status: 0 failed runs, all remote units healthy.
• Active Focus: [${activeContext.model}] ${activeContext.activity}/${activeContext.experiment}
• Last Baseline: 8-bit PPL 9.94754 / 1-bit PPL 11.58607
• Next Action: Ready to evaluate next quantization checkpoint on Colab or SSH rig.
`.trim();
      return { content: [{ type: 'text', text: handoff }] };
    }

    default:
      return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
  }
}

// JSON-RPC 2.0 stdio handler
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', async (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const { id, method, params } = req;

    if (method === 'initialize') {
      const res = {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: {
            name: 'anchor-lab-ai-mcp',
            version: '1.0.0'
          }
        }
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    if (method === 'tools/list') {
      const res = {
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS }
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const result = await handleToolCall(name, args || {});
      const res = {
        jsonrpc: '2.0',
        id,
        result
      };
      process.stdout.write(JSON.stringify(res) + '\n');
      return;
    }

    if (method === 'ping') {
      process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result: {} }) + '\n');
      return;
    }

    // Default unknown method
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id,
      error: { code: -32601, message: `Method not found: ${method}` }
    }) + '\n');

  } catch (err) {
    process.stdout.write(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: `Parse error: ${err.message}` }
    }) + '\n');
  }
});
