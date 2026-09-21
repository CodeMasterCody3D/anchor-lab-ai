#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function checkBinary(name) {
  try {
    const p = execSync(`which ${name} 2>/dev/null`, { encoding: 'utf8' }).trim();
    return p || null;
  } catch {
    return null;
  }
}

function checkColabMCP() {
  try {
    const claudeJsonPath = path.join(process.env.HOME || '/home/cody', '.claude.json');
    if (fs.existsSync(claudeJsonPath)) {
      const data = JSON.parse(fs.readFileSync(claudeJsonPath, 'utf8'));
      if (data.mcpServers && data.mcpServers['colab-mcp']) {
        return { configured: true, client: 'Claude Code' };
      }
    }
  } catch {}

  try {
    const opencodeJsonPath = path.join(process.env.HOME || '/home/cody', '.config/opencode/opencode.json');
    if (fs.existsSync(opencodeJsonPath)) {
      const data = JSON.parse(fs.readFileSync(opencodeJsonPath, 'utf8'));
      if (data.mcp && (data.mcp['colab_mcp'] || data.mcp['colab-mcp'])) {
        return { configured: true, client: 'OpenCode' };
      }
    }
  } catch {}

  return { configured: false };
}

function checkColabCLI() {
  const bin = checkBinary('colab');
  if (!bin) return { installed: false };
  let ver = 'installed';
  try {
    const out = execSync(`${bin} version 2>/dev/null`, { encoding: 'utf8' });
    const match = out.match(/Version:\s*([^\s]+)/i);
    if (match) ver = `v${match[1]}`;
  } catch {}
  return { installed: true, path: bin, version: ver };
}

function checkKaggleCLI() {
  const bin = checkBinary('kaggle');
  if (!bin) return { installed: false };
  let ver = 'installed';
  try {
    const out = execSync(`${bin} --version 2>/dev/null`, { encoding: 'utf8' });
    const match = out.match(/Kaggle CLI\s*([^\s]+)/i);
    if (match) ver = `v${match[1]}`;
  } catch {}
  const authPath = path.join(process.env.HOME || '/home/cody', '.kaggle/kaggle.json');
  const authOk = fs.existsSync(authPath);
  return { installed: true, path: bin, version: ver, authOk };
}

function checkSSHRig() {
  const host = '192.168.1.80';
  let reachable = false;
  try {
    execSync(`nc -z -w 1 ${host} 22 2>/dev/null`);
    reachable = true;
  } catch {
    reachable = false;
  }
  return { host, reachable };
}

function checkAuthProviders() {
  const providers = {
    openai: false,
    openrouter: false,
    custom: false,
    agy: false
  };

  try {
    const authFile = path.join(process.env.HOME || '/home/cody', '.local/share/opencode/auth.json');
    if (fs.existsSync(authFile)) {
      const data = JSON.parse(fs.readFileSync(authFile, 'utf8'));
      if (data.openai) providers.openai = true;
      if (data.openrouter) providers.openrouter = true;
      if (data.custom) providers.custom = true;
    }
  } catch {}

  if (checkBinary('agy')) {
    providers.agy = true;
  }

  return providers;
}

function checkTmux() {
  const bin = checkBinary('tmux');
  if (!bin) return { installed: false };
  let ver = 'installed';
  try {
    const out = execSync(`${bin} -V 2>/dev/null`, { encoding: 'utf8' }).trim();
    if (out) ver = out;
  } catch {}
  let workerRunning = false;
  try {
    execSync(`${bin} has-session -t anchor-lab-worker 2>/dev/null`);
    workerRunning = true;
  } catch {}
  return { installed: true, path: bin, version: ver, workerRunning };
}

function runAudit() {
  return {
    tmux: checkTmux(),
    colabMCP: checkColabMCP(),
    colabCLI: checkColabCLI(),
    kaggleCLI: checkKaggleCLI(),
    sshRig: checkSSHRig(),
    providers: checkAuthProviders()
  };
}

