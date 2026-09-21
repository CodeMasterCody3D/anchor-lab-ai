---
name: anchorlabcheck
version: 1.0.0
description: Audit historical scan progress, check spawned subagents/worker fleet, and verify Main Anchor controller governance invariants (zero drift, no unauthorized web searches).
allowed-tools:
  - Bash
  - mcp__anchor_lab_ai__anchor_lab_check
  - mcp__anchor_lab_ai__lab_get_state
---

# /anchorlabcheck — Lab Oversight, Historical Progress & Subagent Audit

When the user runs `/anchorlabcheck`:

1. Execute the check audit via MCP tool `anchor_lab_check` or Bash:
   ```bash
   anchor-lab-ai check
   ```

2. Present a clear, high-contrast breakdown covering three key pillars:

   ### 1. Historical Synthesis Status
   - Check if historical synthesis is **RUNNING**, **COMPLETED**, or **IDLE**.
   - If running: Report active progress percentage, target session transcript currently being parsed, and traps cataloged so far.
   - If completed: Report completion timestamp, total transcripts scanned, lowest empirical PPL benchmark (e.g. 2.3000), and cataloged traps in `FAILURE_GRAVEYARD.md`.

   ### 2. Spawned Subagents & Background Workers
   - Audit all background worker daemons (e.g. `tmux: anchor-lab-worker`).
   - Audit in-flight training / quantization runs across Colab, Kaggle, and SSH units.
   - Audit any active Research Council advisory subagents.

   ### 3. Main Anchor Supervisor Invariants
   - Confirm the Main Anchor's dedicated role: **Central Controller & Supervisor**.
   - Confirm **Anti-Drift Guard**: Main Anchor remains strictly anchored in the lab state ledger, orchestrating subagents for heavy lifting or external searches without bloating or derailing the primary context window.
   - Confirm active Harvester Model and 3D Context track.
