#!/usr/bin/env node
// archeologist.js -- Multi-Tier Historical Transcript, Lab Memory & SQLite Archeologist
// Sources:
// 1. Curated Project Memory (*.md in ~/.claude/projects/.../memory/)
// 2. claude-mem SQLite database (~/.claude-mem/claude-mem.db: observations, tool_uses, summaries)
// 3. Historical Claude Transcripts (*.jsonl in ~/.claude/projects/.../)
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawnSync, execSync } = require('child_process');

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'from', 'up',
  'about', 'into', 'over', 'after', 'beneath', 'under', 'above',
  'does', 'did', 'do', 'what', 'how', 'why', 'when', 'where', 'which',
  'who', 'whom', 'this', 'that', 'these', 'those', 'it', 'its', 'can',
  'could', 'should', 'would', 'across', 'than', 'then', 'so'
]);

function tokenize(query) {
  if (!query || typeof query !== 'string') return { tokens: [], rareTokens: new Set() };
  const rawTokens = query.toLowerCase()
    .replace(/[^a-z0-9_.-]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));

  const tokens = Array.from(new Set(rawTokens));
  const rareTokens = new Set(
    tokens.filter(t => /\d/.test(t) || t.length >= 6 || /[._-]/.test(t))
  );

  return { tokens, rareTokens };
}

function searchProjectMemory(tokens, rareTokens, projectDir = null) {
  const baseProjectsDir = path.join(process.env.HOME || '/home/cody', '.claude/projects');
  if (!fs.existsSync(baseProjectsDir)) return [];

  let targetDirs = [];
  if (projectDir && fs.existsSync(projectDir)) {
    targetDirs.push(projectDir);
  } else {
    try {
      const entries = fs.readdirSync(baseProjectsDir);
      for (const e of entries) {
        if (e.includes('observer-sessions')) continue;
        const full = path.join(baseProjectsDir, e);
        if (fs.statSync(full).isDirectory()) targetDirs.push(full);
      }
    } catch {
      return [];
    }
  }

  const hits = [];

  for (const dir of targetDirs) {
    const memDir = path.join(dir, 'memory');
    if (!fs.existsSync(memDir)) continue;

    let files = [];
    try {
      files = fs.readdirSync(memDir).filter(f => f.endsWith('.md'));
    } catch {
      continue;
    }

    for (const f of files) {
      const filePath = path.join(memDir, f);
      try {
        const content = fs.readFileSync(filePath, 'utf8');
        const lower = content.toLowerCase();

        const matched = tokens.filter(t => lower.includes(t));
        if (matched.length === 0) continue;

        let score = 0;
        matched.forEach(t => {
          score += rareTokens.has(t) ? 4 : 1;
        });

        // Boost if multiple rare tokens match or if title/name matches
        const lowerFile = f.toLowerCase();
        matched.forEach(t => {
          if (lowerFile.includes(t)) score += 5;
        });

        // Extract frontmatter description or executive summary
        let desc = '';
        const descMatch = content.match(/description:\s*"([^"]+)"/i);
        if (descMatch) {
          desc = descMatch[1];
        } else {
          // Take first non-empty lines
          const lines = content.split('\n')
            .map(l => l.trim())
            .filter(l => l && !l.startsWith('---') && !l.startsWith('#'))
            .slice(0, 3);
          desc = lines.join(' ');
        }

        // Extract matched context excerpt
        let excerpt = '';
        const paragraphs = content.split(/\n\s*\n/);
        for (const p of paragraphs) {
          const lowerP = p.toLowerCase();
          const pMatches = matched.filter(t => lowerP.includes(t));
          if (pMatches.length >= Math.min(3, matched.length)) {
            excerpt = p.trim().slice(0, 500);
            break;
          }
        }
        if (!excerpt && paragraphs.length > 0) {
          excerpt = paragraphs[0].trim().slice(0, 400);
        }

        hits.push({
          source: 'curated_memory',
          project: path.basename(dir),
          file: f,
          path: filePath,
          matchedTokens: matched,
          score,
          title: f.replace('.md', ''),
          description: desc.slice(0, 350),
          excerpt: excerpt.slice(0, 500)
        });
      } catch {}
    }
  }

  hits.sort((a, b) => b.score - a.score);
  return hits;
}

function searchSqlite(tokens, projectDir = null, limit = 10) {
  const scriptPath = path.join(__dirname, 'sqlite-archeologist.py');
  if (!fs.existsSync(scriptPath)) return { observations: [], tool_uses: [], session_summaries: [] };

  try {
    const projArg = projectDir ? ['--project', path.basename(projectDir)] : [];
    const res = spawnSync('python3', [
      scriptPath,
      '--tokens', JSON.stringify(tokens),
      '--limit', String(limit),
      ...projArg
    ], {
      encoding: 'utf8',
      timeout: 10000,
      maxBuffer: 10 * 1024 * 1024
    });

    if (res.status === 0 && res.stdout) {
      return JSON.parse(res.stdout);
    }
  } catch {}

  return { observations: [], tool_uses: [], session_summaries: [] };
}

