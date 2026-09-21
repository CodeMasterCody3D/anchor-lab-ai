---
name: anchorgraphlive
version: 1.0.0
description: Toggle real-time live graph generation for in-flight training, tests, and benchmark sweeps.
allowed-tools:
  - Bash
---

# /anchorgraphlive — Toggle Live Training Graphs

When the user runs `/anchorgraphlive`:

1. Toggle the live graph state:
   ```bash
   anchor-lab-ai graphlive
   ```
2. Inform the user:
   - If **ACTIVATED**: Every new training run or test will stream live unbuffered ASCII loss graphs in the tail log and continuously update SVG plots in `reports/graphs/`.
   - If **DEACTIVATED**: Live graph streaming is paused.
   - Run `/anchorgraphlive` again anytime to toggle back.
