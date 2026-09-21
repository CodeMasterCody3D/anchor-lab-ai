#!/usr/bin/env node
const fs = require('fs');

let input = '';
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  if (!input.trim()) process.exit(0);

  try {
    const data = JSON.parse(input);
    const toolName = data.tool_name || data.tool;
    const toolInput = data.tool_input || {};

    if (toolName === 'Bash' && toolInput.command) {
      const cmd = toolInput.command;

      // 1. Local Compute Shield Check
      const heavyPatterns = [
        /torchrun\b/i,
        /deepspeed\b/i,
        /accelerate\s+launch\b/i,
        /python[3]?\s+.*train.*\.py.*--batch[-_]size\s+([4-9]|\d{2,})/i
      ];

      for (const pattern of heavyPatterns) {
        if (pattern.test(cmd)) {
          // Check if routed through remote tools (colab, kaggle, ssh)
          if (!cmd.includes('colab') && !cmd.includes('kaggle') && !cmd.includes('ssh ') && !cmd.includes('192.168.1.80')) {
            console.error(`\n[LOCAL COMPUTE SHIELD BLOCKED EXECUTION]:`);
            console.error(`Heavy model training is forbidden on this host laptop (low disk & GPU).`);
            console.error(`Please route this run to:`);
            console.error(`  1. Google Colab VM: 'colab exec -f <script>'`);
            console.error(`  2. Kaggle Kernel: 'kaggle kernels push'`);
            console.error(`  3. Desktop Rig: 'ssh cody@192.168.1.80 systemd-run ...'`);
            process.exit(1);
          }
        }
      }
    }
  } catch (e) {}

  process.exit(0);
});
