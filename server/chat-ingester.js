#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const SessionRouter = require('./session-router');
const { getProjectBaseDir } = require('./project-resolver');

class ChatIngester {
  constructor(runtimeDir = null) {
    this.runtimeDir = runtimeDir || path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai');
    this.router = new SessionRouter(this.runtimeDir);
  }

  getTodayDateString() {
    return new Date().toISOString().split('T')[0];
  }

  /**
   * Reads tail chunk of transcript for sub-second ingestion
   */
  readTodayTurns(transcriptPath, targetDateStr = null) {
    const todayStr = targetDateStr || this.getTodayDateString();
    if (!transcriptPath || !fs.existsSync(transcriptPath)) {
      return [];
    }

    try {
      const stats = fs.statSync(transcriptPath);
      const fileSize = stats.size;
      const chunkSize = Math.min(fileSize, 40 * 1024 * 1024); // 40MB tail chunk

      const fd = fs.openSync(transcriptPath, 'r');
      const buffer = Buffer.alloc(chunkSize);
      fs.readSync(fd, buffer, 0, chunkSize, fileSize - chunkSize);
      fs.closeSync(fd);

      const content = buffer.toString('utf8');
      const rawLines = content.split('\n');
      // If we read a slice, skip the first line in case it was partially read
      const lines = (chunkSize < fileSize) ? rawLines.slice(1) : rawLines;

      const turns = [];
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const item = JSON.parse(line);
          const ts = item.timestamp || '';
          if (ts.startsWith(todayStr)) {
            turns.append ? turns.append(item) : turns.push(item);
          }
        } catch {}
      }

