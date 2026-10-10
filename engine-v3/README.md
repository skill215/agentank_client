# AgenTank V3 experimental host

V3 is a structured form of the frozen V1 tank. It is deliberately not a third
game engine yet:

- V1 owns the default decision order, mutable match memory and behavior.
- V3 exposes stable component ports at existing V1 function boundaries.
- Every default component delegates to the exact frozen V1 function.
- A V2 component is introduced through an adapter and can be enabled one port
  at a time.

This makes an experiment causal: if a replacement changes an action or a match
result, the changed port is known. A rewrite of the whole controller is not
mixed into the experiment.

## Layout

```text
engine-v3/
  src/contracts.js                 shared V2 action ABI and V3 port ABI
  src/component-registry.js        allocation-free dispatch and replacement
  src/controller.js                one isolated V1 state machine per tank
  src/v2-bridge-kernel.js          one shared V2 observation/state bridge per controller
  src/component-result.js          reused PASS/PROPOSED/SELECTED/INCOMPLETE result
  src/legacy/default-source.js     frozen V1 identity verification
  src/legacy/v1-runtime.js         isolated V1 loader and port interception
  src/adapters/                    one-port V2 causal adapters
  src/diagnostic-bot.js            pinned-simulator adapter
```

## Replaceable ports

| Port | Frozen V1 function | Contract |
| --- | --- | --- |
| `OBSERVE_ENEMY` | `observeEnemyBehavior` | side-effect, then return |
| `TRACK_PROJECTILES` | `updateEnemyProjectileTracking` | side-effect, then return |
| `VISIBLE_BOMB_SAFETY` | `chooseVisibleBombSafetyAction` | V1 action token or `null` |
| `VISIBLE_PROJECTILE_SAFETY` | `dodgeVisibleBullet` | V1 action token or `null` |
| `PROJECTILE_ESCAPE` | `continueProjectileEvasion` | V1 action token or `null` |
| `HIDDEN_ATTACK` | `winningHiddenAttackAction` | V1 action token or `null` |
| `DIRECT_ATTACK` | `winningAttackAction` | V1 action token or `null` |
| `PREEMPTIVE_SAFETY` | `preemptiveMuzzleDodge` | V1 action token or `null` |
| `TACTICAL_SEARCH` | `chooseTacticalAction` | V1 action token |
| `NAVIGATION` | `navigateWhenHidden` | emits an action |
| `FINAL_ACTION_GATE` | `saferRuntimeAction` | resolved V1 action token |
| `FRAME_PREPARE` | after V1 observation | prepares the shared V2 frame exactly once |
| `TACTICAL_CONTACT` | V1 root contact expression | boolean contact ownership |
| `ACTION_EMIT` | `executeAction` | records the action that was actually emitted |

The component interface is intentionally small:

```js
const component = {
  slot: V3_SLOT.DIRECT_ATTACK,
  invoke(call) {
    // call.a..call.d are the original arguments.
    // call.next() executes the frozen V1 implementation.
    return call.next();
  }
};

controller.replace(V3_SLOT.DIRECT_ATTACK, component);
```

`call` is a reused invocation object; the dispatch path creates no temporary
call/closure object. Replacement is allowed before the first decision only.
Create a new controller for every match.

## Compatibility rule

V3 uses `engine-v2/src/abi/fast-codes.js` as its numeric action ABI. Legacy V1
tokens are translated only at the boundary. Components that require a full V2
`FastState` must provide an adapter; V3 does not pretend that the V1 objects are
a V2 state bundle.

Every V2-backed adapter shares one `V2BridgeKernel`. Components must not convert
`me/enemy/game` independently. `FRAME_PREPARE` owns the sole
`ProductionObservationAdapter` call; `ACTION_EMIT` updates pending commands,
plans, and projectile tracking only after V1 has resolved and executed an
action.

All adapters use the same modes:

- `PASS_THROUGH`: execute only V1.
- `SHADOW`: compute a V2 proposal and audit it, but execute V1.
- `ACTIVE`: own the port when support is complete, otherwise execute V1.

The frozen V1 file is never edited. V3 inserts the three additional hooks into
an in-memory source copy and refuses to start unless every insertion anchor is
unique.

## Commands

```bash
npm run test:v3
npm run smoke:v1-v3
node tools/agentank/diagnostics/v3-component-arena.js verify-cohort
node tools/agentank/diagnostics/v3-component-arena.js run \
  --stage VC2 --role DISCOVERY --baseline VC1_SHADOW --candidate VC2_HARD_ACTIVE
node tools/agentank/diagnostics/v1-v3-arena.js --matches 128 \
  --cohort config/engine-v3/vc0-scenario-manifest.json \
  --v3-mode BEST_VC1_VC2 --output /tmp/v1-v3-best.json
```

The fixed cohort has 64 scenarios: 16 newly discovered historical scenarios
and 48 deterministic hash samples. Discovery owns 16 scenarios and Holdout owns
48; the manifest is immutable after VC0. The component arena writes only a
manifest, overview, compressed per-match rows, and a bounded diagnostic sample.
Raw replay data is never retained.

The first VC0-VC8 pass accepted the observation bridge and complete physical
Hard final gate. Escape ownership, the full V2 TacticalCore, strategic
navigation, and its Plan/PVA stack were negative; attack pressure and strict
ForcedWin were neutral. See
`docs/implementation/v3-v2-component-causal-testing.md` for the frozen evidence
and default enablement decision.
