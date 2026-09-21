#!/usr/bin/env node
const { execSync } = require('child_process');

class SSHController {
  constructor(host = '192.168.1.80', user = 'cody') {
    this.host = host;
    this.user = user;
  }

  isReachable() {
    try {
      execSync(`nc -z -w 1 ${this.host} 22 2>/dev/null`);
      return true;
    } catch {
      return false;
    }
  }

  formatSystemdRun(unitName, command) {
    return `ssh ${this.user}@${this.host} "systemd-run --user --collect --unit=${unitName} bash -c '${command.replace(/'/g, "'\\''")}'"`;
  }

  checkUnitStatus(unitName) {
    if (!this.isReachable()) return { error: `Host ${this.host} unreachable` };
    try {
      const output = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=2 ${this.user}@${this.host} "systemctl --user is-active ${unitName} 2>/dev/null"`, { encoding: 'utf8' });
      return { status: output.trim(), active: output.trim() === 'active' };
    } catch (e) {
      return { status: 'inactive', active: false };
    }
  }

  tailJournal(unitName, lines = 50) {
    if (!this.isReachable()) return { error: `Host ${this.host} unreachable` };
    try {
      const output = execSync(`ssh -o BatchMode=yes -o ConnectTimeout=2 ${this.user}@${this.host} "journalctl --user -u ${unitName} -n ${lines} --no-pager 2>/dev/null"`, { encoding: 'utf8' });
      return { logs: output };
    } catch (e) {
      return { error: e.message };
    }
  }
}

module.exports = SSHController;
