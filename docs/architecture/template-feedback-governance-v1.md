# Template and Feedback Governance v1

Status: **Accepted** on 2026-07-27.

## Template selection and adaptation

An `AgentTemplate` is reusable Builder source material with an immutable
`templateId`, `templateVersion`, and SHA-256 content hash. A
`TemplateAdaptation` is a one-off Builder draft proposal that names the exact
template version and hash it was adapted from. The Builder rejects an
adaptation if that reference does not match the selected immutable template.

An adaptation is not a deployed customer agent and carries no customer runtime
identity. It cannot modify a delivered package. Customer data, configuration,
credentials, and server access data are not retained in the template, feedback
record, or adaptation summary.

## Controlled feedback promotion

Feedback from operation is retained only as a sanitised proposal. It names the
source template and contains a full, separately versioned proposed template.
The proposal must create a different version of the same template; it cannot
overwrite the source version or use a customer package as source material.

`promoteApprovedTemplateFeedback` returns the proposed version only when a
matching `TemplateFeedbackApproval` explicitly says `approved`, is attributed
to Konstantin, and has an unambiguous timestamp. Identity attestation remains
outside the pure schema boundary, consistent with agent-spec approval evidence.
A rejected, absent, foreign, or malformed approval blocks promotion.

The new template affects only future Builder adaptations. It never mutates an
already delivered customer package or a customer environment.

## Evidence

`tests/template/template-governance.test.ts` verifies immutable template
binding, tamper rejection, explicit approval, and no in-place template
overwrite. Package assembly and delivery readiness remain separate packages.
