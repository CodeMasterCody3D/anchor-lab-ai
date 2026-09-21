---
name: anchor
version: 1.0.0
description: Display Anchor-Lab-Ai status, compute fleet audit, and prompt user to select worker model or check active runs.
allowed-tools:
  - Bash
  - mcp__anchor_lab_ai__lab_get_state
  - mcp__anchor_lab_ai__lab_calc_vram
  - mcp__anchor_lab_ai__lab_remote_poll
  - mcp__anchor_lab_ai__lab_get_test_report
---

# /anchor — Anchor-Lab-Ai Interactive Dashboard & Model Setup

When the user runs `/anchor`, execute the following workflow:

1. Run the audit command via Bash:
   ```bash
   anchor-lab-ai doctor
   ```
2. Print the full output banner to the user.
3. Prompt the user:
   - Highlight **`openai/gpt-5.6-luna`** as the active default model (verified authenticated).
   - Offer the OpenRouter free models (`:free`) and AGY models (`gemini-3.8-flash-high`, `gpt-oss-120b-medium`).
   - Ask if they'd like to keep Luna or switch models, or if they want to launch/inspect training runs on Colab, Kaggle, or the desktop rig (`192.168.1.80`).
