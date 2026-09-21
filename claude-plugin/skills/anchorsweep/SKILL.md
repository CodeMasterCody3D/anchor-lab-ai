---
name: anchorsweep
version: 1.0.0
description: Full sweep of historical transcripts to recover lost code, tests, or hyperparameters, with 5-hour quota warning and free model picker.
allowed-tools:
  - Bash
  - mcp__anchor_lab_ai__lab_deep_sweep
---

# /anchorsweep — Historical Transcript Archeologist

When the user runs `/anchorsweep [query]`:

1. **Quota Guard & Warning**:
   Display the rate limit warning:
   ```text
   ⚠️ [RATE LIMIT WARNING]:
   Running a full sweep of historical session transcripts directly in Claude can consume significant tokens against your 5-hour usage limit.
   Anchor-Lab-Ai can run this query using our fast local archeologist or delegate analysis to a quota-free model:
     • Local Archeologist (Fast, 0 tokens)
     • openrouter/nvidia/nemotron-3.5-lightning:free
     • openrouter/qwen/qwen3.8-27b:free
     • agy:gemini-3.8-flash-high
     • openai/gpt-5.6-luna (Active default)
   ```

2. **Execute Search**:
   Run the local archeologist tool via Bash:
   ```bash
   anchor-lab-ai sweep "$ARGUMENTS"
   ```

3. **Present Recovered Artifacts**:
   - Show matching session files and lines.
   - Extract code implementations, hyperparameters, and benchmark metrics found.
   - Offer to reconstruct or restore the code into the current workspace.