async function searchTranscripts(queryOrTokens, projectDir = null, limit = 15) {
  const baseProjectsDir = path.join(process.env.HOME || '/home/cody', '.claude/projects');
  if (!fs.existsSync(baseProjectsDir)) return { query: String(queryOrTokens), totalFound: 0, results: [] };

  let tokens, rareTokens, queryString;
  if (Array.isArray(queryOrTokens)) {
    tokens = queryOrTokens;
    rareTokens = new Set(tokens.filter(t => /\d/.test(t) || t.length >= 6));
    queryString = tokens.join(' ');
  } else {
    queryString = String(queryOrTokens);
    const parsed = tokenize(queryString);
    tokens = parsed.tokens;
    rareTokens = parsed.rareTokens;
  }

  let targetDirs = [];
  if (projectDir && fs.existsSync(projectDir)) {
    targetDirs.push(projectDir);
  } else {
    try {
      const entries = fs.readdirSync(baseProjectsDir);
      for (const e of entries) {
        if (e.includes('observer-sessions')) continue;
        const full = path.join(baseProjectsDir, e);
        if (fs.statSync(full).isDirectory()) targetDirs.push(full);
      }
    } catch {
      return { query: queryString, totalFound: 0, results: [] };
    }
  }

  const results = [];

  // Filter rare search keywords for grep acceleration
  const grepTerms = Array.from(rareTokens).slice(0, 4);
  const grepPattern = grepTerms.length > 0 ? grepTerms.join('|') : tokens.slice(0, 3).join('|');

  for (const dir of targetDirs) {
    let files = [];
    try {
      files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    } catch {
      continue;
    }

    // Sort by recent modification first
    files.sort((a, b) => {
      try {
        return fs.statSync(path.join(dir, b)).mtimeMs - fs.statSync(path.join(dir, a)).mtimeMs;
      } catch {
        return 0;
      }
    });

    for (const f of files) {
      const filePath = path.join(dir, f);
      try {
        // Fast-path: check if file contains any matching terms before reading
        let matchedLines = [];
        if (grepPattern) {
          try {
            const grepOut = execSync(`grep -n -E -i "${grepPattern}" "${filePath}" 2>/dev/null | head -n 40`, {
              encoding: 'utf8',
              maxBuffer: 5 * 1024 * 1024,
              timeout: 4000
            });
            if (grepOut) {
              const rawLines = grepOut.trim().split('\n');
              for (const rl of rawLines) {
                const colonIdx = rl.indexOf(':');
                if (colonIdx > 0) {
                  const lineNum = parseInt(rl.slice(0, colonIdx), 10);
                  const content = rl.slice(colonIdx + 1);
                  matchedLines.push({ lineNum, content });
                }
              }
            }
          } catch {}
        }

        // If grep didn't run or returned nothing, stream first 2000 lines
        if (matchedLines.length === 0) {
          const fileStream = fs.createReadStream(filePath);
          const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });
          let lineNum = 0;
          for await (const line of rl) {
            lineNum++;
            if (lineNum > 3000) break;
            const lower = line.toLowerCase();
            const hits = tokens.filter(t => lower.includes(t)).length;
            if (hits >= Math.min(2, tokens.length)) {
              matchedLines.push({ lineNum, content: line });
              if (matchedLines.length >= 20) break;
            }
          }
        }

        for (const item of matchedLines) {
          const line = item.content;
          // Filter out self-referential anchor plugin calls
          if (line.includes('mcp__plugin_anchor-lab-ai') || line.includes('lab_deep_sweep') || line.includes('lab_reconcile_memory')) {
            continue;
          }

          const lower = line.toLowerCase();
          const matched = tokens.filter(t => lower.includes(t));
          if (matched.length === 0) continue;

          let score = 0;
          matched.forEach(t => {
            score += rareTokens.has(t) ? 4 : 1;
          });

          let snippet = '';
          let timestamp = 'unknown';

          try {
            const obj = JSON.parse(line);
            timestamp = obj.timestamp || obj.created_at || 'unknown';

            if (obj.message && obj.message.content) {
              const c = obj.message.content;
              if (typeof c === 'string') snippet = c;
              else if (Array.isArray(c)) {
                snippet = c.map(part => part.text || part.command || JSON.stringify(part)).join(' ');
              } else {
                snippet = JSON.stringify(c);
              }
            } else if (obj.toolUseResult) {
              const res = obj.toolUseResult;
              snippet = res.stdout || res.output || JSON.stringify(res);
            } else if (obj.content) {
              snippet = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
            } else {
              snippet = line.slice(0, 300);
            }
          } catch {
            snippet = line.slice(0, 300);
          }

          results.push({
            source: 'transcript',
            project: path.basename(dir),
            session: f.replace('.jsonl', ''),
            line: item.lineNum,
            timestamp,
            score,
            matchedTokens: matched,
            snippet: snippet.replace(/\s+/g, ' ').slice(0, 450)
          });

          if (results.length >= limit * 2) break;
        }
      } catch {}
      if (results.length >= limit * 2) break;
    }
    if (results.length >= limit * 2) break;
  }

  results.sort((a, b) => b.score - a.score);
  const topResults = results.slice(0, limit);

  return {
    query: queryString,
    totalFound: topResults.length,
    results: topResults
  };
}

