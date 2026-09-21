#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');

const STATUS_FILE = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/historical_status.json');
const MEMORY_DB = path.join(process.env.HOME || '/home/cody', '.claude-mem/claude-mem.db');

// Real Python / CUDA execution error signatures
const ERROR_SIGNATURES = [
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

// Scientific PPL parser (handles decimals and scientific notation)
const PPL_REGEX_SRC = /\b(?:ppl|perplexity)[:=\s]+([0-9]+\.[0-9]+(?:e[+-]?[0-9]+)?)\b/gi;
const LOSS_REGEX = /\b(?:loss|eval_loss)[:=\s]+([0-9]+\.[0-9]+)\b/i;


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

  async scanProject(projectFolderName = '-home-cody-onebit-forge', opts = {}) {
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

            this.detectArchitectures(textToScan, summary);

            this.extractMetrics(outputText, 'measured', sessionId, summary);
            this.extractMetrics(line, 'mentioned', sessionId, summary);

            this.detectFailures(textToScan, sessionId, summary);
          }
        } catch (err) {}
      }

      // Second source: claude-mem retains distilled history from sessions whose
      // raw transcripts Claude Code has already pruned.
      if (!opts.skipMemory) {
        this.writeStatus({
          status: 'running', started_at: startTime, updated_at: new Date().toISOString(),
          total_files: files.length, files_scanned: files.length, progress_pct: 99,
          current_file: 'claude-mem.db', traps_found: summary.failures.size, best_ppl: null,
          message: 'Reading claude-mem database for pre-retention history...'
        });
        this.scanMemoryDb(summary, opts);
      }

      // Rank ONLY measured metrics from real command output. Recalled (distilled)
      // and mentioned (prose) values are kept for history but never ranked.
      const measuredRuns = summary.runs_found.filter(r => r.provenance === 'measured');
      const recalledRuns = summary.runs_found.filter(r => r.provenance === 'recalled');
      summary.measured_count = measuredRuns.length;
      summary.recalled_count = recalledRuns.length;
      summary.mentioned_count = summary.runs_found.length - measuredRuns.length - recalledRuns.length;

      // Chronological archive of recalled history, deduplicated per (date, ppl).
      const archiveMap = new Map();
      for (const r of recalledRuns) {
        const key = `${(r.date || '').slice(0, 10)}|${r.ppl.toFixed(4)}`;
        if (!archiveMap.has(key)) archiveMap.set(key, r);
      }
      summary.archive_runs = Array.from(archiveMap.values())
        .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
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

  // Transcript JSON stores newlines as the two characters \ and n. Left alone,
  // that trailing 'n' fuses onto the next word ("\nteacher" -> "nteacher") and
  // every \b-anchored guard below silently fails to match.
  static normalise(text) {
    return String(text == null ? '' : text).replace(/\\[nrt]/g, ' ');
  }

  detectArchitectures(raw, summary) {
    const text = HistoricalSynthesizer.normalise(raw);
    if (!text) return;
    if (/qwen[23]?\.[50]?[-_]0\.[58]b/i.test(text)) summary.architectures.add('Qwen 0.5B / 0.8B');
    if (/taardis/i.test(text)) summary.architectures.add('Taardis 0.8B');
    if (/q-tk-packing|q-tkintergers|tk_codec/i.test(text)) summary.architectures.add('Q-TKInteger Base-3 Trits (Bit-Exact Containers)');
    if (/gptq-rot|hadamard/i.test(text)) summary.architectures.add('Hadamard Rotation (GPTQ-Rot block 128)');
    if (/q1_0_g32/i.test(text)) summary.architectures.add('Q1_0_g32 Packing');
  }

  detectFailures(raw, sessionId, summary, extra = {}) {
    const text = HistoricalSynthesizer.normalise(raw);
    if (!text) return;
    for (const sig of ERROR_SIGNATURES) {
      const match = text.match(sig.regex);
      if (match && !summary.failures.has(sig.name)) {
        summary.failures.set(sig.name, Object.assign({
          title: sig.name,
          session: sessionId,
          matchedText: match[0],
          mitigation: sig.mitigation,
          snippet: text.slice(Math.max(0, match.index - 50), match.index + 250)
        }, extra));
      }
    }
  }

  // Provenance tiers:
  //   measured  - emitted by a real command (transcript stdout/stderr, or a stored tool_response)
  //   recalled  - distilled by claude-mem from a session whose raw transcript has since been pruned
  //   mentioned - merely discussed in prose; recorded for audit but never ranked
  extractMetrics(raw, provenance, sessionId, summary, extra = {}) {
    const sourceText = HistoricalSynthesizer.normalise(raw);
    if (!sourceText) return;
    const rx = new RegExp(PPL_REGEX_SRC.source, 'gi');
    let m;
    while ((m = rx.exec(sourceText)) !== null) {
      const valStr = m[1];
      const val = parseFloat(valStr);
      // Real language model PPLs fall between 1.5 and 300. Ignore scientific notation divergence like 1.3e15
      if (valStr.toLowerCase().includes('e')) continue;
      if (!(val >= 1.5 && val <= 300.0)) continue;

      const ctx = sourceText.slice(Math.max(0, m.index - 80), m.index + 160);
      const after = sourceText.slice(m.index, m.index + 80);

      // "PPL 3.4 billion" - the captured float is a magnitude, not a score
      if (/\b(billion|million|trillion|thousand)\b/i.test(after.slice(0, 40))) continue;
      // "PPL 3.53 -> 1335.98" - the captured value is the pre-blowup number
      if (/^[^\n]{0,40}(->|→)\s*[0-9]/.test(after)) continue;
      // Teacher / baseline / reference floors are not quantized results
      if (/\b(teacher|baseline|reference|fp16|fp32|bf16|floor|unquantized)\b/i.test(ctx)) continue;
      // Prose comparisons: "math ppl 2.3 vs finance 22.5"
      if (/\bvs\b/i.test(after.slice(0, 40))) continue;

      const lossMatch = sourceText.match(LOSS_REGEX);
      summary.runs_found.push(Object.assign({
        session: sessionId,
        provenance,
        ppl: val,
        loss: lossMatch ? parseFloat(lossMatch[1]) : null,
        snippet: ctx
      }, extra));
    }
  }

  // Claude Code prunes raw transcripts on a rolling cleanupPeriodDays window,
  // but claude-mem keeps distilled observations far longer. For any project
  // older than that window the database is the ONLY surviving record, so it is
  // scanned as a second source and tagged 'recalled' to keep it distinguishable
  // from values a command actually printed.
  scanMemoryDb(summary, opts = {}) {
    const dbPath = opts.dbPath || MEMORY_DB;
    const coverage = { available: false, db_path: dbPath };

    if (!fs.existsSync(dbPath)) {
      coverage.error = 'claude-mem database not found';
      summary.memory_coverage = coverage;
      return coverage;
    }

    let DatabaseSync;
    // node:sqlite is stable enough for a read-only query but still emits an
    // ExperimentalWarning that would otherwise corrupt the CLI's report output.
    const emitWarning = process.emitWarning;
    process.emitWarning = function (warning, ...rest) {
      if (String(warning).includes('SQLite is an experimental feature')) return;
      return emitWarning.call(process, warning, ...rest);
    };
    try {
      ({ DatabaseSync } = require('node:sqlite'));
    } catch (e) {
      process.emitWarning = emitWarning;
      coverage.error = `node:sqlite unavailable (${e.message}); Node 22+ required`;
      summary.memory_coverage = coverage;
      return coverage;
    }

    let db;
    try {
      db = new DatabaseSync(dbPath, { readOnly: true });
    } catch (e) {
      process.emitWarning = emitWarning;
      coverage.error = `could not open claude-mem db read-only: ${e.message}`;
      summary.memory_coverage = coverage;
      return coverage;
    }

    const before = summary.runs_found.length;
    let rows = 0;

    try {
      // Stored tool responses are genuine command output -> 'measured'.
      try {
        const sql = 'SELECT memory_session_id AS sid, project, created_at, tool_response'
          + ' FROM tool_uses WHERE tool_response IS NOT NULL';
        for (const r of db.prepare(sql).all()) {
          rows++;
          const text = String(r.tool_response || '');
          if (!text.trim()) continue;
          const meta = { source: 'claude-mem:tool_uses', date: r.created_at, mem_project: r.project };
          this.detectArchitectures(text, summary);
          this.detectFailures(text, r.sid || 'claude-mem', summary, meta);
          this.extractMetrics(text, 'measured', r.sid || 'claude-mem', summary, meta);
        }
      } catch (e) {
        coverage.tool_uses_error = e.message;
      }

      // Distilled prose -> 'recalled'. This is what survives past the retention floor.
      const proseQueries = [
        ['observations',
          "SELECT memory_session_id AS sid, project, created_at, "
          + "COALESCE(title,'') || ' ' || COALESCE(text,'') || ' ' || "
          + "COALESCE(narrative,'') || ' ' || COALESCE(facts,'') AS blob FROM observations"],
        ['session_summaries',
          "SELECT memory_session_id AS sid, project, created_at, "
          + "COALESCE(request,'') || ' ' || COALESCE(investigated,'') || ' ' || "
          + "COALESCE(learned,'') || ' ' || COALESCE(completed,'') || ' ' || "
          + "COALESCE(notes,'') AS blob FROM session_summaries"]
      ];

      for (const [tbl, sql] of proseQueries) {
        try {
          for (const r of db.prepare(sql).all()) {
            rows++;
            const text = String(r.blob || '');
            if (!text.trim()) continue;
            const meta = { source: 'claude-mem:' + tbl, date: r.created_at, mem_project: r.project };
            this.detectArchitectures(text, summary);
            this.detectFailures(text, r.sid || 'claude-mem', summary, meta);
            this.extractMetrics(text, 'recalled', r.sid || 'claude-mem', summary, meta);
          }
        } catch (e) {
          coverage[tbl + '_error'] = e.message;
        }
      }

      try {
        const d = db.prepare('SELECT MIN(substr(created_at,1,10)) a, MAX(substr(created_at,1,10)) b FROM observations').get();
        if (d) { coverage.earliest = d.a; coverage.latest = d.b; }
      } catch {}

      coverage.available = true;
      coverage.rows_read = rows;
      coverage.metrics_added = summary.runs_found.length - before;
    } finally {
      try { db.close(); } catch {}
      process.emitWarning = emitWarning;
    }

    summary.memory_coverage = coverage;
    return coverage;
  }

  saveHistoricalRecords(summary) {
    // 1. HISTORICAL_LEADERBOARD.json (ranked, measured only)
    const leaderboardPath = path.join(this.outputBase, 'HISTORICAL_LEADERBOARD.json');
    fs.writeFileSync(leaderboardPath, JSON.stringify(summary.best_runs, null, 2), 'utf8');

    // 1b. HISTORICAL_ARCHIVE.json - distilled history recalled from claude-mem,
    //     including sessions whose raw transcripts have already been pruned.
    const archivePath = path.join(this.outputBase, 'HISTORICAL_ARCHIVE.json');
    fs.writeFileSync(archivePath, JSON.stringify({
      coverage: summary.memory_coverage || { available: false },
      recalled_count: summary.recalled_count || 0,
      entries: summary.archive_runs || []
    }, null, 2), 'utf8');

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

    const cov = summary.memory_coverage || {};
    const archive = summary.archive_runs || [];
    md += `\n## 3. Pre-Retention Archive (recalled from claude-mem)\n\n`;
    if (!cov.available) {
      md += `> claude-mem database was not read${cov.error ? ` (${cov.error})` : ''}.\n\n`;
    } else {
      md += `Claude Code prunes raw transcripts on a rolling \`cleanupPeriodDays\` window. `;
      md += `claude-mem retains distilled records from **${cov.earliest || '?'}** to **${cov.latest || '?'}**, `;
      md += `so sessions older than the transcript floor survive only here.\n\n`;
      md += `> [!WARNING]\n`;
      md += `> These values are **recalled** - summarised by a model after the fact, not read from live command output. `;
      md += `Treat them as leads to re-verify, never as benchmarks.\n\n`;
      md += `- Rows read from claude-mem: **${cov.rows_read || 0}**\n`;
      md += `- Recalled PPL values: **${summary.recalled_count || 0}** (${archive.length} unique by date+value)\n\n`;
      if (archive.length > 0) {
        md += `| Date | PPL | Project | Source | Context |\n`;
        md += `| :--- | :--- | :--- | :--- | :--- |\n`;
        archive.slice(0, 40).forEach(r => {
          const ctx = String(r.snippet || '').replace(/\s+/g, ' ').replace(/\|/g, '\\|').slice(0, 90);
          md += `| ${String(r.date || '').slice(0, 10)} | **${r.ppl.toFixed(4)}** | ${r.mem_project || '-'} | \`${(r.source || '').replace('claude-mem:', '')}\` | ${ctx} |\n`;
        });
        if (archive.length > 40) md += `\n*(${archive.length - 40} further recalled values in HISTORICAL_ARCHIVE.json)*\n`;
      }
    }

    md += `\n## 4. Key Historical Traps & Defenses\n`;
    md += `Documented **${summary.failures.size} critical failure traps** with permanent mitigations in [FAILURE_GRAVEYARD.md](./FAILURE_GRAVEYARD.md):\n\n`;
    for (const [_, f] of summary.failures) {
      md += `- **${f.title}**: ${f.mitigation}\n`;
    }

    fs.writeFileSync(dossierPath, md, 'utf8');
  }
}

