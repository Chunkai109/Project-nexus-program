---
description: Run SmartPhysio's checks (types, lint, tests, build, key scan, diff read) and report PASS/FAIL.
---

Verify the current changes, following `workflows/README.md`, step 4. Run
each check and keep going after a failure, so the report is complete. Do not
fix anything unless asked.

1. **What changed**: `git status --short` and `git diff --stat`. Note which
   areas are touched: frontend, desktop, ml, firmware, supabase, docs.
2. **Frontend** (if `frontend/` or shared types changed), in `frontend/`:
   - `npx tsc -b`
   - `npm run lint` (compare the warning count with before the change)
   - `npm test`
   - `npm run build`
3. **Python** (if `ml/`, `ml_imu/`, `ensemble/` or `tests/` changed), from the
   repo root: `pytest`. If pytest is missing, say to run
   `pip install -r requirements-test.txt`.
4. **Firmware** (if `firmware/` changed): it cannot be compiled here. Check
   that pod IDs and pins match `frontend/src/lib/hub/` and
   `firmware/README.md`, and list what to test on the real board.
5. **Key scan** over the diff and new files: Gemini keys (`AIza…`), `sk-…`,
   Supabase service-role keys, `.env` files. Any hit is a FAIL.
6. **Diff read**: read the whole diff. Flag leftover debug logs, commented-out
   code, unlabelled demo data, and changes unrelated to the task.

Report:

```
## Verify
| Check | Result | Detail |
| tsc | PASS/FAIL/SKIPPED | |
| lint | PASS/FAIL | n warnings (was m) |
| tests | PASS/FAIL | n passed, n failed |
| build | PASS/FAIL | |
| pytest | PASS/FAIL/SKIPPED | |
| key scan | PASS/FAIL | |
| diff read | OK/ISSUES | |

Not testable here: ...
Overall: PASS / FAIL
```

Then suggest the right reviewer agent for the areas touched (see the review
table in `workflows/README.md`).