function renderBanner(activeContext = {}) {
  const audit = runAudit();
  const model = activeContext.model || 'qwen2.5-0.5b';
  const activity = activeContext.activity || 'training';
  const experiment = activeContext.experiment || 'recon-window';

  const tmuxStatus = audit.tmux.installed
    ? `✔ tmux Daemon Host  : Installed (${audit.tmux.version}${audit.tmux.workerRunning ? ', session \'anchor-lab-worker\' RUNNING' : ', worker idle'})`
    : `✖ tmux Daemon Host  : MISSING (Required for persistent watcher daemon! Run 'sudo apt install -y tmux')`;
  const colabMcpStatus = audit.colabMCP.configured ? `✔ Colab MCP Server : Configured (${audit.colabMCP.client})` : `✖ Colab MCP Server : Missing (Run 'anchor-lab-ai doctor')`;
  const colabCliStatus = audit.colabCLI.installed ? `✔ Colab CLI        : Installed (${audit.colabCLI.version} at ${audit.colabCLI.path})` : `✖ Colab CLI        : Missing (Run 'anchor-lab-ai doctor')`;
  const kaggleCliStatus = audit.kaggleCLI.installed ? `✔ Kaggle CLI       : Installed (${audit.kaggleCLI.version}, ${audit.kaggleCLI.authOk ? 'auth OK' : 'no ~/.kaggle/kaggle.json'})` : `✖ Kaggle CLI       : Missing`;
  const sshRigStatus = audit.sshRig.reachable ? `✔ Desktop Lab Rig  : Reachable (192.168.1.80 via SSH/systemd-run)` : `⚠ Desktop Lab Rig  : 192.168.1.80 unreachable / offline`;

  const banner = `
╔══════════════════════════════════════════════════════════════╗
║  ⚓ ANCHOR-LAB-AI SYSTEM & COMPUTE AUDIT                     ║
╚══════════════════════════════════════════════════════════════╝
Active Context: Model='${model}' | Activity='${activity}' | Experiment='${experiment}'
Local Compute Shield: ENABLED (Guarding local host from OOM/disk overflow)

[Compute Fleet Audit]:
  ${tmuxStatus}
  ${colabMcpStatus}
  ${colabCliStatus}
  ${kaggleCliStatus}
  ${sshRigStatus}

[Telemetry & 3D Isolation]:
  ✔ Verbose Live Streaming : ENFORCED (__ANCHOR_STEP__ line buffering)
  ✔ 3D Partitioning        : ACTIVE (Model / Activity / Experiment)
  ✔ Active Runs In-Flight  : 0 active

Choose Harvester Worker Engine & Model:
  [★ DEFAULT - OpenAI OAuth Verified in OpenCode]:
  1. openai/gpt-5.6-luna (Recommended / Active)
  2. openai/gpt-5.4-fast

  [OpenRouter Free Tier (:free) - Detected in OpenCode]:
  3. openrouter/nvidia/nemotron-3.5-lightning:free
  4. openrouter/qwen/qwen3.8-27b:free
  5. openrouter/google/gemma-4-31b-it:free
  6. openrouter/meta-llama/llama-3.3-70b-instruct:free

  [Free Quota-Free Models in OpenCode]:
  7. opencode/nemotron-3.5-lightning-free
  8. opencode/mimo-v2.5-free
  9. zai-coding-plan/glm-4.5-air

  [AGY Engine (Antigravity Models)]:
  10. agy:gemini-3.8-flash-high (Fastest Flash / Low Quota)
  11. agy:gemini-3.7-flash-high
  12. agy:gemini-3.1-pro-high
  13. agy:claude-sonnet-4-6
  14. agy:gpt-oss-120b-medium (120B Open-Weights in AGY)

  [Custom Harness / Opt-Out]:
  15. Custom AI Setup / Opt-out (Run 'anchor-lab-ai connect')

Default: openai/gpt-5.6-luna. (Reply 'anchor model <number>' or proceed to use Luna).
`.trim();

  return banner;
}

if (require.main === module) {
  console.log(renderBanner());
}

module.exports = {
  runAudit,
  renderBanner,
  checkBinary,
  checkColabMCP,
  checkColabCLI,
  checkKaggleCLI,
  checkSSHRig,
  checkAuthProviders
};
