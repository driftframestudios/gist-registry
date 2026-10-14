# Python exception boundaries

Load this reference when Python exceptions, Pydantic validation, or an adapter
supplies the receiving error contract.

## Choose the receiving shape

| Caller need | Fitting form | Evidence distinction |
| --- | --- | --- |
| One familiar local failure | Existing built-in exception or direct domain subclass | Intended family reaches the caller |
| Several different recovery routes | Small hierarchy and stable codes | Each family reaches its declared recovery |
| Repeated code/message/type mappings | Immutable catalog and finite factory | Supported keys resolve; unknown keys retain a programmer-error route |
| Pydantic admission | Framework ValidationError, with PydanticCustomError for stable domain codes | Structured type and location identify the invariant |
| Finite adapter attempt | Existing typed outcome envelope | Timeout, abstention, failure, invalid response, and interruption retain their meanings |

## Specificity and ownership

Python catches subclasses of the named exception; narrower handlers precede
their parents. Keep the try body small enough that a handler cannot mistake an
internal KeyError for an absent external record. Successful follow-on
calculation belongs in else or after the translated call. KeyboardInterrupt
and SystemExit retain their control meaning through normal Exception
boundaries. Inspect the actual runtime's cancellation class before selecting
its propagation behavior.

A broad adapter catch is a containment policy, rather than a reason to broaden
pure-calculation handlers. Pair it with explicit failure accounting and the
existing identity guard. A dependency exception receives a specific handler
when its meaning changes the result or recovery.

## Framework-native validation

Pydantic validators may raise ValueError or PydanticCustomError; the latter
supports a stable structured type and message. A validator TypeError occupies
a different programming boundary and propagates under current Pydantic
behavior. Keep the established ValidationError surface for model admission.
A custom error raised outside validation is a separate exception: explicitly
choose and test the cross-input projection API's caller boundary.

Ordinary validator diagnostics can carry input, context, locations, and
messages. A safe public projection selects known codes and authored messages
and admits reported locations or counts. Omitting input/context helps but does
not establish that arbitrary locations and messages are public-safe. Full
diagnostics remain with an authorized reader.

## Bounded constructors and messages

Frozen dataclasses retain read-only attributes while mutable children keep
their ownership. Frozen descriptors with scalar fields or immutable children
fit a static error catalog. Domain exceptions can preserve existing .code and
str(error) behavior while adding .message, .stage, and .recovery; document that
compatibility choice.

Enum or literal keys suit a finite factory. Fixed messages keep source labels,
file contents, and provider errors out of public prose. Explicit chaining can
support authorized diagnostics. Raising from None suppresses displayed
chaining while the prior exception can remain in __context__. Presentation and
object access retain separate boundaries.

## Counterexamples

- Supply an oversized member in a small collection; prove rejection precedes hashing, sorting, or lookup.
- Inject the expected parser or I/O exception; assert its family and safe guidance.
- Inject an unrelated RuntimeError or TypeError from owned calculation; preserve its programming-error route.
- Seed prior accepted state, reject a successor, and compare the retained value independently.
- Interrupt between reservation and publication; observe the original interruption and declared recovery state.
- Assert structured error codes with independent literals rather than deriving expectations from the production catalog.

## Sources and transfer

Official sources establish language/framework mechanics. Receiving source and
focused tests establish the local taxonomy, effect boundary, and recovery.
The design choices above are scoped inferences from those mechanics.

- [Python 3.12 errors and exceptions](https://docs.python.org/3.12/tutorial/errors.html): specificity, else, chaining, custom exceptions, and cleanup.
- [Python exception objects](https://docs.python.org/3.12/library/exceptions.html): hierarchy and cause/context attributes.
- [Pydantic validators](https://docs.pydantic.dev/latest/concepts/validators/#raising-validation-errors): structured custom errors and validator contracts.
- [Pydantic error handling](https://docs.pydantic.dev/latest/errors/errors/): diagnostics and input-bearing details.
- [Choosing a Decision Shape](https://kindlight.systems/practitioner-probes/choosing-a-decision-shape-branches-rules-state-transitions): match structure to the relationship among conditions.
- [Evidence-Bearing Test Design](https://kindlight.systems/practitioner-probes/evidence-bearing-test-design-behavior-boundary-observable-proof): behavior, plausible fault, observable oracle, and scope.
