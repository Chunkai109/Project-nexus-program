---
description: Ask clarifying questions, then write a plan for a SmartPhysio change. Writes no code.
argument-hint: <what you want to change>
---

Plan this change to SmartPhysio: $ARGUMENTS

Follow `workflows/README.md`, step 1.

1. Read the files involved and CLAUDE.md's System Facts. Use the `planner`
   agent if the change spans several areas.
2. Ask at least three clarifying questions whose answers change what gets
   built. Wait for the answers.
3. Write the plan:
   - goal
   - files to change
   - tests to write first (where they fit)
   - how we will verify it, including hardware checks
   - risks
   - what is out of scope
4. Stop. Do not edit files until the plan is approved.
