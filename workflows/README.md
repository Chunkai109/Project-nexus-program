# SmartPhysio development workflow

One loop for every change, in every area. It is adapted from the
[ECC](https://github.com/affaan-m/ecc) workflow (plan, test first, review),
cut down to what fits a student team building a real rig.

```
Plan  ->  Test first (where it fits)  ->  Build  ->  Verify  ->  Review  ->  Commit (only when asked)
```

## 1. Plan

For anything bigger than a one-line fix:

- Ask at least three clarifying questions (CLAUDE.md rule).
- Write the plan: what changes, which files, how we will know it works, what could break.
- Use `/plan-change <what you want>` or the `planner` agent.
- Nothing is built until the plan is agreed.

## 2. Test first, where it fits

Write a failing test, see it fail, make it pass, then tidy up.

| Change | Test first? | Where tests go |
|---|---|---|
| Logic: rep counting, drift, session stats, dashboard rules, data mapping (`rows.ts`), hub protocol parsing | **Required** | `frontend/src/**/<name>.test.ts`, run with `npm test` |
| ML: data splits, features, labels, evaluation | **Required** for anything that can leak data or change a metric | `tests/ml/test_*.py`, run with `pytest` |
| UI layout and styling | Optional. Check it in the browser at real screen sizes instead | Playwright script, screenshots |
| Firmware (`.ino`) | Not possible here (no compiler or board) | A written test list for the real board |
| Docs, pitch, abstracts | No | Claims check instead (step 5) |

Fixing a bug? First write a test that reproduces it. That test then stops
the bug coming back.

Prove a new test can fail: break the code on purpose, see the test go red,
then put the code back.

## 3. Build

Make the smallest change that makes the tests pass. Do not tidy unrelated
code in the same change.

## 4. Verify

Run `/verify`, or by hand:

```bash
# frontend/
npx tsc -b
npm run lint
npm test
npm run build

# repo root, Python (one-time: pip install -r requirements-test.txt)
pytest
```

Then:

- Scan for leaked keys (Gemini, Supabase service role, any `sk-` or `AIza` string).
- Read your own diff top to bottom.

If something could not be tested (firmware, the real hub, a real camera),
say so and list what to test on the real hardware.

## 5. Review

Pick the reviewer for the area you changed. Each is in `.claude/agents/`.

| Area | Agent | Looks for |
|---|---|---|
| Patient app, physio dashboard | `dashboard-reviewer` | TypeScript and React bugs, hook mistakes, patient screens usable mid-exercise, demo data labelled |
| Camera, IMU and fused models | `ml-reviewer` | Per-class metrics, data leaks between train and test, comparison with the current model |
| ESP32 firmware | `firmware-reviewer` | Pins and pod IDs matching `frontend/src/lib/hub/`, ADC2 with WiFi, power, real-board test list |
| Anything touching patient data | `privacy-safety-reviewer` | Patient data in logs or URLs, keys in client code, RLS, demo data that could pass as real |
| Pitch, slides, abstracts, posts | `claims-checker` | Every claim true of the current prototype, no made-up numbers, future features marked |

Claude Code's built-in `/code-review` also works for a general bug hunt.

## 6. Commit

Only when asked. Small commits, each saying what changed and how it was
checked.

## Commands

| Command | Does |
|---|---|
| `/plan-change <task>` | Questions, then a written plan. No code. |
| `/verify` | Types, lint, tests, build, key scan, diff read. Ends with a PASS/FAIL report. |
| `/build-fix` | Fixes build and type errors one at a time, smallest change each. |

## What we left out of ECC, and why

- **Hooks** (scripts that run on every action): left out on purpose. Nothing
  runs automatically; every check is one we choose to run.
- **80 % coverage target**: not enforced. Tests go where bugs would hurt
  (logic and data), not on layout.
- **Checkpoint commit per test stage**: replaced by "commit only when asked".
- **Most of ECC's ~70 agents**: they cover languages and stacks we don't use.

## Credit

Adapted from ECC by Affaan Mustafa (https://github.com/affaan-m/ecc), MIT
licence. Text was rewritten for SmartPhysio; no ECC code is included.
