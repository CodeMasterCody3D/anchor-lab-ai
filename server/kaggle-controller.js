#!/usr/bin/env node
const { execSync } = require('child_process');
const fs = require('fs');

class KaggleController {
  constructor() {
    this.binPath = this.resolveBinary();
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
      const output = execSync(`${this.binPath} kernels status "${slug}" 2>/dev/null`, { encoding: 'utf8' });
      const isComplete = output.toLowerCase().includes('complete');
      const isRunning = output.toLowerCase().includes('running');
      return { raw: output.trim(), complete: isComplete, running: isRunning };
    } catch (e) {
      return { error: e.message };
    }
  }

  fetchKernelOutput(slug, localDir) {
    if (!this.isAvailable()) return { error: 'Kaggle CLI not installed' };
    try {
      if (!fs.existsSync(localDir)) fs.mkdirSync(localDir, { recursive: true });
      const output = execSync(`${this.binPath} kernels output "${slug}" -p "${localDir}" 2>/dev/null`, { encoding: 'utf8' });
      return { success: true, output: output.trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  listRecentKernels(limit = 5) {
    if (!this.isAvailable()) return { success: false, error: 'Kaggle CLI not installed' };
    try {
      const output = execSync(`${this.binPath} kernels list --mine --page-size ${limit} 2>/dev/null`, { encoding: 'utf8' });
      return { success: true, raw: output.trim() };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = KaggleController;
