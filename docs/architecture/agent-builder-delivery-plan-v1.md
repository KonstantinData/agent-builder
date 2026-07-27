# Agent Builder Delivery Plan v1

Status: **Binding work instruction**. This plan implements the accepted
[product and delivery boundary](agent-builder-product-and-delivery-boundary-v1.md).

## Definition of Done

Agent Builder is complete only when it can independently create a complete,
production-ready agent from a guided, contextual briefing, validate it, and provide a
versioned ZIP package.

The completed ZIP is not a demo or test agent. Before it is marked ready for delivery,
the Builder must have evidence that the briefing is complete, the required technical
artifacts exist, the package is complete and free of customer data and credentials, and
all Builder-side policy, security, and acceptance checks have passed.

## Non-negotiable boundaries

- Work only on Builder contracts, templates, validation, package assembly, and related
  documentation in this repository.
- Never store finished customer agents, ZIP packages, customer data, customer
  configuration, credentials, or server access data in this repository.
- Deliver finished agents only as versioned ZIP packages outside this repository.
- A separate Deploy Tool owns customer-server selection, upload, deployment, updates,
  rollback, and operational readback. These are not Builder Definition-of-Done items.
- Templates may evolve only through an explicit feedback proposal and approval. A
  template change must never alter an already delivered customer agent.
- Legal and contractual review of retention, deletion, and export stays outside the
  Builder Definition of Done and must not block Builder completion.

## Required delivery sequence

Work the packages below in order. The Notion entries are the live status ledger; this
document is the stable repository delivery plan.

1. **Guided contextual agent briefing and build-plan completion**

   Notion: [Feature Backlog](https://app.notion.com/p/3a91c1ac5ec08189aeb9d6c29964e27e).
   Create the dialogue contract, completion checks, summary, and build-start gate.

2. **Template-based agent adaptation and approval-gated feedback promotion**

   Notion: [Feature Backlog](https://app.notion.com/p/3a91c1ac5ec0814384ddf973182163d2).
   Define template selection, adaptation, feedback proposals, approval, versioning,
   and protection of already delivered agents.

3. **Versioned production-ready ZIP package assembly and validation**

   Notion: [Feature Backlog](https://app.notion.com/p/3a91c1ac5ec08159b5e5f0a68fca1f64).
   Define package contents for each agent, assemble a closed ZIP, and reject secrets,
   customer data, customer configuration, incomplete artifacts, and unsafe output.

4. **Supply-chain and repository security baseline**

   Notion: [Feature Backlog](https://app.notion.com/p/3a91c1ac5ec08138a0d8d08992517b0e).
   Activate the accepted Builder-side checks, thresholds, exception process, and
   required GitHub evidence for source and generated package artifacts.

5. **Builder-side production-readiness validation and package acceptance evidence**

   Notion: [Feature Backlog](https://app.notion.com/p/3a91c1ac5ec081bd9e2ee126ae2d2ea9).
   Combine the earlier evidence into one repeatable release decision. Only this package
   may mark a ZIP as ready for delivery.

The implementation entry point for the sequence is `composeBuilderDelivery`.
It retains the exact outputs from briefing validation, immutable adaptation,
assembly, evaluation, policy, human gate, package construction, and readiness;
it never re-accepts a caller-substituted intermediate artifact.

The legal follow-up remains separately tracked in
[Issues & Open Questions](https://app.notion.com/p/3a91c1ac5ec081428472cbdd3533cd36).

## Required working method

For every package:

1. Read this plan, the accepted product boundary, applicable architecture contracts,
   and the linked Notion item. Check that all dependencies are `Done`.
2. Keep exactly one delivery package `In progress`. Do not begin the next package while
   the active package lacks implementation, tests, documentation, or evidence.
3. Implement only the current package on its own `codex/` branch. Add focused tests,
   documentation, and traceability with the implementation.
4. Run the relevant type, test, package, security, and GitHub checks. Record the exact
   result, remaining risk, PR, merge, and cleanup evidence in Notion.
5. Mark a package `Done` only when its stated acceptance criteria are demonstrably
   complete. If an external decision or evidence is missing, mark it `Blocked` with the
   owner, dependency, unblock condition, and next review trigger. Do not invent a
   replacement assumption.
6. Only after the active package is `Done` or correctly `Blocked`, re-check the
   backlog and select the next dependency-eligible package.

## Final Definition-of-Done check

Before declaring Agent Builder complete, verify every item below with recorded evidence:

- contextual briefing is complete before build start;
- template adaptation and controlled feedback promotion are implemented;
- a complete versioned ZIP is produced without customer data or credentials;
- every package is validated for completeness, policy, security, and required artifacts;
- local Codex/VS Code and GitHub verification are reproducible; and
- no deployment, server operation, update, rollback, or legal follow-up is presented as
  completed Builder work.

No broad or unsupported production-ready claim is allowed. The claim applies only to a
specific ZIP that has all of the preceding Builder-side evidence.
