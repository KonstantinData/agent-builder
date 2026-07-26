# Persisted Authorization Store Contract v0.1

`persisted-authorization-store/1` defines a narrow, host-injected persistence boundary. It is a Control Plane contract only: this repository supplies no database, migration, credential, KMS key, executor, receipt redemption, or deployment.

Every record and readback request has a non-wildcard `tenant_id`; a reservation id is never globally sufficient. A record binds one Step-16 local receipt to an immutable parent-decision link. Subject, authority revision/digest, parent run id, parent context digest, reservation id, and `recorded_at` must exactly match the receipt. This is evidence, never new authority.

Readback returns only `found`, `absent`, or `unavailable { store_error }`. Unknown fields, malformed records, tenant ambiguity, missing records, and adapter failures are not successful evidence. No adapter is wired into the Runtime Harness: a local file, fake, or model response cannot become a production store by accident.

Before a real adapter can be accepted, its owner must supply an accepted tenancy/isolation design, atomic compare-and-insert semantics, recovery and backup contract, transaction/readback proof, credential/key-custody boundary, migration plan, operational runbook, and restart/conflict/timeout/cross-tenant-denial tests. Receipt redemption, liveness, and at-most-once execution remain separately blocked.
