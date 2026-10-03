# FIL Trajectory Forensics

Trajectory Forensics turns an observed conversational behavior change into a reproducible research artifact.

The subsystem is intentionally provider-neutral. It does not generate protected content or invent bypasses. It operates on recorded trajectories and asks a narrower experimental question:

> Which parts of the prior conversation are necessary and sufficient to reproduce the observed behavior?

## Workflow

1. Capture a conversation with `trajectoryRecorder.ts`.
2. Mark the observed transition with a `BoundaryObservation`.
3. Supply a replay executor backed by the provider or surrogate test environment.
4. Run `minimizeConversationTrajectory()`.
5. FIL verifies the full-history baseline, protects the target-defining turn, performs coarse-to-fine delta debugging, runs a final singleton pass, and optionally performs fresh replications.
6. Export the minimized result with `buildPortableConversationTemplate()`.
7. Use the portable template with harmless surrogate targets or an explicitly authorized external evaluation harness.

## Replay executor

FIL deliberately separates experimental control from model execution:

```ts
const report = await minimizeConversationTrajectory({
  trajectory,
  executor: async (input) => {
    const result = await myProviderReplay(input.turns);
    return {
      reproduced: myBoundaryPredicate(result),
      boundaryState: "probable_crossing",
    };
  },
  replicationAttempts: 5,
});
```

The executor owns transport, provider credentials, and the reproduction predicate. FIL owns the ablation schedule and evidence trail.

## What is protected during minimization?

By default FIL preserves:

- every system turn before the evaluation point; and
- the final user turn before the observed assistant transition.

Callers can provide an explicit `protectedTurnIndexes` list when the experimental design requires different invariants.

## Portable export

`trajectoryTemplate.ts` replaces the target-defining user turn with `{{INPUT_QUESTION}}` and can emit a generic Python conversation-construction scaffold. The export is a representation of the minimized history, not proof of causality and not proof that an external program will accept or score the behavior.

## Safety and evidence handling

Trajectory text is optional in FIL artifacts. Hash-only capture remains the default-friendly path for evidence retention. Automated replay requires locally available text, so sensitive trajectories should only be replayed in an appropriately controlled and authorized research workspace.

Use synthetic or benign protected-information tasks for development and regression testing. Final validation against any restricted target belongs in the target program's authorized harness and rules.
