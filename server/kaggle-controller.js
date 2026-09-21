#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

class KaggleController {
  constructor() {
    this.binPath = this.resolveBinary();
    this.cacheBase = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/cache/kaggle');
    if (!fs.existsSync(this.cacheBase)) {
      fs.mkdirSync(this.cacheBase, { recursive: true });
    }
  }

  resolveBinary() {
    try {
      const p = execSync('which kaggle 2>/dev/null', { encoding: 'utf8' }).trim();
      return p || '/home/cody/.local/bin/kaggle';
    } catch {
      return '/home/cody/.local/bin/kaggle';
    }
  }

  isAvailable() {
    try {
      return fs.existsSync(this.binPath);
    } catch {
      return false;
    }
  }

  checkKernelStatus(slug) {
    if (!this.isAvailable()) return { error: 'Kaggle CLI not installed' };
    try {
      const output = execSync(`${this.binPath} kernels status "${slug}" 2>/dev/null`, { encoding: 'utf8', timeout: 15000 });
      const lower = output.toLowerCase();
      const isComplete = lower.includes('complete');
      const isRunning = lower.includes('running');
      const isQueued = lower.includes('queued');
      const isError = lower.includes('error');
      return {
        raw: output.trim(),
        complete: isComplete,
        running: isRunning,
        queued: isQueued,
        error: isError,
        statusText: isComplete ? 'COMPLETE' : (isRunning ? 'RUNNING' : (isQueued ? 'QUEUED' : (isError ? 'ERROR' : 'UNKNOWN')))
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  fetchKernelOutput(slug, localDir) {
    if (!this.isAvailable()) return { error: 'Kaggle CLI not installed' };
    try {
      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
      const output = execSync(`${this.binPath} kernels output "${slug}" -p "${localDir}" 2>/dev/null`, { encoding: 'utf8', timeout: 45000 });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  listRecentKernels(limit = 10) {
    if (!this.isAvailable()) return { success: false, error: 'Kaggle CLI not installed' };
    try {
      const output = execSync(`${this.binPath} kernels list --mine --page-size ${limit} 2>/dev/null`, { encoding: 'utf8', timeout: 20000 });
      return { success: true, raw: output.trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  /**
   * Discovers currently running or queued kernels by querying recent list.
   * @param {number} [limit=10]
   * @returns {Array<{ slug: string, status: any }>}
   */
  getActiveKernels(limit = 10) {
    if (!this.isAvailable()) return [];
    const listRes = this.listRecentKernels(limit);
    if (!listRes.success || !listRes.raw) return [];

    const activeList = [];
    const lines = listRes.raw.split('\n').filter(l => l.trim());
    // First line is header, second is divider
    for (let i = 2; i < lines.length; i++) {
      const match = lines[i].match(/^([^\s]+)/);
      if (match) {
        const slug = match[1];
        const status = this.checkKernelStatus(slug);
        if (status && (status.running || status.queued)) {
          activeList.push({ slug, status });
        }
      }
    }
    return activeList;
  }

  /**
   * Ingest and parse a Kaggle kernel log stream for __ANCHOR_STEP__ and __ANCHOR_FINISH__ sentinels.
   * Downloads only the *.log file to local cache to keep polling lightweight and fast.
   * @param {string} slug - Kaggle kernel slug (e.g. 'codemastercody3d/e3-state-precision-cliff')
   * @returns {{
   *   slug: string,
   *   status: any,
   *   steps: Array<any>,
   *   latest_step: any|null,
   *   finished: any|null,
   *   raw: string
   * }}
   */
  getKernelLog(slug) {
    if (!this.isAvailable()) return { error: 'Kaggle CLI not installed', steps: [], latest_step: null, finished: null, raw: '' };

    const cleanSlug = slug.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const cacheDir = path.join(this.cacheBase, cleanSlug);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }

    const status = this.checkKernelStatus(slug);

    // Download log file with fast pattern filter
    try {
      execSync(`${this.binPath} kernels output "${slug}" -p "${cacheDir}" --file-pattern ".*\\.log" 2>/dev/null`, {
        encoding: 'utf8',
        timeout: 30000
      });
    } catch (_) {}

    // Locate downloaded .log file
    let rawText = '';
    try {
      const files = fs.readdirSync(cacheDir).filter(f => f.endsWith('.log'));
      if (files.length > 0) {
        const logPath = path.join(cacheDir, files[0]);
        const content = fs.readFileSync(logPath, 'utf8');

        // Check if Kaggle log is formatted as JSON event chunk array: [{"stream_name":..., "data":...}, ...]
        if (content.trim().startsWith('[') || content.trim().startsWith('{') || content.includes('"stream_name"')) {
          try {
            // Normalize potential leading comma or fragments
            const normalized = content.trim().replace(/^,+/, '');
            const parsedArray = JSON.parse(normalized.startsWith('[') ? normalized : `[${normalized}]`);
            if (Array.isArray(parsedArray)) {
              rawText = parsedArray.map(chunk => chunk.data || '').join('');
            } else {
              rawText = content;
            }
          } catch (_) {
            // Regex fallback for stream_name chunks if JSON.parse fails on partial logs
            const chunks = [];
            const dataRegex = /"data"\s*:\s*"(.*?)(?<!\\)"/gs;
            let m;
            while ((m = dataRegex.exec(content)) !== null) {
              try {
                chunks.push(JSON.parse(`"${m[1]}"`));
              } catch {
                chunks.push(m[1]);
              }
            }
            rawText = chunks.length > 0 ? chunks.join('') : content;
          }
        } else {
          rawText = content;
        }
      }
    } catch (e) {
      rawText = `[Kaggle log read error: ${e.message}]`;
    }

    const steps = [];
    let finished = null;

    if (rawText) {
      const lines = rawText.split('\n');
      for (const line of lines) {
        if (line.includes('__ANCHOR_STEP__:')) {
          try {
            const rawJson = line.substring(line.indexOf('__ANCHOR_STEP__:') + 16).trim();
            steps.push(JSON.parse(rawJson));
          } catch {}
        }
        if (line.includes('__ANCHOR_FINISH__:')) {
          try {
            const rawJson = line.substring(line.indexOf('__ANCHOR_FINISH__:') + 18).trim();
            finished = JSON.parse(rawJson);
          } catch {}
        }
      }
    }

    return {
      slug,
      status,
      steps,
      latest_step: steps.length > 0 ? steps[steps.length - 1] : null,
      finished,
      raw: rawText
    };
  }
}

module.exports = KaggleController;