if (require.main === module) {
  const synth = new HistoricalSynthesizer();
  const argv = process.argv.slice(2).filter(a => a.trim());
  const skipMemory = argv.includes('--no-memory');
  const targets = argv.filter(a => a !== '--no-memory');
  const scanArg = targets.length ? targets : undefined;
  console.log(`[HISTORICAL SYNTHESIZER]: Scanning past sessions in ~/.claude/projects/ (${scanArg ? scanArg.join(', ') : 'default project'}) ...`);
  synth.scanProject(scanArg, { skipMemory }).then(res => {
    if (res && res.error) { console.error(`\u2716 ${res.error}`); process.exitCode = 1; return; }
    console.log(`\n✔ Historical Synthesis Complete!`);
    console.log(`• Sessions Scanned: ${res.total_sessions_scanned}`);
    console.log(`• Architectures Found: ${Array.from(res.architectures).join(', ')}`);
    console.log(`• Measured PPL values: ${res.measured_count} (prose mentions excluded: ${res.mentioned_count})`);
    console.log(`• Best Measured PPL: ${res.best_runs.length > 0 ? res.best_runs[0].ppl : 'N/A'}`);
    const cov = res.memory_coverage || {};
    if (cov.available) {
      console.log(`• claude-mem archive: ${cov.rows_read} rows read, coverage ${cov.earliest} -> ${cov.latest}`);
      console.log(`• Recalled PPL values (pre-retention history): ${res.recalled_count} (${(res.archive_runs || []).length} unique)`);
    } else if (!skipMemory) {
      console.log(`• claude-mem archive: unavailable${cov.error ? ` (${cov.error})` : ''}`);
    }
    console.log(`• Critical Failure Traps Documented: ${res.failures.size}`);
    console.log(`• Isolated files updated in ~/.anchor-lab-ai/projects/quantization-side-lab/historical/`);
  });
}

module.exports = HistoricalSynthesizer;
