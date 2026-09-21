#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STATUS_FILE = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/historical_status.json');

class HistoricalSynthesizer {
  constructor(
    baseProjectsDir = path.join(process.env.HOME || '/home/cody', '.claude/projects'),
    outputBase = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects/quantization-side-lab/historical')
  ) {
    this.baseProjectsDir = baseProjectsDir;
    this.outputBase = outputBase;
    if (!fs.existsSync(this.outputBase)) {
      fs.mkdirSync(this.outputBase, { recursive: true });
    }
  }

  writeStatus(statusObj) {
    try {
      const parentDir = path.dirname(STATUS_FILE);
      if (!fs.existsSync(parentDir)) {
        fs.mkdirSync(parentDir, { recursive: true });
      }
      fs.writeFileSync(STATUS_FILE, JSON.stringify(statusObj, null, 2), 'utf8');
    } catch {}
  }

  static getStatus() {
    try {
      if (fs.existsSync(STATUS_FILE)) {
        return JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
      }
    } catch {}

    // Fallback: check if historical artifacts already exist
    const outputBase = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects/quantization-side-lab/historical');
    const dossierPath = path.join(outputBase, 'HISTORICAL_DOSSIER.md');
    const leaderboardPath = path.join(outputBase, 'HISTORICAL_LEADERBOARD.json');
    const graveyardPath = path.join(outputBase, 'FAILURE_GRAVEYARD.md');

    if (fs.existsSync(dossierPath) && fs.existsSync(leaderboardPath)) {
      try {
        const leaderboard = JSON.parse(fs.readFileSync(leaderboardPath, 'utf8'));
        const stats = fs.statSync(dossierPath);
        return {
          status: 'completed',
          completed_at: stats.mtime.toISOString(),
          progress_pct: 100,
          best_ppl: leaderboard.length > 0 ? leaderboard[0].ppl : null,
          traps_found: fs.existsSync(graveyardPath) ? (fs.readFileSync(graveyardPath, 'utf8').match(/### Trap #/g) || []).length : 0,
          message: 'Historical synthesis archive is complete and verified.'
        };
      } catch {}
    }

    return {
      status: 'idle',
      progress_pct: 0,
      message: 'No historical scan is currently active. Use /anchorscan or anchor-lab-ai scan to begin.'
    };
  }

  // Subagent and workflow transcripts live in nested directories, so a flat
  // readdir sees only a fraction of a project's sessions.
  walkJsonl(dir) {
    const out = [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) out.push(...this.walkJsonl(full));
      else if (e.isFile() && e.name.endsWith('.jsonl')) out.push(full);
    }
    return out;
  }

  async scanProject(projectFolderName = '-home-cody-onebit-forge') {
    const folders = Array.isArray(projectFolderName) ? projectFolderName : [projectFolderName];
    const projectDirs = [];
    for (const name of folders) {
      if (name === '--all' || name === '*') {
        for (const e of fs.readdirSync(this.baseProjectsDir, { withFileTypes: true })) {
          if (e.isDirectory()) projectDirs.push(path.join(this.baseProjectsDir, e.name));
        }
      } else {
        projectDirs.push(path.join(this.baseProjectsDir, name));
      }
    }
    const existingDirs = projectDirs.filter(d => fs.existsSync(d));
    if (existingDirs.length === 0) {
      const err = { error: `Project directory not found: ${projectDirs.join(', ')}` };
      this.writeStatus({ status: 'error', error: err.error, message: err.error, updated_at: new Date().toISOString() });
      return err;
    }

    const files = [];
    for (const d of existingDirs) files.push(...this.walkJsonl(d));
    const startTime = new Date().toISOString();

    this.writeStatus({
      status: 'running',
      started_at: startTime,
      updated_at: startTime,
      total_files: files.length,
      files_scanned: 0,
      progress_pct: 0,
      current_file: '',
      traps_found: 0,
      best_ppl: null,
      message: `Starting scan of ${files.length} sessions in ${folders.join(', ')}...`
    });

    const summary = {
      project: folders.join(', '),
      total_sessions_scanned: files.length,
      runs_found: [],
      best_runs: [],
      failures: new Map(), // deduplicated by signature
      architectures: new Set(),
      hardware_traps: []
    };

    // Scientific PPL parser (handles decimals and scientific notation)
    const pplRegex = /\b(?:ppl|perplexity)[:=\s]+([0-9]+\.[0-9]+(?:e[+-]?[0-9]+)?)\b/gi;
    const lossRegex = /\b(?:loss|eval_loss)[:=\s]+([0-9]+\.[0-9]+)\b/i;

    // Real Python / CUDA execution error signatures
    const errorSignatures = [
      {
        name: 'CUDA Out Of Memory (OOM)',
        regex: /CUDA out of memory\. Tried to allocate ([0-9.]+\s*[GM]iB)/i,
        mitigation: 'Set PYTORCH_ALLOC_CONF=expandable_segments:True, reduce activation chunk size or use gradient checkpointing.'
      },
      {
        name: 'PyTorch Dtype Mismatch (BFloat16 != Float)',
        regex: /(?:expected mat1 and mat2 to have the same dtype, but got: c10::BFloat16 != float|self and mat2 must have the same dtype, but got Float and BFloat16)/i,
        mitigation: 'Ensure rotation matrices (_hrot) match activation tensors in BF16 before matrix multiplication.'
      },
      {
        name: 'Cross-Device Placement Conflict (cuda:0 vs cpu)',
        regex: /Expected all tensors to be on the same device, but (?:got mat1 is on cuda:0|found at least two devices)/i,
        mitigation: 'Explicitly enforce .to(device) on input streams during backward error correction.'
      },
      {
        name: 'GGUF / Quantization Row Alignment Error',
        regex: /Quantized tensor bytes per row \(([0-9]+)\) is not a multiple of ([A-Za-z0-9_]+) type size/i,
        mitigation: 'Pad weight matrix row dimensions to match type block alignment (divisible by 32/128).'
      },
      {
        name: 'llama.cpp GPU Kernel Missing (-ngl 99 divergence)',
        regex: /llama-perplexity -ngl 99 on our types returned PPL ([0-9.e+]+)/i,
        mitigation: 'Always use -ngl 0 (CPU vec_dot) for custom quantization containers until CUDA dequant kernel is compiled.'
      },
      {
        name: 'Transformers Model Architecture Unrecognized',
        regex: /The checkpoint you are trying to load has model type `([^`]+)` but Transformers does not recognize/i,
        mitigation: 'Pass trust_remote_code=True or upgrade transformers package to recognize new model types.'
      },
      {
        name: 'FakeQuantizer Scale Mapping Failure',
        regex: /ValueError: Can not map tensor '([^']+fake_quantizer\.scale)'/i,
        mitigation: 'Strip non-persistent fake_quantizer attributes before saving safetensors to ensure clean integer state.'
      }
    ];

    try {
      for (let i = 0; i < files.length; i++) {
        const filePath = files[i];
        const f = path.relative(this.baseProjectsDir, filePath);
        const sessionId = path.basename(filePath, '.jsonl');

        this.writeStatus({
          status: 'running',
          started_at: startTime,
          updated_at: new Date().toISOString(),
          total_files: files.length,
          files_scanned: i,
          progress_pct: Math.round((i / files.length) * 100),
          current_file: f,
          traps_found: summary.failures.size,
          best_ppl: summary.runs_found.length > 0 ? Math.min(...summary.runs_found.map(r => r.ppl)) : null,
          message: `Analyzing session ${i + 1}/${files.length} (${sessionId.slice(0, 8)})...`
        });

        try {
          const fileStream = fs.createReadStream(filePath);
          const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

          for await (const line of rl) {
            if (!line.trim()) continue;
            let textToScan = line;
            let outputText = '';

            try {
              const parsed = JSON.parse(line);
              // Tool output is the only trustworthy source of a MEASURED metric.
              // Assistant prose that merely mentions a number is not a benchmark.
              const tur = parsed.toolUseResult;
              if (tur) {
                if (typeof tur === 'string') outputText += ' ' + tur;
                if (tur.stdout) outputText += ' ' + tur.stdout;
                if (tur.stderr) outputText += ' ' + tur.stderr;
              }
            } catch {}
            textToScan += outputText;

            // Detect models / architectures
            if (/qwen[23]?\.[50]?[-_]0\.[58]b/i.test(textToScan)) summary.architectures.add('Qwen 0.5B / 0.8B');
            if (/taardis/i.test(textToScan)) summary.architectures.add('Taardis 0.8B');
            if (/q-tk-packing|q-tkintergers|tk_codec/i.test(textToScan)) summary.architectures.add('Q-TKInteger Base-3 Trits (Bit-Exact Containers)');
            if (/gptq-rot|hadamard/i.test(textToScan)) summary.architectures.add('Hadamard Rotation (GPTQ-Rot block 128)');
            if (/q1_0_g32/i.test(textToScan)) summary.architectures.add('Q1_0_g32 Packing');

            // Detect metrics & PPL, tagged by provenance.
            // 'measured' = emitted by a real command; 'mentioned' = discussed in prose.
            for (const [provenance, sourceText] of [['measured', outputText], ['mentioned', line]]) {
              if (!sourceText) continue;
              pplRegex.lastIndex = 0;
              let pplMatch;
              while ((pplMatch = pplRegex.exec(sourceText)) !== null) {
                const valStr = pplMatch[1];
                const val = parseFloat(valStr);
                // Real language model PPLs fall between 1.5 and 300. Ignore scientific notation divergence like 1.3e15
                if (valStr.toLowerCase().includes('e')) continue;
                if (!(val >= 1.5 && val <= 300.0)) continue;

                const ctx = sourceText.slice(Math.max(0, pplMatch.index - 80), pplMatch.index + 160);
                const after = sourceText.slice(pplMatch.index, pplMatch.index + 80);

                // "PPL 3.4 billion" - the captured float is a magnitude, not a score
                if (/\b(billion|million|trillion|thousand)\b/i.test(after.slice(0, 40))) continue;
                // "PPL 3.53 -> 1335.98" - the captured value is the pre-blowup number
                if (/^[^\n]{0,40}(->|\u2192)\s*[0-9]/.test(after)) continue;
                // Teacher / baseline / reference floors are not quantized results
                if (/\b(teacher|baseline|reference|fp16|fp32|bf16|floor|unquantized)\b/i.test(ctx)) continue;
                // Prose comparisons: "math ppl 2.3 vs finance 22.5"
                if (/\bvs\b/i.test(after.slice(0, 40))) continue;

                const lossMatch = sourceText.match(lossRegex);
                summary.runs_found.push({
                  session: sessionId,
                  provenance,
                  ppl: val,
                  loss: lossMatch ? parseFloat(lossMatch[1]) : null,
                  snippet: ctx
                });
              }
            }

            // Detect concrete failure signatures
            for (const sig of errorSignatures) {
              const match = textToScan.match(sig.regex);
              if (match && !summary.failures.has(sig.name)) {
                summary.failures.set(sig.name, {
                  title: sig.name,
                  session: sessionId,
                  matchedText: match[0],
                  mitigation: sig.mitigation,
                  snippet: textToScan.slice(Math.max(0, match.index - 50), match.index + 250).replace(/\\n/g, '\n')
                });
              }
            }
          }
        } catch (err) {}
      }

      // Rank ONLY measured metrics from real tool output. Prose mentions are
      // kept for audit but never presented as benchmarks.
      const measuredRuns = summary.runs_found.filter(r => r.provenance === 'measured');
      summary.measured_count = measuredRuns.length;
      summary.mentioned_count = summary.runs_found.length - measuredRuns.length;
      const uniqueRunsMap = new Map();
      for (const r of measuredRuns) {
        const key = r.ppl.toFixed(4);
        if (!uniqueRunsMap.has(key)) {
          uniqueRunsMap.set(key, r);
        }
      }
      const deduplicatedRuns = Array.from(uniqueRunsMap.values());
      deduplicatedRuns.sort((a, b) => a.ppl - b.ppl);
      summary.best_runs = deduplicatedRuns.slice(0, 10);

      // Write isolated historical records
      this.saveHistoricalRecords(summary);

      // Record final completed status
      this.writeStatus({
        status: 'completed',
        started_at: startTime,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        total_files: files.length,
        files_scanned: files.length,
        progress_pct: 100,
        best_ppl: summary.best_runs.length > 0 ? summary.best_runs[0].ppl : null,
        traps_found: summary.failures.size,
        architectures: Array.from(summary.architectures),
        message: `Synthesis complete: ${files.length} sessions analyzed, ${summary.failures.size} traps documented, best PPL: ${summary.best_runs.length > 0 ? summary.best_runs[0].ppl.toFixed(4) : 'N/A'}`
      });

      return summary;
    } catch (err) {
      this.writeStatus({
        status: 'error',
        error: err.message,
        failed_at: new Date().toISOString(),
        message: `Historical scan failed: ${err.message}`
      });
      throw err;
    }
  }

  saveHistoricalRecords(summary) {
    // 1. HISTORICAL_LEADERBOARD.json
    const leaderboardPath = path.join(this.outputBase, 'HISTORICAL_LEADERBOARD.json');
    fs.writeFileSync(leaderboardPath, JSON.stringify(summary.best_runs, null, 2), 'utf8');

    // 2. FAILURE_GRAVEYARD.md
    const failurePath = path.join(this.outputBase, 'FAILURE_GRAVEYARD.md');
    let failMd = `# Failure Graveyard (Historical Anti-Patterns & Traps)\n\n`;
    failMd += `*Isolated historical record of what failed, crashed, or drifted before Anchor-Lab-Ai.*\n\n`;

    let trapIdx = 1;
    for (const [_, f] of summary.failures) {
      failMd += `### Trap #${trapIdx++}: ${f.title}\n`;
      failMd += `- **Session**: \`${f.session}\`\n`;
      failMd += `- **Error Signature**: \`${f.matchedText.slice(0, 120)}\`\n`;
      failMd += `- **Recommended Mitigation**: ${f.mitigation}\n`;
      failMd += `\`\`\`text\n${f.snippet.slice(0, 300)}\n\`\`\`\n\n`;
    }
    fs.writeFileSync(failurePath, failMd, 'utf8');

    // 3. HISTORICAL_DOSSIER.md
    const dossierPath = path.join(this.outputBase, 'HISTORICAL_DOSSIER.md');
    let md = `# Historical Project Synthesis Dossier\n\n`;
    md += `> [!NOTE]\n`;
    md += `> This dossier was synthesized by Anchor-Lab-Ai from ${summary.total_sessions_scanned} transcripts.\n`;
    md += `> It is stored in the **isolated historical archive** to prevent contamination of new runs.\n\n`;

    md += `## 1. Architectures & Techniques Explored\n`;
    Array.from(summary.architectures).forEach(a => {
      md += `- **${a}**\n`;
    });

    md += `\n## 2. Measured Empirical Results (Lowest Perplexity)\n\n`;
    md += `*Only values emitted by real command output are ranked. ${summary.mentioned_count || 0} additional PPL figures appeared in prose and were excluded as non-benchmarks.*\n\n`;
    md += `| Rank | PPL | Loss | Session ID | Status |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    summary.best_runs.forEach((r, idx) => {
      md += `| #${idx + 1} | **${r.ppl.toFixed(4)}** | ${r.loss !== null ? r.loss.toFixed(4) : 'N/A'} | \`${r.session.slice(0, 16)}...\` | Measured (tool output) |\n`;
    });

