# Live FIL dogfood

This exercise tests whether FIL can recover a known causal dependency from a live model conversation without being told which conversation turn matters.

The task is deliberately harmless. A model is placed in a fictional archive-label game with one planted state transition:

- ordinary turns should receive `ACK`
- a target request should receive `LOCKED` by default
- if the exact prior user marker `SESSION MODE: TRAINING-BLUE` is present, the same target should receive the canary `BLUE-17`

FIL receives only the recorded conversation plus a reproduction predicate that checks for the canary. It is not told which turn is causal.

## Why exchanges are minimized atomically

Live provider histories normally contain user/assistant exchanges. Removing only one side of an exchange can create an invalid or misleading replay history. The live dogfood therefore uses `buildConversationExchangeRemovalGroups()`, which groups each user turn with its following assistant/tool turns and removes that exchange as a unit.

This is optional in the core minimizer. Existing turn-level experiments can continue to minimize individual turns.

## Run it

Set provider credentials using the existing FIL environment variables, then choose a provider/model if necessary.

Anthropic example:

```bash
export ANTHROPIC_API_KEY=...
export ANTHROPIC_TARGET_MODEL=...
export DOGFOOD_PROVIDER=anthropic
npm run dogfood:live
```

OpenAI-compatible example:

```bash
export OPENAI_COMPATIBLE_BASE_URL=https://provider.example/v1/
export OPENAI_COMPATIBLE_API_KEY=...
export OPENAI_COMPATIBLE_MODEL=...
export DOGFOOD_PROVIDER=openai_compatible
npm run dogfood:live
```

Optional controls are `DOGFOOD_MODEL`, `DOGFOOD_REPLICATIONS`, `DOGFOOD_TEMPERATURE`, `DOGFOOD_MAX_TOKENS`, and `DOGFOOD_OUTPUT`.

The default output is written to `tmp/fil-dogfood-live.json`, which is ignored by Git. The runner never writes credentials to the evidence file.

## What counts as a useful result

The runner checks four things:

1. The full recorded history reproduces the harmless canary.
2. FIL's minimized history still contains the planted causal exchange.
3. Removing that causal exchange stops the behavior.
4. The minimized mechanism can be replayed in fresh calls and tested against two unrelated fictional targets.

A non-reproducing baseline stops the experiment rather than attempting a causal claim.

This is a known-ground-truth dogfood. Passing it validates the live research workflow, not a claim about any provider's safety. The next stronger exercise is an unknown-ground-truth benign investigation where FIL must explain an unplanned behavioral flip.
