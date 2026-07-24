# Human Attended Contract Lock v0.1

This Task 20 governance slice replaces further Claude participation with a bounded,
host-attested human decision. It does not grant the implementation controller, a model,
or the repository any self-approval authority.

`human-contract-approval/1` is canonical, persisted inside the locked contract and
digest-bound to the exact run, step, base SHA, reconciliation binding and unsigned
candidate contract. It also records opaque digests for the trusted attestor descriptor
and reviewer identity, an approve/reject decision, and a bounded validity window.

The `HumanAttestedContractNegotiator` is deliberately local and has no process, network
or model integration. A host must inject already-verified approval evidence. It rejects
missing, malformed, rejected, expired, altered or differently-bound evidence. It never
falls back to Claude.

For replay compatibility, legacy `locked-step-contract/1` values without
`contractLockMode` retain their historical Claude interpretation. A new
`contractLockMode: "human_attested"` value requires a digest-valid approval and is
checked again by the reducer when the `ContractLocked` event is persisted. Thus an
adapter cannot claim a human lock merely by emitting a contract-shaped value.

This is the final permitted transparent governance commit in the current four-commit
Roadmap Base Reconciliation proof. Once merged and independently evidenced, Step 16 can
be selected against the immutable Step 15 domain base plus the complete verified chain.
