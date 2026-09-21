#!/usr/bin/env node
const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class ColabController {
  constructor() {
    this.binPath = this.resolveBinary();
  }

  resolveBinary() {
    try {
      const p = execSync('which colab 2>/dev/null', { encoding: 'utf8' }).trim();
      return p || '/home/cody/.local/bin/colab';
    } catch {
      return '/home/cody/.local/bin/colab';
    }
  }

  isAvailable() {
    try {
      return fs.existsSync(this.binPath);
    } catch {
      return false;
    }
  }

  getSessions() {
    if (!this.isAvailable()) return { error: 'Colab CLI not installed' };
    try {
      const output = execSync(`${this.binPath} sessions 2>/dev/null`, { encoding: 'utf8' });
      return { raw: output.trim(), active: !output.includes('No active sessions') };
    } catch (e) {
      return { error: e.message };
    }
  }

  getStatus() {
    if (!this.isAvailable()) return { error: 'Colab CLI not installed' };
    try {
      const output = execSync(`${this.binPath} status 2>/dev/null`, { encoding: 'utf8' });
      return { raw: output.trim() };
    } catch (e) {
      return { error: e.message };
    }
  }

  getLog() {
    if (!this.isAvailable()) return { error: 'Colab CLI not installed' };
    try {
      const output = execSync(`${this.binPath} log 2>/dev/null`, { encoding: 'utf8' });
      const steps = [];
      let finished = null;

      const lines = output.split('\n');
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

      return {
        raw: output,
        steps,
        latest_step: steps.length > 0 ? steps[steps.length - 1] : null,
        finished
      };
    } catch (e) {
      return { error: e.message };
    }
  }

  upload(localPath, remotePath = '/content/') {
    if (!this.isAvailable()) return { error: 'Colab CLI not installed' };
    try {
      const output = execSync(`${this.binPath} upload "${localPath}" "${remotePath}" 2>/dev/null`, { encoding: 'utf8' });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  download(remotePath, localPath) {
    if (!this.isAvailable()) return { error: 'Colab CLI not installed' };
    try {
      const output = execSync(`${this.binPath} download "${remotePath}" "${localPath}" 2>/dev/null`, { encoding: 'utf8' });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  execDetached(scriptPath, timeoutSeconds = 60) {
    if (!this.isAvailable()) return { error: 'Colab CLI not installed' };
    try {
      const output = execSync(`${this.binPath} exec -f "${scriptPath}" --timeout ${timeoutSeconds} 2>/dev/null`, { encoding: 'utf8' });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = ColabController;
