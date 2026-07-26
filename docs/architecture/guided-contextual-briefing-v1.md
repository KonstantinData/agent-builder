# Guided Contextual Briefing v1

Status: **Accepted** on 2026-07-27.

## Purpose

Before an Agent Builder draft can be assembled, the Builder conducts a guided,
contextual dialogue from a rough request. It identifies what is missing, asks
only the questions relevant to that agent, records sanitised requirement
summaries, and presents a plan summary. It does not use a fixed questionnaire.

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

## Evidence

The contract and negative cases are tested in
`tests/briefing/guided-briefing.test.ts`. Package-specific package assembly,
production-readiness checks, ZIP generation, and deployment are deliberately
outside this contract.
