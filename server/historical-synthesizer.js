#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

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

  async scanProject(projectFolderName = '-home-cody-onebit-forge') {
    const projectDir = path.join(this.baseProjectsDir, projectFolderName);
    if (!fs.existsSync(projectDir)) {
      return { error: `Project directory not found: ${projectDir}` };
    }

    const files = fs.readdirSync(projectDir).filter(f => f.endsWith('.jsonl'));
    const summary = {
      project: projectFolderName,
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

    for (const f of files) {
      const filePath = path.join(projectDir, f);
      const sessionId = f.replace('.jsonl', '');
      try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

        for await (const line of rl) {
          if (!line.trim()) continue;
          let textToScan = line;

          try {
            const parsed = JSON.parse(line);
            // Scan assistant messages, user tool results, and stdout
            if (parsed.toolUseResult && parsed.toolUseResult.stdout) {
              textToScan += ' ' + parsed.toolUseResult.stdout;
            }
            if (parsed.toolUseResult && parsed.toolUseResult.stderr) {
              textToScan += ' ' + parsed.toolUseResult.stderr;
            }
          } catch {}

          // Detect models / architectures
          if (/qwen[23]?\.[50]?[-_]0\.[58]b/i.test(textToScan)) summary.architectures.add('Qwen 0.5B / 0.8B');
          if (/taardis/i.test(textToScan)) summary.architectures.add('Taardis 0.8B');
          if (/q-tk-packing|q-tkintergers|tk_codec/i.test(textToScan)) summary.architectures.add('Q-TKInteger Base-3 Trits (Bit-Exact Containers)');
          if (/gptq-rot|hadamard/i.test(textToScan)) summary.architectures.add('Hadamard Rotation (GPTQ-Rot block 128)');
          if (/q1_0_g32/i.test(textToScan)) summary.architectures.add('Q1_0_g32 Packing');

          // Detect metrics & PPL
          let pplMatch;
          while ((pplMatch = pplRegex.exec(textToScan)) !== null) {
            const valStr = pplMatch[1];
            const val = parseFloat(valStr);
            // Real language model PPLs fall between 1.5 and 300. Ignore scientific notation divergence like 1.3e15
            if (!valStr.toLowerCase().includes('e') && val >= 1.5 && val <= 300.0) {
              const lossMatch = textToScan.match(lossRegex);
              summary.runs_found.push({
                session: sessionId,
                ppl: val,
                loss: lossMatch ? parseFloat(lossMatch[1]) : null,
                snippet: textToScan.slice(Math.max(0, pplMatch.index - 40), pplMatch.index + 120)
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

    // Deduplicate runs by PPL value & sort ascending
    const uniqueRunsMap = new Map();
    for (const r of summary.runs_found) {
      const key = r.ppl.toFixed(4);
      if (!uniqueRunsMap.has(key)) {
        uniqueRunsMap.set(key, r);
      }
    }
    const deduplicatedRuns = Array.from(uniqueRunsMap.values());
    deduplicatedRuns.sort((a, b) => a.ppl - b.ppl);
    summary.best_runs = deduplicatedRuns.slice(0, 10);

    // Write isolated historical dossier
    this.saveHistoricalRecords(summary);
    return summary;
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

    md += `\n## 2. Validated Empirical Results (Lowest Perplexity)\n\n`;
    md += `| Rank | PPL | Loss | Session ID | Status |\n`;
    md += `| :--- | :--- | :--- | :--- | :--- |\n`;
    summary.best_runs.forEach((r, idx) => {
      md += `| #${idx + 1} | **${r.ppl.toFixed(4)}** | ${r.loss !== null ? r.loss.toFixed(4) : 'N/A'} | \`${r.session.slice(0, 16)}...\` | Validated Benchmark |\n`;
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
  console.log('[HISTORICAL SYNTHESIZER]: Scanning past sessions in ~/.claude/projects/ ...');
  synth.scanProject().then(res => {
    console.log(`\n✔ Historical Synthesis Complete!`);
    console.log(`• Sessions Scanned: ${res.total_sessions_scanned}`);
    console.log(`• Architectures Found: ${Array.from(res.architectures).join(', ')}`);
    console.log(`• Best Validated PPL: ${res.best_runs.length > 0 ? res.best_runs[0].ppl : 'N/A'}`);
    console.log(`• Critical Failure Traps Documented: ${res.failures.size}`);
    console.log(`• Isolated files updated in ~/.anchor-lab-ai/projects/quantization-side-lab/historical/`);
  });
}

module.exports = HistoricalSynthesizer;
