---
description: Fix SmartPhysio build and type errors one at a time, with the smallest safe change for each.
---

Fix the build and type errors, one at a time.

1. **Run the failing check** to get the full error list:
   - Frontend: `cd frontend && npx tsc -b`, then `npm run build`
   - Desktop: the desktop app bundles the frontend build
     (`cd desktop && npm run build:web`). Its installer is built by GitHub
     Actions, not here.
   - Python: `pytest`, or `python -m compileall -q ml ml_imu ensemble`
2. **Group the errors** by file. Fix imports and types before logic errors.
3. **For each error:**
   1. Read the code around it.
   2. Find the cause.
   3. Make the smallest edit that fixes it.
   4. Re-run the check.
   Never silence an error with `any`, `as`, `!`, `@ts-ignore` or by deleting
   a test.
4. **Stop and ask** if:
   - a fix creates more errors than it removes,
   - the same error survives 3 attempts,
   - the fix needs a design change, or
   - it needs a new or upgraded dependency.
5. **Finish with:**
   - what was fixed, by file
   - anything still failing
   - the final check output (tsc, build, tests)
