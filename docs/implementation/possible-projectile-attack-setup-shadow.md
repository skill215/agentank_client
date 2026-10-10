# Possible-projectile AttackSetup Shadow

This phase extends the two-stage physical attack certificate across the two
worlds created by one unresolved hostile projectile: absent and present.

The closure is certificate-specific. It runs only for the seven movement rows
already certified by `TwoStageAttackSetupShadow`, injects one tracked possible
projectile into an undoable FastState transition, and requires one common
policy in both worlds:

```text
same GO/TURN
→ every represented enemy response
→ same FIRE
→ every successor response
→ Hard + committed viability + PAC lifecycle
```

Fixed-16 Shadow evidence evaluated six possible-projectile roots. Two were
certified, four were rejected, and none remained incomplete. Four roots needed
certificate-local poison phase reconstruction because the pinned simulator
uses absolute even-frame cadence; the reconstruction trusts the observed
`canActThisFrame`, changes only the temporary proof world, and restores the
root exactly. Total present-world work was 17 explicit nodes, maximum seven per
candidate, with zero restore failures and zero declared hot allocation.

The experiment was behavior-neutral: baseline and candidate both finished
4 wins, 27 losses, and 1 draw, with no action, star, crash, FIRE, bomb, or skill
delta and no invariant failure.

No ACTIVE owner was enabled. The two robust rows retained full-range
Information intervals, so neither proves it is better than the incumbent.
The next valid experiment must add a sound nonloss/value relation and a
revalidated persistent `FIRE` continuation; it must not treat constrained enemy
mobility as a forced win.

Machine-readable evidence is in
`config/engine-v2/information-option-attack-setup-closure-evidence.json`.
