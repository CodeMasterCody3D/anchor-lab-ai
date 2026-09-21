#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const PartitionManager = require('/home/cody/.anchor-lab-ai/server/partition-manager');
const ModelRouter = require('/home/cody/.anchor-lab-ai/server/model-router');

const partitionMgr = new PartitionManager();
const modelRouter = new ModelRouter();

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  try {
    let userPrompt = '';
    try {
      const parsed = JSON.parse(input);
      userPrompt = parsed.prompt || parsed.text || '';
    } catch {}

    const activeRuns = partitionMgr.listActiveRuns();
    const ctxFile = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/active_context.json');
    let ctx = { model: 'qwen2.5-0.5b', activity: 'training', experiment: 'recon-window' };
    try {
      if (fs.existsSync(ctxFile)) {
        ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
      }
    } catch {}

    let digest = `[ANCHOR-LAB-AI DIGEST]\n`;
    digest += `Current Focus: [${ctx.model || 'general'}] ${ctx.activity || 'research'}/${ctx.experiment || 'active'}\n`;
    digest += `Active Harvester Model: ${modelRouter.getModel()}\n`;
    digest += `Compute Shield: ENABLED (No heavy training on localhost laptop. Route to Colab/Kaggle/192.168.1.80)\n`;
    digest += `Verbose Logging Rule: All scripts MUST use unbuffered stdout (guarded hasattr(sys.stdout, 'reconfigure')) and print live per-step updates.\n`;
    digest += `Target Baselines: 8-bit PPL 9.94754 | 1-bit PPL 11.58607 | Q-TKintergers Base-3\n`;

    if (activeRuns.length > 0) {
      digest += `Live In-Flight Runs:\n`;
      activeRuns.forEach(r => {
        digest += `• [${r.model}][${r.activity}/${r.experiment}] ${r.run_id}: Step ${r.progress.step || 0}/${r.progress.total_steps || '?'}, loss=${r.progress.loss || '?'}\n`;
      });
    }

    // Guide Claude to present the banner and model confirmation when user starts or checks in
    if (/^(hi|hello|hey|start|setup|status|\/anchor|\/anchorsetup)/i.test(userPrompt.trim()) || userPrompt.length < 15) {
      digest += `\n[INSTRUCTION]: Greet Cody with the Anchor-Lab-Ai status banner and ask which harvester model he wants to use (highlighting openai/gpt-5.6-luna as default, along with OpenRouter :free and AGY options).\n`;
    }

    console.log(digest);
  } catch (e) {}
});