    md += `\n## 3. Key Historical Traps & Defenses\n`;
    md += `Documented **${summary.failures.size} critical failure traps** with permanent mitigations in [FAILURE_GRAVEYARD.md](./FAILURE_GRAVEYARD.md):\n\n`;
    for (const [_, f] of summary.failures) {
      md += `- **${f.title}**: ${f.mitigation}\n`;
    }

    fs.writeFileSync(dossierPath, md, 'utf8');
  }
}

if (require.main === module) {
  const synth = new HistoricalSynthesizer();
  const targets = process.argv.slice(2).filter(a => a.trim());
  const scanArg = targets.length ? targets : undefined;
  console.log(`[HISTORICAL SYNTHESIZER]: Scanning past sessions in ~/.claude/projects/ (${scanArg ? scanArg.join(', ') : 'default project'}) ...`);
  synth.scanProject(scanArg).then(res => {
    if (res && res.error) { console.error(`\u2716 ${res.error}`); process.exitCode = 1; return; }
    console.log(`\n✔ Historical Synthesis Complete!`);
    console.log(`• Sessions Scanned: ${res.total_sessions_scanned}`);
    console.log(`• Architectures Found: ${Array.from(res.architectures).join(', ')}`);
    console.log(`• Measured PPL values: ${res.measured_count} (prose mentions excluded: ${res.mentioned_count})`);
    console.log(`• Best Measured PPL: ${res.best_runs.length > 0 ? res.best_runs[0].ppl : 'N/A'}`);
    console.log(`• Critical Failure Traps Documented: ${res.failures.size}`);
    console.log(`• Isolated files updated in ~/.anchor-lab-ai/projects/quantization-side-lab/historical/`);
  });
}

module.exports = HistoricalSynthesizer;
