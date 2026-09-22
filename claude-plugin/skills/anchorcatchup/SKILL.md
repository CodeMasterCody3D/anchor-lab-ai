---
name: anchorcatchup
version: 1.0.0
description: Ingest today's chat messages, analyze consensus test findings between Cody and Claude, extract the active plan, and record to CONFIRMED_FINDINGS.md and ACTIVE_PLAN.md.
allowed-tools:
  - Bash
  - mcp__anchor_lab_ai__lab_catchup_chat
  - mcp__anchor_lab_ai__lab_get_active_plan
---

# /anchorcatchup — Catch Up & Record Agreed Chat Findings

When the user runs `/anchorcatchup`, execute the following workflow:

1. Run the catchup command via Bash:
   ```bash
   anchor-lab-ai catchup
   ```
2. Display the confirmed findings and active plan to the user.
3. Verify that Cody, Claude, and Anchor all agree on the findings, test numbers, and next operational step.
