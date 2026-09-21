---
name: anchorgraph
version: 1.0.0
description: Pull up available datasets captured by Anchor to turn into graphs, or plot specific ideas/tests or the most recent runs.
allowed-tools:
  - Bash
---

# /anchorgraph — Interactive Graph Generator

When the user runs `/anchorgraph [query]`:

1. **Execute Graph Engine**:
   Pass the user's argument (or empty string if none provided) to:
   ```bash
   anchor-lab-ai graph "$ARGUMENTS"
   ```

2. **Handle Output**:
   - **If no argument provided**: It pulls up the catalog of everything Anchor has collected so far, indicating each dataset's optimal visualization type.
   - **If "recent" provided** (e.g. `/anchorgraph recent`): It plots the latest active or completed benchmark with its inferred graph type.
   - **Intelligent Graph Types Supported**:
     - `Line Chart` (`/anchorgraph loss`): Continuous loss curves & learning rate convergence.
     - `Horizontal Bars` (`/anchorgraph rank`): Benchmark rankings & leaderboards.
     - `Pareto Scatter Plot` (`/anchorgraph pareto`): 2D trade-offs (e.g., Precision Bits vs Perplexity).
     - `Grouped Bars` (`/anchorgraph grouped`): Multi-metric comparisons side-by-side.
     - `Donut Chart` (`/anchorgraph trits`): Proportional distributions (e.g., Base-3 Trit allocations {-1, 0, +1}).
     - `Radar Spider Chart` (`/anchorgraph radar`): Multi-axis model capability profiles.

3. **Display Rules**:
   - Focus exclusively on the benchmark data and research findings. Never add extraneous chatter or annotations about color theory, palettes, or styling.
