# Semantic visual receiver contracts

Use this skill to build a UI that remains clear about who owns the data, who
owns interaction behavior, who owns presentation, and which state a visitor is
actually seeing.

## Start here

1. Read the [skill contract](SKILL.md).
2. Name the accepted domain state and the local draft state separately.
3. Run the [stale-settlement exercise](exercises/README.md).
4. Read [framework and receiving boundaries](references/framework-and-receiving-boundaries.md)
   when a component library enters the route.

## Success example

A person selects a specimen family and requests a preview. A newer request
finishes first. Stable identity and generation checks accept the current
preview, classify the earlier completion as stale, announce the new state, and
return focus to the initiating control. Native HTML and React Aria routes use
the same state vocabulary and semantic tokens.

## Recovery example

A candidate request returns an invalid domain state. The controller reports a
typed rejection, keeps the last accepted preview visible, associates the error
with the initiating control, and offers another attempt from that stable
coordinate.

## Maturity

`exercised`: native HTML and React Aria receiver routes have applied the same
synthetic state contract, labels, token coordinate, stale-response policy, and
accepted-state recovery. Product content and domain release authority remain
with each receiving team.
