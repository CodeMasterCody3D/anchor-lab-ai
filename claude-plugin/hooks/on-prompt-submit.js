#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const PartitionManager = require('/home/cody/.anchor-lab-ai/server/partition-manager');
const ModelRouter = require('/home/cody/.anchor-lab-ai/server/model-router');
const SessionRouter = require('/home/cody/.anchor-lab-ai/server/session-router');

const partitionMgr = new PartitionManager();
const modelRouter = new ModelRouter();
const sessionRouter = new SessionRouter();

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    let userPrompt = '';
    let sessionId = null;
    let cwd = process.cwd();

    try {
      const parsed = JSON.parse(input);
      userPrompt = parsed.prompt || parsed.text || '';
      sessionId = parsed.session_id || null;
      cwd = parsed.cwd || process.cwd();
    } catch {}

    // Record session correlation
    const sessionMeta = sessionRouter.recordActiveSession(sessionId, cwd);
    const activeRuns = partitionMgr.listActiveRuns();

    const ctxFile = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/active_context.json');
    let ctx = { model: 'qwen2.5-0.5b', activity: 'training', experiment: 'recon-window' };
    try {
      if (fs.existsSync(ctxFile)) {
        ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
      }
    } catch {}

    // Load live notes and tips from chat-ingester
    const projName = sessionMeta.project_name || 'onebit-forge';
    const tipsFile = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects', projName, 'live_tips.json');
    let tips = {
      latest_finding_headline: 'Merge viable: 85% gain survives the fold, 0.097% churn',
      current_plan_headline: 'Iterative research and minimal hypothesis testing',
      active_scripts: ['merge_branches.py', 'anchored_qat.py'],
      scope_tip: 'Scope Check: If testing a single lever/idea, run the minimal isolated probe. Never expand into the full 3-stage training pipeline unless Cody explicitly calls for the complete run.'
    };
    try {
      if (fs.existsSync(tipsFile)) {
        tips = { ...tips, ...JSON.parse(fs.readFileSync(tipsFile, 'utf8')) };
      }
    } catch {}

    // Dynamic anti-confusion / minimality detection
    const isTestProbe = /(test|try|probe|can we|check|verify|does|single|bench|quick|eval)/i.test(userPrompt);
    const isFullPipeline = /(full pipeline|full run|full train|all 3 stages|deploy|distill from scratch)/i.test(userPrompt);

    let digest = `\n<anchor-lab-context>\n`;
    digest += `# ⚓ ANCHOR LAB CO-PILOT CONTEXT & LIVE AGREE-STATE\n`;
    digest += `- **Project**: ${projName} | **Session**: ${sessionMeta.session_id || 'active'}\n`;
    digest += `- **Current Focus**: [${ctx.model || 'general'}] ${ctx.activity || 'research'}/${ctx.experiment || 'active'}\n`;
    digest += `- **Harvester Model**: ${modelRouter.getModel()}\n`;
    digest += `- **Compute Shield**: ENABLED (Route heavy runs to Colab/Kaggle/192.168.1.80)\n`;
    digest += `- **GPU Policy**: Never open a NEW Colab VM without Cody; if a VM is UP, USE IT. Kaggle CPU: launch freely.\n`;

    digest += `\n### 🧭 ACTIVE PLAN & PROGRESSION:\n`;
    digest += `- **Current Direction**: ${tips.current_plan_headline}\n`;
    digest += `- **Latest Validated Finding**: ${tips.latest_finding_headline}\n`;
    if (tips.active_scripts && tips.active_scripts.length) {
      digest += `- **Linked Tooling / Scripts**: ${tips.active_scripts.map(s => `\`${s}\``).join(', ')}\n`;
    }

    if (activeRuns.length > 0) {
      digest += `\n### ⚡ LIVE IN-FLIGHT RUNS:\n`;
      activeRuns.forEach(r => {
        digest += `• [${r.model}][${r.activity}/${r.experiment}] ${r.run_id}: Step ${r.progress.step || 0}/${r.progress.total_steps || '?'}, loss=${r.progress.loss || '?'}\n`;
      });
    }

    digest += `\n### 💡 PIPELINE MINIMALITY & ANTI-CONFUSION GUARD:\n`;
    if (isTestProbe && !isFullPipeline) {
      digest += `⚠️ **TARGETED TEST DETECTED**: Cody is testing a specific lever or hypothesis.\n`;
      digest += `   • Run ONLY the minimal isolated script/cell required to answer the question.\n`;
      digest += `   • DO NOT expand or escalate into the full 3-stage pipeline (Place → Recon → Distill).\n`;
      digest += `   • If the test does not work, isolate the minimal prerequisite lever to unblock it rather than rebuilding the full stack.\n`;
    } else if (isFullPipeline) {
      digest += `ℹ️ **FULL PIPELINE REQUESTED**: Ensure mandatory stage sequence: PLACE (gptq-rot) → RECON → DISTILLATION.\n`;
    } else {
      digest += `• ${tips.scope_tip}\n`;
    }

    // Guide Claude to present the banner and model confirmation when user starts or checks in
    if (/^(hi|hello|hey|start|setup|status|\/anchor|\/anchorsetup)/i.test(userPrompt.trim()) || userPrompt.length < 15) {
      digest += `\n[INSTRUCTION]: Greet Cody with the Anchor-Lab-Ai status banner and confirm today's active plan without drifting.\n`;
    }

    digest += `</anchor-lab-context>\n`;

    console.log(digest);
  } catch (e) {}
});
