---
name: anchorsetup
version: 1.0.0
description: Configure Anchor-Lab-Ai models, compute targets (Colab, Kaggle, SSH 192.168.1.80), and 3D experiment partitions.
allowed-tools:
  - Bash
  - mcp__anchor_lab_ai__lab_get_state
  - mcp__anchor_lab_ai__lab_set_context
---

# /anchorsetup — Setup & Model Switcher Wizard

When the user runs `/anchorsetup`:

1. Run `anchor-lab-ai doctor` to inspect current readiness.
2. Present the selection list for Harvester models:
   - `openai/gpt-5.6-luna` (Default / Active)
   - `openrouter/nvidia/nemotron-3.5-lightning:free`
   - `openrouter/qwen/qwen3.8-27b:free`
   - `openrouter/google/gemma-4-31b-it:free`
   - `agy:gemini-3.8-flash-high`
   - `agy:gpt-oss-120b-medium`
3. If the user picks a model number or name, run:
   ```bash
   anchor-lab-ai model <choice>
   ```
4. Confirm the updated model and print the ready status.
