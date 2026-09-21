#!/usr/bin/env node
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/config.json');

// Cody's `agy-auto` is a bash ALIAS (.bashrc:139 -- `agy --mode=accept-edits --dangerously-skip-permissions`),
// and spawnSync runs a binary directly with no shell, so the alias is invisible here. Pass the flag instead.
// WHY IT IS NEEDED (measured 2026-09-21): a council round asking the models to verify arXiv papers came back
// `Error: jetski: no output produced -- a tool required the "read_url" permission that headless mode cannot
// prompt for, so it was auto-denied.` Without this, every agy council answer is INFERENCE, never sourced.
// NOTE: the alias also carries `--mode=accept-edits`, deliberately NOT included -- the council is advisory-only
// and must never edit files (Cody 2026-09-21: "you write the code not the council"). Read permission is what
// research needs; edit permission is not. Add it here only if Cody asks.
const AGY_FLAGS = ['--dangerously-skip-permissions'];

class ModelRouter {
  constructor() {
    this.currentModel = this.loadConfiguredModel();
  }

  loadConfiguredModel() {
    try {
      if (fs.existsSync(CONFIG_PATH)) {
        const conf = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
        if (conf.model) return conf.model;
      }
    } catch {}
    return 'openai/gpt-5.6-luna';
  }

  setModel(modelName) {
    this.currentModel = modelName;
    try {
      let conf = {};
      if (fs.existsSync(CONFIG_PATH)) {
        conf = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
      }
      conf.model = modelName;
      fs.writeFileSync(CONFIG_PATH, JSON.stringify(conf, null, 2), 'utf8');
      return { success: true, model: modelName };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  getModel() {
    return this.currentModel;
  }

  query(prompt, overrideModel = null, options = {}) {
    const targetModel = overrideModel || this.currentModel;
    const timeoutMs = options.timeoutMs || 900000; // 15 minutes default for deep research

    // Route 1: AGY Engine
    if (targetModel.startsWith('agy:') || targetModel.startsWith('agy/')) {
      const agyModel = targetModel.replace(/^agy[:\/]/, '');
      try {
        const res = spawnSync('agy', [...AGY_FLAGS, '-p', prompt, '--model', agyModel], {
          encoding: 'utf8',
          timeout: timeoutMs,
          maxBuffer: 50 * 1024 * 1024
        });
        if (res.status === 0 && res.stdout) {
          return { success: true, model: targetModel, response: res.stdout.trim() };
        }
        throw new Error(res.stderr || `agy process exited with code ${res.status}`);
      } catch (e) {
        // Fallback to gemini-3.8-flash-high if specific agy model had capacity or routing issue
        try {
          const fallbackRes = spawnSync('agy', [...AGY_FLAGS, '-p', prompt, '--model', 'gemini-3.8-flash-high'], {
            encoding: 'utf8',
            timeout: timeoutMs,
            maxBuffer: 50 * 1024 * 1024
          });
          if (fallbackRes.status === 0 && fallbackRes.stdout) {
            return { success: true, model: 'agy:gemini-3.8-flash-high', response: fallbackRes.stdout.trim(), note: `Fallback from ${targetModel}` };
          }
          return { success: false, error: fallbackRes.stderr || e.message };
        } catch (err2) {
          return { success: false, error: err2.message || e.message };
        }
      }
    }

    // Route 2: OpenCode (OpenAI, OpenRouter :free, or OpenCode models)
    try {
      // Use direct argument spawning to eliminate shell-escaping bugs
      const res = spawnSync('opencode', ['run', prompt, '-m', targetModel], {
        encoding: 'utf8',
        timeout: timeoutMs,
        maxBuffer: 50 * 1024 * 1024
      });

      if (res.status !== 0) {
        const errMsg = res.stderr || (res.error ? res.error.message : `Process exited with code ${res.status}`);
        return { success: false, error: errMsg.trim(), model: targetModel };
      }

      // strip out opencode header lines (e.g. "> build · gpt-5.6-luna")
      const cleaned = (res.stdout || '').replace(/^>.*$/gm, '').trim();
      return { success: true, model: targetModel, response: cleaned };
    } catch (e) {
      return { success: false, error: e.message, model: targetModel };
    }
  }
}

module.exports = ModelRouter;
