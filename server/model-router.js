#!/usr/bin/env node
const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/config.json');

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
        const res = spawnSync('agy', ['-p', prompt, '--model', agyModel], {
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
          const fallbackRes = spawnSync('agy', ['-p', prompt, '--model', 'gemini-3.8-flash-high'], {
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