      return turns;
    } catch (err) {
      return [];
    }
  }

  /**
   * Ingests transcript, analyzes agreements between Cody and Claude, and synthesizes notes
   */
  ingestSession(cwd = null, sessionId = null, targetDateStr = null) {
    const sessionInfo = this.router.findTranscriptForSession(cwd, sessionId) || this.router.getActiveSession(cwd);
    const targetDate = targetDateStr || this.getTodayDateString();
    const projDir = sessionInfo.project_dir || getProjectBaseDir();
    const projName = path.basename(projDir);
    const projectStorageDir = path.join(this.runtimeDir, 'projects', projName);
    
    if (!fs.existsSync(projectStorageDir)) {
      fs.mkdirSync(projectStorageDir, { recursive: true });
    }

    const turns = this.readTodayTurns(sessionInfo.transcript_path, targetDate);
    const findings = [];
    const activePlans = [];
    const userDirectives = [];
    const scriptsReferenced = new Set();
    const runsReferenced = new Set();

    for (const turn of turns) {
      const turnType = turn.type;
      const ts = turn.timestamp || '';

      if (turnType === 'user') {
        let text = '';
        const c = turn.message ? turn.message.content : turn.content;
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) {
          text = c.map(item => item.text || '').join(' ');
        }

        if (text && text.length > 5) {
          // Detect user questions or directions
          if (/(can we|what if|test|try|run|merge|check|does|let's|look at)/i.test(text)) {
            userDirectives.push({ timestamp: ts, text: text.trim() });
          }
        }
      } else if (turnType === 'assistant') {
        let text = '';
        const c = turn.message ? turn.message.content : turn.content;
        if (typeof c === 'string') text = c;
        else if (Array.isArray(c)) {
          text = c.map(item => item.text || '').join(' ');
        }

        if (!text) continue;

        // Extract referenced scripts (.py) and run slugs
        const pyMatches = text.match(/[\w-]+\.py\b/g);
        if (pyMatches) {
          pyMatches.forEach(s => scriptsReferenced.add(s));
        }

        const runMatches = text.match(/qwen[\w-]+|[\w-]+\d{4}\b/gi);
        if (runMatches) {
          runMatches.forEach(r => {
            if (r.includes('mergetest') || r.includes('roleswap') || r.includes('chain') || r.includes('rot')) {
              runsReferenced.add(r);
            }
          });
        }

        // Detect verified findings & verdicts
        if (/(# ✅|verdict:|VERDICT:|viable|CE_before|gain survives|trit churn|zero churn|all-clear|bit-identical)/i.test(text)) {
          const paragraphs = text.split(/\n\s*\n/);
          for (const para of paragraphs) {
            if (/(merge is viable|survives the fold|role-swap verdict|branches do the work|bit-identical|gain survives|churn is tiny)/i.test(para)) {
              const clean = para.trim();
              if (clean.length > 30 && !findings.some(f => f.text === clean)) {
                // Extract title / headline
                const firstLine = clean.split('\n')[0].replace(/^[#\s*`✅\-]+/, '').trim();
                findings.push({
                  timestamp: ts,
                  title: firstLine || 'Experiment Verdict',
                  text: clean,
                  verified: true
                });
              }
            }
          }
        }

        // Detect active plans & pipeline directions
        if (/(next step|plan now is|now the plan|closes the arc|next up|next:|we will now)/i.test(text)) {
          const paragraphs = text.split(/\n\s*\n/);
          for (const para of paragraphs) {
            if (/(next step|now the plan|closes the arc|next:|we will now)/i.test(para)) {
              const clean = para.trim();
              if (clean.length > 30 && !activePlans.some(p => p.text === clean)) {
                activePlans.push({
                  timestamp: ts,
                  text: clean
                });
              }
            }
          }
        }
      }
    }

    // Determine current pipeline context & minimality guard
    const latestPlan = activePlans[activePlans.length - 1] ? activePlans[activePlans.length - 1].text : 'Iterative research and minimal hypothesis testing';
    const latestFinding = findings[findings.length - 1] ? findings[findings.length - 1].text : 'Baseline calibrations active';
    const scriptsList = Array.from(scriptsReferenced);
    const runsList = Array.from(runsReferenced);

    // 1. Write CONFIRMED_FINDINGS.md
    const findingsFile = path.join(projectStorageDir, 'CONFIRMED_FINDINGS.md');
    let findingsMd = `# 📜 Confirmed Project Findings & Validated Tests\n\n`;
    findingsMd += `> Project: \`${projName}\` | Target Date: ${targetDate}\n`;
    findingsMd += `> Verified Consensus: **Cody (Direction) ⇄ Claude (Execution/Measurement) ⇄ Anchor (Ledger)**\n\n`;

    if (findings.length > 0) {
      findings.forEach((f, idx) => {
        findingsMd += `### Finding #${idx + 1}: ${f.title}\n`;
        findingsMd += `*Logged At: ${f.timestamp}*\n\n`;
        findingsMd += `${f.text}\n\n`;
        findingsMd += `---\n\n`;
      });
    } else {
      findingsMd += `*No finalized verdicts logged yet for ${targetDate}. Running experiments in flight.*\n\n`;
    }

    findingsMd += `### 🛠️ Associated Tooling & Kernels Tested Today:\n`;
    findingsMd += `- **Scripts**: ${scriptsList.length ? scriptsList.map(s => `\`${s}\``).join(', ') : 'None'}\n`;
    findingsMd += `- **Kernels / Runs**: ${runsList.length ? runsList.map(r => `\`${r}\``).join(', ') : 'None'}\n`;

    fs.writeFileSync(findingsFile, findingsMd, 'utf8');

    // 2. Write ACTIVE_PLAN.md
    const planFile = path.join(projectStorageDir, 'ACTIVE_PLAN.md');
    let planMd = `# 🧭 Active Plan & Pipeline Direction\n\n`;
    planMd += `> Last Updated: ${new Date().toISOString()} | Session: \`${sessionInfo.session_id || 'active'}\`\n\n`;
    planMd += `## 🎯 Current Operational Focus\n\n`;
    planMd += `${latestPlan}\n\n`;

    planMd += `## 💡 Pipeline Minimality Invariant (Anti-Confusion Guard)\n`;
    planMd += `- **Single-Task Rule**: If the task is testing 1 simple idea or lever (e.g. testing merge folding or checking if zero-branches attach), run **ONLY** the minimal test script/cell.\n`;
    planMd += `- **No Accidental Recipe Escalation**: Do NOT invoke the full 3-stage pipeline (Place → Recon → Distill) for an isolated probe.\n`;
    planMd += `- **Minimal Recovery**: If a test fails, find the minimal prerequisite lever needed to test it rather than rebuilding the full stack.\n\n`;

    if (userDirectives.length > 0) {
      planMd += `## 🗣️ Recent User Directives & Questions:\n`;
      userDirectives.slice(-5).forEach(d => {
        planMd += `- *[${d.timestamp.split('T')[1].slice(0, 5)}]* ${d.text}\n`;
      });
      planMd += '\n';
    }

    fs.writeFileSync(planFile, planMd, 'utf8');

    // 3. Write FINDINGS_LEDGER.json
    const ledgerFile = path.join(projectStorageDir, 'FINDINGS_LEDGER.json');
    const ledgerPayload = {
      project: projName,
      session_id: sessionInfo.session_id,
      date: targetDate,
      last_updated: new Date().toISOString(),
      findings_count: findings.length,
      findings,
      latest_plan: latestPlan,
      scripts_referenced: scriptsList,
      runs_referenced: runsList,
      user_directives_count: userDirectives.length
    };
    fs.writeFileSync(ledgerFile, JSON.stringify(ledgerPayload, null, 2), 'utf8');

    // 4. Write live_tips.json for real-time prompt injection
    const tipsFile = path.join(projectStorageDir, 'live_tips.json');
    const liveTips = {
      project: projName,
      session_id: sessionInfo.session_id,
      latest_finding_headline: findings[findings.length - 1] ? findings[findings.length - 1].title : 'Testing in flight',
      current_plan_headline: latestPlan.split('\n')[0].replace(/^[#\s*`\-]+/, '').slice(0, 160),
      active_scripts: scriptsList.slice(0, 5),
      scope_tip: 'Scope Check: If testing a single lever/idea, run the minimal isolated probe. Never expand into the full 3-stage training pipeline unless Cody explicitly calls for the complete run.'
    };
    fs.writeFileSync(tipsFile, JSON.stringify(liveTips, null, 2), 'utf8');

    return {
      success: true,
      project: projName,
      session_id: sessionInfo.session_id,
      turns_scanned: turns.length,
      findings_count: findings.length,
      latest_finding: findings[findings.length - 1] || null,
      latest_plan: latestPlan,
      findingsFile,
      planFile,
      ledgerFile
    };
  }
}

if (require.main === module) {
  const ingester = new ChatIngester();
  const res = ingester.ingestSession();
  console.log(`\n✔ Ingestion Complete for project: ${res.project} (Session: ${res.session_id})`);
  console.log(`• Turns Scanned: ${res.turns_scanned}`);
  console.log(`• Confirmed Findings: ${res.findings_count}`);
  console.log(`• Findings Doc: ${res.findingsFile}`);
  console.log(`• Active Plan Doc: ${res.planFile}\n`);
}

module.exports = ChatIngester;
