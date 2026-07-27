# Guided Contextual Briefing v1

Status: **Accepted** on 2026-07-27.

## Purpose

Before an Agent Builder draft can be assembled, the Builder starts a guided,
contextual dialogue from a rough request. An injected question provider receives
that exact request and the missing topics, then issues the agent-specific
questions. The Builder accepts one sanitised answer only for a question it
issued, and creates the plan only after the issued questions are answered. It
does not use a fixed questionnaire.

## Completeness framework

Each completed briefing must cover these internal topics:

1. workflow and intended outcome;
2. required information;
3. allowed systems;
4. decision boundaries and human escalation;
5. expected output and tone; and
6. tests and acceptance evidence.

The topics set the completion standard, not the dialogue script. Questions may
be added, omitted where not relevant, reworded, or asked in a different order.
Every question the Builder asks must be answered before build readiness is
granted, and each of the six topics must have a linked question and answer.

## Build-start gate

`evaluateGuidedBriefingReadiness` is the pure Builder-side gate. It returns
ready only when the briefing is explicitly completed, all retained questions
have exactly one linked answer, and the six topics are covered. A ready result
is not an approval, executable spec, deployment, package, or external action;
it merely permits the next Builder stage to create a draft.

The retained answer field is a sanitised requirement summary. Customer records,
customer configuration, credentials, and server access data are not valid
Builder repository material and must not be retained there.

## Executable flow

`startGuidedBriefing` accepts only a rough request and a deterministic,
injectable question provider. Each issued question carries a concrete
`contextNeed` that must share a meaningful request term. The flow carries a
recomputed digest over the request, issued questions, answers, and contextual
needs, so answer or completion operations reject modified state. A
host-injected `FlowSigner` signs every flow state and the Build-start gate
verifies that signature; a self-consistent, caller-constructed JSON object is
not accepted.
`answerGuidedBriefing` rejects foreign, mismatched, or duplicate answers.
`completeGuidedBriefing` runs the normal completeness gate, then accepts only a
non-empty plan whose provider returns the exact completion-flow digest. This
remains a Builder-only planning flow; immutable provenance binding to
adaptation, draft, and Spec is the next dependent work package.

## Evidence

The contract and negative cases are tested in
`tests/briefing/guided-briefing.test.ts`. Package-specific package assembly,
production-readiness checks, ZIP generation, and deployment are deliberately
outside this contract.
