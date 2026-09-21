---
name: anchorscan
version: 1.0.0
description: Deep scan of all project transcripts to compile an isolated historical dossier, best runs leaderboard, and failure graveyard.
allowed-tools:
  - Bash
---

# /anchorscan — Full-Spectrum Historical Transcript Scan

When the user runs `/anchorscan`:

1. Run the historical synthesizer:
   ```bash
   anchor-lab-ai scan
   ```
2. Present the synthesis findings:
   - Total sessions scanned
   - Core architectures identified
   - Best empirical results (ranked leaderboard)
   - Failure graveyard summary
3. Reassure the user:
   - This historical information is stored in an **isolated archive** (`~/.anchor-lab-ai/projects/quantization-side-lab/historical/`) so it never contaminates new runs, but remains accessible.
