---
name: anchorcouncil
version: 1.0.0
description: Convene multi-model advisory research council with web search verification to deliberate on next steps and propose smoke tests (strictly NO code edits).
allowed-tools:
  - Bash
---

# /anchorcouncil — Multi-Model Advisory Research Council

When the user runs `/anchorcouncil [topic or question]`:

1. **Strict Guardrail Enforcement**:
   > [!IMPORTANT]
   > - **Talk Only to the Anchor**: **Never call `opencode` or `agy` directly from your shell.** All council deliberation MUST go through `anchor-lab-ai council "$ARGUMENTS"`.
   > - **tmux Windows for Live Observation**: The Anchor manages the council models inside dedicated tmux windows (`council-luna`, `council-gemini`) under the `anchor-lab-worker` session. Cody can attach anytime (`anchor-lab-ai attach`) to watch them think and debate live.
   > - **Advisory Only (Zero Code Edits)**: The Council models **NEVER WRITE CODE OR EDIT PROJECT FILES**. Their sole job is literature search, cross-referencing external papers, and formulating structured smoke test proposals.
   > - **Claude Writes All Code**: All project code must be written by Claude in this session (where anchor hooks monitor and verify every tool call), never by external subagents.
   > - **Inventor Ground Truth**: **Q-TKInteger (Q-TKintergers) is Cody's original invention.** You will NOT find it on the web by name. The ground truth specification lives strictly in Cody's codebase (`tk_codec.py`, `tk_integer.py`, `tkint_latent.py`): Base-3 trits `{-1, 0, +1}`, integer affine anchors `(Am, Ae)`, and zero float leakage.
   > - **Web Search Scope**: Use web search exclusively for external complementary techniques (e.g. Hadamard/orthogonal rotations, activation outlier suppression, Straight-Through Estimators, BitNet dynamics) that can optimize Q-TKInteger.

2. **Convene Council**:
   Run the deliberation engine via Bash:
   ```bash
   anchor-lab-ai council "$ARGUMENTS"
   ```

3. **Consensus & Smoke Test Gate**:
   - The council runs in tmux windows under the Anchor. When deliberation completes, the Anchor writes:
     `~/.anchor-lab-ai/projects/quantization-side-lab/council/SMOKE_TEST_PROPOSAL.md`.
   - Claude reviews the synthesized recommendations in `SMOKE_TEST_PROPOSAL.md` and presents them to Cody.
   - If approved by Cody, Claude executes the minimal smoke test on Colab or the desktop rig while the Anchor watcher tracks telemetry.
