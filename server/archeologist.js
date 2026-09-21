#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync } = require('child_process');

async function searchTranscripts(query, projectDir = null) {
  const baseProjectsDir = path.join(process.env.HOME || '/home/cody', '.claude/projects');
  if (!fs.existsSync(baseProjectsDir)) return { error: 'No ~/.claude/projects directory found' };

  let targetDirs = [];
  if (projectDir) {
    targetDirs.push(projectDir);
  } else {
    const entries = fs.readdirSync(baseProjectsDir);
    for (const e of entries) {
      const fullPath = path.join(baseProjectsDir, e);
      if (fs.statSync(fullPath).isDirectory()) targetDirs.push(fullPath);
    }
  }

  const results = [];
  const lowerQuery = query.toLowerCase();

  for (const dir of targetDirs) {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl'));
    for (const f of files) {
      const filePath = path.join(dir, f);
      try {
        const fileStream = fs.createReadStream(filePath);
        const rl = readline.createInterface({
          input: fileStream,
          crlfDelay: Infinity
        });

        let lineNum = 0;
        for await (const line of rl) {
          lineNum++;
          if (line.toLowerCase().includes(lowerQuery)) {
            try {
              const obj = JSON.parse(line);
              let snippet = '';
              if (obj.message && obj.message.content) {
                snippet = typeof obj.message.content === 'string' ? obj.message.content : JSON.stringify(obj.message.content);
              } else if (obj.content) {
                snippet = typeof obj.content === 'string' ? obj.content : JSON.stringify(obj.content);
              } else {
                snippet = line.substring(0, 300);
              }

              results.push({
                project: path.basename(dir),
                session: f.replace('.jsonl', ''),
                line: lineNum,
                timestamp: obj.timestamp || obj.created_at || 'unknown',
                snippet: snippet.slice(0, 500)
              });

              if (results.length >= 15) break; // limit to top 15 results
            } catch {
              // Not JSON, raw line
              results.push({
                project: path.basename(dir),
                session: f.replace('.jsonl', ''),
                line: lineNum,
                snippet: line.substring(0, 300)
              });
              if (results.length >= 15) break;
            }
          }
        }
      } catch (e) {}
      if (results.length >= 15) break;
    }
    if (results.length >= 15) break;
  }

  return { query, totalFound: results.length, results };
}

if (require.main === module) {
  const query = process.argv.slice(2).join(' ') || 'test';
  console.log(`[HISTORICAL TRANSCRIPT ARCHAEOLOGIST]: Searching for '${query}'...`);
  searchTranscripts(query).then(res => {
    console.log(`Found ${res.totalFound} matching transcript moments:\n`);
    res.results.forEach((r, idx) => {
      console.log(`--- [${idx + 1}] Project: ${r.project} | Session: ${r.session} (Line ${r.line}) ---`);
      console.log(`${r.snippet.replace(/\n+/g, ' ')}\n`);
    });
  });
}

module.exports = { searchTranscripts };