async function searchArchaeology(query, options = {}) {
  const { tokens, rareTokens } = tokenize(query);
  const projectDir = options.projectDir || null;
  const limit = options.limit || 8;

  // Run searches across all 3 tiers
  const memoryDocs = searchProjectMemory(tokens, rareTokens, projectDir);
  const dbResults = searchSqlite(tokens, projectDir, limit);
  const transcriptRes = await searchTranscripts(tokens, projectDir, limit);

  const totalHits = memoryDocs.length +
    (dbResults.observations ? dbResults.observations.length : 0) +
    (dbResults.tool_uses ? dbResults.tool_uses.length : 0) +
    transcriptRes.results.length;

  let formattedReport = `[HISTORICAL TRANSCRIPT & LAB ARCHAEOLOGY: "${query}"]\n`;
  formattedReport += `Total Matching Evidence Nodes: ${totalHits}\n\n`;

  // 1. Curated Memory Documents (Highest Signal)
  if (memoryDocs.length > 0) {
    formattedReport += `🏛️ CURATED LAB MEMORY ARTIFACTS (${memoryDocs.length} found):\n`;
    memoryDocs.slice(0, 4).forEach((m, idx) => {
      formattedReport += `--- [Memory ${idx + 1}] ${m.file} (Project: ${m.project} | Score: ${m.score}) ---\n`;
      if (m.description) formattedReport += `• Summary: ${m.description}\n`;
      if (m.excerpt) formattedReport += `• Key Evidence: ${m.excerpt.replace(/\s+/g, ' ')}\n`;
      formattedReport += `• File: ${m.path}\n\n`;
    });
  }

  // 2. Verified Tool Executions & Benchmark Runs
  if (dbResults.tool_uses && dbResults.tool_uses.length > 0) {
    formattedReport += `⚡ RECORDED TOOL & TEST RUNS (${dbResults.tool_uses.length} found):\n`;
    dbResults.tool_uses.slice(0, 3).forEach((t, idx) => {
      formattedReport += `--- [Run ${idx + 1}] ${t.tool} (${t.date ? t.date.slice(0, 16) : 'recent'}) ---\n`;
      if (t.command) formattedReport += `• Command: ${t.command}\n`;
      if (t.output_snippet) formattedReport += `• Output: ${t.output_snippet}\n`;
      formattedReport += '\n';
    });
  }

  // 3. Lab Observations
  if (dbResults.observations && dbResults.observations.length > 0) {
    formattedReport += `🧪 RECORDED LAB OBSERVATIONS (${dbResults.observations.length} found):\n`;
    dbResults.observations.slice(0, 3).forEach((o, idx) => {
      formattedReport += `--- [Observation ${idx + 1}] ${o.title} (${o.date ? o.date.slice(0, 10) : ''}) ---\n`;
      formattedReport += `• ${o.snippet}\n\n`;
    });
  }

  // 4. Transcript Moments
  if (transcriptRes.results.length > 0) {
    formattedReport += `💬 TRANSCRIPT CONVERSATION TURNS (${transcriptRes.results.length} found):\n`;
    transcriptRes.results.slice(0, 3).forEach((tr, idx) => {
      formattedReport += `--- [Transcript ${idx + 1}] ${tr.project} (${tr.session.slice(0, 8)}..., line ${tr.line}) ---\n`;
      formattedReport += `• ${tr.snippet}\n\n`;
    });
  }

  return {
    query,
    tokens,
    rareTokens: Array.from(rareTokens),
    totalFound: totalHits,
    memoryDocs,
    dbObservations: dbResults.observations || [],
    toolRuns: dbResults.tool_uses || [],
    sessionSummaries: dbResults.session_summaries || [],
    transcriptMoments: transcriptRes.results,
    formattedReport,
    // Maintain backwards compatibility with callers expecting results
    results: [
      ...memoryDocs.map(m => ({ project: m.project, session: m.file, line: 1, timestamp: 'curated', snippet: m.description || m.excerpt, score: m.score })),
      ...transcriptRes.results
    ]
  };
}

if (require.main === module) {
  const query = process.argv.slice(2).join(' ') || 'chunk carry equivalence';
  console.log(`[HISTORICAL TRANSCRIPT ARCHAEOLOGIST]: Investigating "${query}"...\n`);
  searchArchaeology(query).then(res => {
    console.log(res.formattedReport);
  });
}

module.exports = {
  searchTranscripts,
  searchArchaeology,
  searchProjectMemory,
  searchSqlite,
  tokenize
};
