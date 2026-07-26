# Agent Builder Product and Delivery Boundary v1

Status: **Accepted** on 2026-07-27.

## Product purpose

Agent Builder is an internal tool used only by Konstantin. Customers never use it
directly. It turns a guided briefing into a complete, versioned, production-ready
agent package. It is not a customer runtime, a customer data store, or a deployment
tool.

## Guided briefing

The Builder starts from a rough request and conducts a contextual dialogue. It must
identify information that is missing, ask only the questions needed for that agent,
summarize the resulting plan, and build only after the dialogue is complete.

The following areas are an internal completeness framework, not a fixed questionnaire:

- workflow and business outcome;
- required information and allowed systems;
- decision boundaries and human escalation;
- expected output and tone;
- tests and acceptance evidence.

## Reuse and controlled improvement

Agents are built from reusable templates and adapted for the customer. Feedback from
real operation is captured as a proposal. A template changes only after an explicit
review and approval; deployed customer agents never change because a template changed.

The Builder repository never stores finished customer agents and never imports them
back as source material. It stores only Builder contracts, templates, validation logic,
and non-customer-specific documentation.

## Deliverable and Definition of Done

The Builder produces a closed, versioned ZIP package for one agent. The package contains
the validated agent artifact and the material required to verify it, but never real
customer data, customer configuration, credentials, or server access data. The Builder
determines and validates the required technical package contents for the individual
agent.

The Agent Builder is complete when it can independently create, validate, and provide
a complete production-ready agent as a versioned ZIP package from a guided briefing.

"Production-ready" in this definition means the package has passed all required
Builder-side completeness, security, and validation checks. It does not mean the agent
has been deployed, started, or observed in customer operation.

## Deployment and customer operation are separate

A separate Deploy Tool owns customer servers and server access. It receives the ZIP
package and owns target selection, upload, deployment, updates, rollback, and their
readback. None of those actions are part of Agent Builder's Definition of Done.

Each customer has a separate Konstantin-hosted customer environment. A customer
environment may contain several customer agents. Customer-specific configuration and
credentials exist only in that customer environment, never in the Builder repository
or in a Builder package.

## Development and legal boundary

Builder development and tests run locally in Codex/VS Code and through GitHub checks.
The Builder does not require a permanently running test server for its initial release.

Konstantin owns the technical area. Legal and contractual review of retention,
deletion, and data-export requirements is a personal follow-up before the first
production customer. It is tracked separately and does not block the Agent Builder
Definition of Done.

## Remaining Builder work

The Builder-side work is limited to:

1. contextual briefing and build-plan completion;
2. template selection, customer adaptation, and controlled feedback promotion;
3. package assembly, versioning, and ZIP validation;
4. Builder-side security, completeness, and acceptance validation; and
5. documentation and reproducible local/GitHub verification.

Runtime hosting, customer-server operations, credential custody in customer
environments, deployment, updates, rollback, and production-operation observability
belong to the separate Deploy Tool and customer environments.

The binding package order and evidence rules are in
[Agent Builder Delivery Plan v1](agent-builder-delivery-plan-v1.md).
