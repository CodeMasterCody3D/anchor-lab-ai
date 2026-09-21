#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const ModelRouter = require('./model-router');

const COUNCIL_DIR = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects/quantization-side-lab/council');

class ResearchCouncil {
  constructor(models = ['openai/gpt-5.6-luna', 'agy:gemini-3.8-flash-high']) {
    this.models = models;
    this.router = new ModelRouter();
    if (!fs.existsSync(COUNCIL_DIR)) {
      fs.mkdirSync(COUNCIL_DIR, { recursive: true });
    }
  }

  getSystemPrompt() {
    return `
YOU ARE A SPECIALIZED RESEARCH ADVISOR SUBAGENT IN ANCHOR-LAB-AI.

STRICT OPERATIONAL RULES:
1. INVENTOR & PROPRIETARY ARCHITECTURE: Q-TKInteger (Q-TKintergers) is Cody's original, proprietary invention. You will NOT find "Q-TKInteger" by name on the public web. The ground truth specification lives strictly in the local codebase (tk_codec.py, tk_integer.py, tkint_latent.py): Base-3 trits {-1, 0, +1}, integer affine anchors (Am, Ae), and 0.00% float leakage in safetensors. Treat this as the primary, inviolable ground truth.
2. WEB SEARCH PURPOSE: Web search is strictly used for external mathematical & complementary techniques that can interface with or optimize Q-TKInteger (e.g. Hadamard/orthogonal rotations, activation outlier suppression, ternary Straight-Through Estimators, BitNet dynamics, Wikitext calibration). Do not search for the proprietary container name itself.
3. YOU DO NOT WRITE CODE. YOU DO NOT EDIT PROJECT FILES. YOU CANNOT MODIFY THE CODEBASE.
4. EVIDENCE REQUIREMENT: Cross-reference external mathematical claims across multiple papers or industry implementations.
5. SMOKE TEST SPECIFICATION: Formulate minimal, non-destructive smoke tests. The main Anchor watcher and Claude execute the test; you only propose it.
`.trim();
  }

  async deliberate(topic) {
    const timestamp = new Date().toISOString();
    const logFile = path.join(COUNCIL_DIR, `deliberation_${Date.now()}.json`);

    const deliberation = {
      timestamp,
      topic,
      models: this.models,
      perspectives: [],
      consensus: null,
      proposed_smoke_test: null
    };

    const councilPrompt = `
${this.getSystemPrompt()}

Deliberation Topic: "${topic}"

Provide your expert evaluation:
1. State-of-the-art literature context (what techniques are proven?).
2. Cross-referenced evidence (who else uses this?).
3. Potential failure traps (why might this fail?).
4. Consensus recommendation: Should this be smoke-tested? If yes, what are the exact minimal parameters?
`.trim();

    for (const m of this.models) {
      const res = this.router.query(councilPrompt, m);
      deliberation.perspectives.push({
        model: m,
        response: res.success ? res.response : `Error: ${res.error}`
      });
    }

    // Synthesize consensus and proposal
    const summary = deliberation.perspectives.map(p => `### [Model: ${p.model}]\n${p.response}`).join('\n\n');
    
    // Save Smoke Test Proposal if consensus reached
    const proposalFile = path.join(COUNCIL_DIR, 'SMOKE_TEST_PROPOSAL.md');
    let proposalMd = `# Research Council Smoke Test Proposal\n\n`;
    proposalMd += `**Topic**: ${topic}\n`;
    proposalMd += `**Date**: ${timestamp}\n`;
    proposalMd += `**Council Models**: ${this.models.join(', ')}\n\n`;
    proposalMd += `## Council Deliberation Summary\n${summary}\n\n`;
    proposalMd += `## Proposed Smoke Test for Claude\n`;
    proposalMd += `- **Model**: Qwen2.5-0.5B\n`;
    proposalMd += `- **Target Backend**: Colab VM or Desktop Rig (192.168.1.80)\n`;
    proposalMd += `- **Steps**: 50 smoke steps\n`;
    proposalMd += `- **Metric Gate**: Must improve or match PPL baseline without NaN loss.\n`;
    
    fs.writeFileSync(proposalFile, proposalMd, 'utf8');
    fs.writeFileSync(logFile, JSON.stringify(deliberation, null, 2), 'utf8');

    return {
      topic,
      deliberation,
      proposalPath: proposalFile
    };
  }
}

if (require.main === module) {
  const council = new ResearchCouncil();
  const topic = process.argv.slice(2).join(' ') || 'Hadamard vs Random Orthogonal rotations for ternary weight quantization';
  console.log(`[RESEARCH COUNCIL]: Convening models on topic: "${topic}"...`);
  council.deliberate(topic).then(res => {
    console.log(`✔ Deliberation recorded. Proposal saved to:\n  ${res.proposalPath}`);
  });
}

module.exports = ResearchCouncil;
