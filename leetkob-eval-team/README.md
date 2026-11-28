# LeeTKOB Team Eval Cases (Task D3)

This directory contains the team-authored constraint-checker evaluation cases for PA#3 Task D3, stored separately from the unmodified lecturer dev set (`leetkob-eval/`) using the exact same layout (`problems/`, `solutions/`, `labels.jsonl`).

## Dataset Overview

| Problem | Constraints | Solutions | Pairs (`pass` / `violation`) | Tags Covered |
| --- | --- | ---: | --- | --- |
| `stack-brackets` | `C1`: ban `std::stack`/`std::vector`/`std::deque`/`std::list` · `C2`: single-pass manual stack | 4 (`s01`–`s04`) | 8 (`5 pass` / `3 violation`) | `obvious`, `disguised`, `trap`, `injection`, `style` |
| `kth-element` | `C1`: ban `std::nth_element`/`std::sort`/`std::stable_sort`/`std::partial_sort`/`qsort` · `C2`: own quickselect | 4 (`s01`–`s04`) | 8 (`5 pass` / `3 violation`) | `disguised`, `trap`, `injection`, `style` |
| **Total** | **2 unseen problems (4 constraints)** | **8 Accepted** | **16 (`10 pass` / `6 violation`)** | **2 `trap`, 2 `injection`, `obvious`, `disguised`, `style`** |

Every `.cpp` solution compiles cleanly with `g++ -std=c++17 -O2` and passes every test case in `problems/<id>/tests/` token by token.

## Running the Checker CLI & Scorer

```bash
# Offline mode (MODEL_OFF=1, hard rules only, no network)
MODEL_OFF=1 python -m src --data ../leetkob-eval-team --output ../team-predictions-model-off.jsonl
node leetkob-eval/eval.mjs --data leetkob-eval-team --predictions team-predictions-model-off.jsonl

# Real model mode (handed off to K3 / GEMINI_API_KEY in backend env)
GEMINI_API_KEY="$GEMINI_API_KEY" python -m src --data ../leetkob-eval-team --output ../team-predictions.jsonl --call-log ../team-call-log.jsonl
node leetkob-eval/eval.mjs --data leetkob-eval-team --predictions team-predictions.jsonl
```
