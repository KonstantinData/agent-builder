# Agent Creation Lifecycle v0.1

## Product definition

The Agent Builder is an internal Konstantin-only tool. It actively prepares new,
versioned agent specifications through a guided, contextual briefing. It does not use a
fixed questionnaire: it identifies missing information, asks agent-specific questions,
summarizes the plan, and builds only after the briefing is complete.

The Builder produces a validated, versioned ZIP package and does not start a running
agent, deploy to customer servers, execute external effects, or supervise later agent
work. Customer configuration and credentials remain in separately hosted customer
environments. See [Agent Builder Product and Delivery Boundary v1](agent-builder-product-and-delivery-boundary-v1.md).

Creating an agent means safely specifying, testing, approving, packaging, and
versioning a production-ready agent. It never means silently switching on a process.

## Lifecycle

1. **Complete the guided briefing and capture intent.** The Builder first passes
   the contextual briefing build-start gate: flexible, agent-specific questions
   cover the six internal completeness topics and have retained sanitised
   answers. It then records a `BuilderIntentDraft`: requested name, purpose,
   capabilities and requested agent-call roles are a proposal only. See
   [Guided Contextual Briefing v1](guided-contextual-briefing-v1.md).
2. **Assemble the spec.** The Spec Assembler validates the draft and resolves each role
   to a concrete already-approved agent version. It produces immutable
   `AgentSpecContent` and its deterministic content hash. Wildcards and unresolved
   roles cannot enter the final spec.
3. **Evaluate policy.** The Policy Harness checks prohibited combinations, trust-domain
   rules and the change against the predecessor. Capability-expanding changes require
   the full evaluation and gate path; reducing changes may use the defined lighter path.
4. **Evaluate safely.** The Evaluation Harness uses disposable mocks only, never live
   production data or credentials. Every declared evaluation requirement must pass.
   Each retained result carries a unique evidence ID, exact `{specId, version,
   contentHash}` subject, suite/score, completion time and explicit no-production
   assertions. A result for another candidate, an unknown/malformed reference clock,
   or a future-dated result is rejected; it is never reusable evidence.
5. **Obtain human approval.** The Deployment Gate binds content, policy subject and
   runtime metadata to the same candidate. Konstantin is the sole verified human
approver in v0.1. The Builder is always the applicant and can never approve its own
proposal. If Konstantin were the applicant, the gate must block self-approval; no
alternate approver exists by default.

The v0.1 policy subjects are exactly `agent-builder` (applicant) and `konstantin`
(approver). They are not credentials: an external trusted host must attest the supplied
approver identity before the pure gate receives it.
6. **Create the binding.** An approved version receives immutable runtime-binding
   evidence and lifecycle history. This is a content-bound description, not a started
   process, registry write, credential grant, tool invocation, or deployment.

At the Deployment Gate and Runtime Binding boundaries, the canonical content hash is
recomputed from the full spec. Any mismatch blocks before an approval or binding can be
emitted. This detects post-evaluation or post-approval content substitution; it does
not turn the Builder into a signer, evaluator runner, runtime, or host authority.

## Per-agent capability decision

Requested tools, communication channels, documents, calendars, external recipients,
agent-call edges, scopes, budgets and stop conditions are decided in the individual
agent draft. They are not pre-authorized globally by this lifecycle. Each requested
capability follows the same assembly, policy, evaluation and human-approval path.

## Traceability

The immutable spec, content hash, evaluation evidence, approval artifact, lifecycle
history and runtime-binding artifact are versioned repository/Control-Plane evidence.
The corresponding agent documentation is maintained in Notion. Notion documents the
human-facing record; it is not a substitute for the versioned technical evidence.

`agent-spec-traceability/1` is the optional immutable sidecar that makes one completed
candidate chain auditable without introducing a second authority source. It contains
exactly one immutable spec, evaluation evidence, approved `agent_spec` artifact,
runtime-binding artifact, explicit `recordedAt` instant, deterministic record digest,
and an opaque Notion documentation reference. The subject `{specId, version,
contentHash}` must be identical in all four technical artifacts; the runtime binding
must name that exact approval artifact. Evidence must be chronological:
evaluation completion <= approval decision <= binding deployment <= record time.
Foreign, missing, ambiguous, altered or future-dated evidence blocks the record.

The Notion reference is documentation only. The Builder never fetches, validates,
signs, or derives authority from it. Creating a traceability record does not approve a
candidate, mutate lifecycle state, bind a runtime, start a process, or invoke an
external effect.

## Explicit exclusions

- No staffing-need inference or personnel-work supervision.
- No direct deployment, process start, execution, dispatch, tool call, e-mail, Slack,
  WhatsApp, calendar, Notion, or other external effect by the Builder.
- No finished customer agent, customer data, customer configuration, or credential in
  this repository or in a Builder ZIP package.
- No automatic propagation of template changes to deployed customer agents.
- No executable spec, wildcard permission, unresolved role, shared credential,
  unapproved agent-call edge, self-approval, or automatic approval.
- No additional approver without an explicit versioned extension to this contract.
