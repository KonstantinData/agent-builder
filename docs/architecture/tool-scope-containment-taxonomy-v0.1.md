# Tool Scope Containment Taxonomy v0.1

> Status: **Proposed.** `tool-scope/1` remains structural and exact-only. This proposal
> defines no active Runtime Harness behavior until separately accepted and migrated.

## Contract

Introduce `tool-scope-containment/1`; never reinterpret historical `legacy-exact/1`
or hashed `tool-scope/1` evidence. Every comparison requires equal tenant, tool and
model version, exact canonical selector set, and trusted host readback. Otherwise it
is `indeterminate` and blocks.

| Tool | Canonical selectors | Permitted containment |
| --- | --- | --- |
| `http.fetch` | egress-profile, normalized HTTPS origin, absolute segment-path prefix | same profile/origin; same path or true segment child |
| `fs.read` | immutable mount ID, normalized relative POSIX path prefix | same mount; same path or true segment child |
| `fs.write` | immutable mount ID, normalized relative POSIX path prefix | same mount; same path or true segment child |
| `db.query` | connection ID, schema, relation | equality only |
| `email.send` | sender ID, recipient domain, full mailbox | equality only |
| `crm.enrich` | tenant-bound connection, closed object type, record ID | equality only |

Unknown selectors, omitted selectors, wildcards, cross-model comparison, legacy-to-
structured comparison, noncanonical input, adapter uncertainty and cross-tenant input
are never containment. Results are `equal`, `narrower`, `broader`, `disjoint`, or
`indeterminate`; only the two path algebras may emit `narrower`/`broader`.

## Host enforcement requirements

HTTP permits HTTPS only and rechecks every redirect; unknown DNS/proxy/TLS/target-IP
state blocks. Filesystem enforcement resolves the final handle before effect; symlinks,
junctions, devices, mount drift or path ambiguity block. Database adapters must prove a
single accepted read relation from an accepted AST; dynamic SQL, joins, procedures and
unknown views block. Mail and CRM adapters read back effective recipients and exact
connection/object/record identity; batch, redirect, BCC, reply-to or ambiguity blocks.

## Delta and acceptance rules

Removal or demonstrably `narrower` scope is reducing; `equal` is neutral. New tools,
new declarations, `broader`, `disjoint`, mixed changes or `indeterminate` require the
full evaluation and deployment gates. Required tests cover every canonical form,
cross-tenant/model/legacy denial, prefix sibling cases, redirects/symlink ambiguity,
database/mail/CRM equality-only behavior, and delta classification. Property/fuzz tests
must precede runtime enablement.

## Non-goals

No credential, DNS, proxy, executor, dispatcher, deployment, dynamic registration, SQL
content policy, wildcard grant, or external effect is implemented here.
