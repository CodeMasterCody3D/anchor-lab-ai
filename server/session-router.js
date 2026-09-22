#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { getProjectBaseDir, getWorkspaceDir } = require('./project-resolver');

class SessionRouter {
  constructor(runtimeDir) {
    this.runtimeDir = runtimeDir || path.join(process.env.HOME || '/home/cody', '.anchor-lab-ai');
    this.sessionFile = path.join(this.runtimeDir, 'active_session.json');
  }

  encodeProjectPath(dirPath) {
    if (!dirPath) return '';
    const resolved = path.resolve(dirPath);
    return resolved.replace(/\//g, '-');
  }

  findTranscriptForSession(cwd = null, sessionId = null) {
    const home = process.env.HOME || '/home/cody';
    const baseDir = getWorkspaceDir(null, cwd);
    const encoded = this.encodeProjectPath(baseDir);
    const claudeProjDir = path.join(home, '.claude/projects', encoded);

    if (!fs.existsSync(claudeProjDir)) {
      return null;
    }

    if (sessionId) {
      const target = path.join(claudeProjDir, `${sessionId}.jsonl`);
      if (fs.existsSync(target)) {
        return {
          session_id: sessionId,
          project_dir: baseDir,
          transcript_path: target
        };
      }
    }

    // Find newest transcript in the project
    try {
      const files = fs.readdirSync(claudeProjDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => {
          const full = path.join(claudeProjDir, f);
          return {
            name: f,
            id: f.replace('.jsonl', ''),
            path: full,
            mtime: fs.statSync(full).mtimeMs
          };
        })
        .sort((a, b) => b.mtime - a.mtime);

      if (files.length > 0) {
        return {
          session_id: files[0].id,
          project_dir: baseDir,
          transcript_path: files[0].path
        };
      }
    } catch {}

    return null;
  }

  recordActiveSession(sessionId, cwd) {
    const info = this.findTranscriptForSession(cwd, sessionId) || {
      session_id: sessionId || 'default',
      project_dir: cwd || getProjectBaseDir(),
      transcript_path: null
    };

    const payload = {
      ...info,
      project_name: path.basename(info.project_dir),
      last_updated: new Date().toISOString()
    };

    try {
      fs.writeFileSync(this.sessionFile, JSON.stringify(payload, null, 2), 'utf8');
      
      // Also save inside the project partition
      const projDir = path.join(this.runtimeDir, 'projects', payload.project_name);
      if (fs.existsSync(projDir)) {
        fs.writeFileSync(path.join(projDir, 'session_meta.json'), JSON.stringify(payload, null, 2), 'utf8');
      }
    } catch {}

    return payload;
  }

  getActiveSession(cwd = null) {
    try {
      if (fs.existsSync(this.sessionFile)) {
        const saved = JSON.parse(fs.readFileSync(this.sessionFile, 'utf8'));
        if (cwd && saved.project_dir !== path.resolve(cwd)) {
          return this.recordActiveSession(null, cwd);
        }
        return saved;
      }
    } catch {}

    return this.recordActiveSession(null, cwd);
  }
}

module.exports = SessionRouter;
