#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

/**
 * Resolve the active project name from environment, active context, or working directory.
 * @param {string} [explicitCwd]
 * @returns {string} Project name (e.g. 'onebit-forge' or 'quantization-side-lab')
 */
function resolveActiveProject(explicitCwd) {
  // 1. Explicit env override
  if (process.env.ANCHOR_PROJECT) {
    return process.env.ANCHOR_PROJECT;
  }

  // 2. Active context file check
  try {
    const ctxFile = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/active_context.json');
    if (fs.existsSync(ctxFile)) {
      const ctx = JSON.parse(fs.readFileSync(ctxFile, 'utf8'));
      if (ctx.project) return ctx.project;
    }
  } catch (_) {}

  // 3. Current working directory check
  const cwd = explicitCwd ? path.resolve(explicitCwd) : process.cwd();
  if (cwd.includes('onebit-forge')) return 'onebit-forge';
  if (cwd.includes('quantization-side-lab')) return 'quantization-side-lab';
  if (cwd.includes('Anchor-Labs-Projects')) return 'Anchor-Labs-Projects';
  if (cwd.includes('anchor-lab-ai')) return 'onebit-forge'; // default research repo

  // 4. Default to onebit-forge (the primary laboratory repository)
  return 'onebit-forge';
}

/**
 * Get or create the base project storage directory under ~/.anchor-lab-ai/projects/<project>
 * @param {string} [projectName]
 * @returns {string} Absolute path to project directory
 */
function getProjectBaseDir(projectName) {
  const proj = projectName || resolveActiveProject();
  const baseDir = path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai/projects', proj);
  if (!fs.existsSync(baseDir)) {
    fs.mkdirSync(baseDir, { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'models'), { recursive: true });
    fs.mkdirSync(path.join(baseDir, 'historical'), { recursive: true });
  }
  return baseDir;
}

module.exports = {
  resolveActiveProject,
  getProjectBaseDir
};
