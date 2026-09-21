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
   > - **Inventor Ground Truth**: **Q-TKInteger (Q-TKintergers) is Cody's original invention.** You will NOT find it on the web by name. The ground truth specification lives strictly in Cody's codebase (`tk_codec.py`, `tk_integer.py`, `tkint_latent.py`): Base-3 trits `{-1, 0, +1}`, integer affine anchors `(Am, Ae)`, and zero float leakage.
   > - **Web Search Scope**: Use web search exclusively for external complementary techniques (e.g. Hadamard/orthogonal rotations, activation outlier suppression, Straight-Through Estimators, BitNet dynamics) that can optimize Q-TKInteger.
   > - **Advisory Only**: The Anchor Research Subagents **DO NOT WRITE CODE OR EDIT PROJECT FILES**. Their sole job is literature search, cross-referencing external papers, and formulating structured smoke test proposals.

2. **Convene Council**:
   Run the deliberation engine via Bash:
   ```bash
   anchor-lab-ai council "$ARGUMENTS"
   ```

3. **Consensus & Smoke Test Gate**:
   - If the council models reach consensus that an approach is promising and verified in literature, they write a minimal smoke test proposal to:
     `~/.anchor-lab-ai/projects/quantization-side-lab/council/SMOKE_TEST_PROPOSAL.md`.
   - The council alerts Claude Code:
     > *"Council consensus reached. Proposal formulated in SMOKE_TEST_PROPOSAL.md. Claude, please review and execute the smoke test on Colab or the desktop rig."*
   - The main Anchor daemon (`anchor-lab-worker`) watches the smoke test without delegating, logs the results, and feeds the empirical outcome back to the council.
