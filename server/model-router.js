#!/usr/bin/env node
const { execSync } = require('child_process');
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

  query(prompt, overrideModel = null) {
    const targetModel = overrideModel || this.currentModel;

    // Route 1: AGY Engine
    if (targetModel.startsWith('agy:') || targetModel.startsWith('agy/')) {
      const agyModel = targetModel.replace(/^agy[:\/]/, '');
      try {
        const cmd = `agy -p "${prompt.replace(/"/g, '\\"')}" --model "${agyModel}" 2>/dev/null`;
        const res = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
        return { success: true, model: targetModel, response: res.trim() };
      } catch (e) {
        // Fallback to gemini-3.8-flash-high if specific agy model had capacity issue
        try {
          const fallbackCmd = `agy -p "${prompt.replace(/"/g, '\\"')}" --model gemini-3.8-flash-high 2>/dev/null`;
          const res = execSync(fallbackCmd, { encoding: 'utf8', timeout: 30000 });
          return { success: true, model: 'agy:gemini-3.8-flash-high', response: res.trim(), note: `Fallback from ${targetModel}` };
        } catch (err2) {
          return { success: false, error: e.message };
        }
      }
    }

    // Route 2: OpenCode (OpenAI, OpenRouter :free, or OpenCode models)
    try {
      const cmd = `opencode run "${prompt.replace(/"/g, '\\"')}" -m "${targetModel}" 2>/dev/null`;
      const res = execSync(cmd, { encoding: 'utf8', timeout: 45000 });
      // strip out opencode header lines (e.g. "> build · gpt-5.6-luna")
      const cleaned = res.replace(/^>.*$/gm, '').trim();
      return { success: true, model: targetModel, response: cleaned };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }
}

module.exports = ModelRouter;
