---
title: "agent-builder - PR #1: Control Plane Schema und Spec Assembler v0.1"
date: "2026-07-23"
repository: "agent-builder"
work_reference: "PR #1"
source_links:
  - "https://github.com/KonstantinData/agent-builder/pull/1"
  - "D:\\Git-GitHub\\Repositories\\condata\\agent-builder\\docs\\architecture\\agent-builder-control-plane.md"
notion_tracker: "https://app.notion.com/p/3a51c1ac5ec081c1869cd3cfb70493a6"
status: "draft"
---

# agent-builder - PR #1: Control Plane Schema und Spec Assembler v0.1

## 1. Problem verstehen

PR #1 legt den ersten belastbaren Implementierungsschnitt fuer den `agent-builder`
an. Das Kernproblem: Ein Builder Agent soll andere Agents entwerfen koennen, ohne
selbst Berechtigungen, Runtime-Zugriffe oder Deployments zu vergeben.

Ohne harte Grenze wuerde so ein System schnell zur rekursiven
Berechtigungsmaschine: Ein Agent baut einen weiteren Agent, gibt ihm zu breite
Tools, dieser ruft weitere Agents auf, und niemand kann spaeter sauber belegen,
welche Faehigkeiten bewusst freigegeben wurden.

Das Ziel des PRs ist deshalb nicht "einen Agent lauffaehig machen", sondern
zuerst die Kontrollgrundlage schaffen: Schemas, Invarianten und einen kleinen
Assembler, der aus einem Builder-Entwurf nur dann eine finale Spec macht, wenn
alle offenen Rollen auf konkrete Agent-IDs aufgeloest wurden.

## 2. Systemkontext verstehen

Das Repository ist `agent-builder`. Die Arbeit gehoert zum Bereich
`condata.io` und zum Aufbau eines Agent Builder Frameworks.

Die wichtigste Architekturquelle ist
`docs/architecture/agent-builder-control-plane.md`. Dort steht die zentrale
Trennung:

- Die `Control Plane` entscheidet, validiert, genehmigt, historisiert und
  widerruft.
- Die `Data Plane` fuehrt nur aus, was die Control Plane bereits genehmigt hat.

Der PR bleibt bewusst vor der Runtime stehen. Es gibt noch keine Cloudflare
Workers, keine Durable Objects, keine Registry, keine Datenbank und kein
Deployment Gate. Der Schnitt ist absichtlich klein: TypeScript/Zod-Schemas,
pure Policy-Funktionen und ein reiner Spec Assembler.

Wichtig ist auch die Trennung zwischen `BuilderIntentDraft` und
`AgentSpecContent`. Der Draft darf rollenbasierte Wuensche enthalten, zum
Beispiel `calleeRole`. Die finale Spec darf das nicht. Sie muss konkrete
`calleeSpecId`- und `calleeVersionOrChannel`-Bindings enthalten.

## 3. Lösung verstehen

Der PR baut drei Schichten:

1. `src/schema/`: Zod-Schemas fuer die sieben Kernartefakte der Control Plane.
2. `src/invariants/`: reine Funktionen, die wichtige Sicherheitsregeln pruefen.
3. `src/assembler/`: ein deterministischer Uebersetzer von Draft plus Kontext zu
   finaler, gehashter Spec oder strukturierten Ablehnungsgruenden.

Die wichtigste Idee ist: Der Builder beschreibt Absichten, aber der Assembler
und spaeter die Control Plane machen daraus nur dann eine Spec, wenn alles
aufgeloest, validiert und hashbar ist.

Der Assembler ist keine Registry und kein Gate. Er bekommt alle Kandidaten
injiziert:

```ts
assembleSpec(draftCandidate, {
  approvedSpecs,
  trustDomains,
});
```

Dadurch bleibt er testbar und deterministisch. Wenn eine Rolle nicht gefunden
wird, wird der Draft abgelehnt. Wenn mehrere unterschiedliche Specs dieselbe
Rolle erfuellen, wird ebenfalls abgelehnt. Nur wenn genau eine Spec-ID passt,
wird daraus ein konkreter Agent-Call.

## 4. Dateien und Code konkret durchgehen

`docs/architecture/agent-builder-control-plane.md` beschreibt das Zielmodell.
Besonders wichtig sind die Invarianten: keine direkten Deploys durch den
Builder, keine executable Specs, keine Wildcards, keine unresolved Rollen in
finaler Spec, keine Agent-Calls ohne explizite Edge, keine Budget-Erhoehung
entlang einer Call Chain.

`src/schema/agent-spec-content.ts` definiert die finale, immutable
`AgentSpecContent`. Dieses Schema enthaelt `declaredRoles`, aber keine
`calleeRole`. Rollen sind Discovery-Metadaten, keine Runtime-Berechtigung.
Finale Agent-Calls sind resolved:

```ts
declaredAgentCalls: z.array(ResolvedAgentCallSchema)
```

`src/schema/builder-intent-draft.ts` definiert den vor-finalen
`BuilderIntentDraft`. Hier darf `calleeRole` vorkommen, weil der Builder noch
formulieren darf: "Ich brauche einen Agent mit dieser Rolle." Dieser Draft ist
aber nicht ausfuehrbar.

`src/invariants/classify-delta.ts` klassifiziert Aenderungen zwischen zwei
Spec-Versionen. Erweiterungen an Tools, Tool-Parametern, Agent-Call-Intents,
Budgets, Memory Scope, Trust Domain oder `declaredRoles` werden konservativ als
`capability-expanding` behandelt. Das ist wichtig, weil solche Aenderungen
spaeter Evaluation und Deployment Gate erzwingen sollen.

`src/invariants/cycle-detection.ts` prueft zwei Dinge: ob eine Runtime-Call-Chain
einen Zyklus enthaelt und ob eine neue Graph-Kante statisch einen Zyklus
erzeugen wuerde.

`src/invariants/budget-monotonicity.ts` prueft, dass Budgets entlang einer
Call-Kette nur sinken. Ein Child-Agent darf nicht ein groesseres Budget
bekommen als der Parent noch uebrig hat.

`src/assembler/assemble-spec.ts` ist der zentrale Step-3-Code. Er validiert den
Draft an der Grenze, prueft die Trust Domain, loest Rollen ueber
`resolveCalleeRole` auf, weist Version und `parentVersion` zu, berechnet einen
deterministischen Hash und validiert das finale Objekt erneut gegen
`AgentSpecContentSchema`.

`src/assembler/role-resolution.ts` enthaelt eine wichtige Designentscheidung:
Mehrere Versionen derselben `specId` sind nicht mehrdeutig. Der Assembler nimmt
deterministisch die hoechste Version. Mehrere verschiedene `specId`s mit
derselben Rolle sind dagegen `ambiguous_callee_role`.

`src/assembler/content-hash.ts` kanonisiert Objekte durch rekursiv sortierte
Keys und hasht dann den Inhalt ohne bestehendes `contentHash`. Dadurch haengt
der Hash vom freigegebenen Inhalt ab, nicht von zufaelliger Property-Reihenfolge.

Die Tests in `tests/schema/`, `tests/invariants/` und `tests/assembler/`
decken die Positiv- und Negativfaelle ab: Wildcards werden abgelehnt, Rollen
leaken nicht in finale Specs, Ambiguitaet wird erkannt, Hashing ist
deterministisch, und Deltas werden konservativ klassifiziert.

## 5. Entscheidungen erklären

Die wichtigste Entscheidung war TypeScript durchgaengig. Da die spaetere Data
Plane vermutlich TypeScript-nah bleibt, vermeidet ein gemeinsames
TypeScript/Zod-Modell fruehen Schema-Drift zwischen Python und TypeScript.

Die zweite wichtige Entscheidung war `declaredRoles` in `AgentSpecContent`.
Rollen sind Teil des immutable Inhalts, weil die Aufloesung sonst ueber Zeit
anders ausfallen koennte, ohne dass sich die Spec-Version aendert. Gleichzeitig
bleiben Rollen reine Discovery-Metadaten. Sie geben keine Runtime-Rechte.

Die dritte Entscheidung war der pure/injected Assembler. Statt jetzt schon ein
Registry-Interface oder eine Datenbank zu entwerfen, bekommt der Assembler
`approvedSpecs` und `trustDomains` als Parameter. Das haelt Step 3 klein und
testbar.

Eine weitere Entscheidung ist die konservative Delta-Klassifikation. Wenn ein
Feld nicht sicher als "enger" bewiesen werden kann, wird eine Aenderung als
Expansion behandelt. Das reduziert das Risiko von Privilege Creep.

Bewusst unveraendert blieb die echte Trust-Domain-Policy-Auswertung. Felder wie
`allowedAgentRoles` und `crossDomainRules` sind fuer v0.1 noch freie Strings.
Das ist akzeptiert, muss aber vor echter Policy-Auswertung strukturiert werden.

## 6. Konzepte abstrahieren

Das zentrale Architekturkonzept ist die Trennung von Absicht, Spezifikation und
Ausfuehrung:

- `BuilderIntentDraft`: Was der Builder vorschlaegt.
- `AgentSpecContent`: Was immutable, hashbar und reviewfaehig wird.
- `Runtime/Data Plane`: Was spaeter tatsaechlich ausgefuehrt wird.

Ein zweites Konzept ist "resolved before executable". Alles, was im Draft noch
weich oder semantisch ist, muss vor der finalen Spec in harte IDs, Versionen
und Katalogwerte uebersetzt werden.

Ein drittes Konzept ist "Policy zuerst als pure Funktion". Bevor eine Runtime
existiert, koennen Invarianten bereits als kleine, deterministische Funktionen
und Tests festgelegt werden. Dadurch wird spaeter nicht die Runtime zum Ort, an
dem Grundsatzentscheidungen versteckt werden.

Ein viertes Konzept ist konservative Governance: Wenn eine Aenderung potenziell
Faehigkeiten erweitert, wird sie nicht als harmlos behandelt. Das gilt auch fuer
Dinge, die auf den ersten Blick nur Metadaten sind, etwa `declaredRoles`.

## 7. Debugging und Prüfung zeigen

Die wichtigsten Checks fuer diesen PR sind:

```bash
pnpm typecheck
pnpm test
```

`pnpm typecheck` prueft die TypeScript-Typen inklusive strenger Optionen wie
`strict`, `noUncheckedIndexedAccess` und `exactOptionalPropertyTypes`.

`pnpm test` fuehrt Vitest aus. Im Acceptance Review waren 15 Testdateien und 63
Tests gruen.

Wenn der Assembler unerwartet ablehnt, sollte man zuerst in
`src/assembler/assemble-spec.ts` und `src/assembler/assembly-types.ts`
nachsehen. Die Ablehnungsgruende sind strukturiert:

- `schema_validation_failed`
- `trust_domain_not_found`
- `unresolved_callee_role`
- `ambiguous_callee_role`
- `content_validation_failed`

Wenn eine Rolle nicht aufgeloest wird, ist `src/assembler/role-resolution.ts`
der erste Ort. Dort prueft man, ob die Kandidaten in `approvedSpecs` die
passende `declaredRole` besitzen.

Wenn eine Spec-Aenderung falsch klassifiziert wird, ist
`src/invariants/classify-delta.ts` relevant. Typische Fehler waeren: neue
Intents auf bestehender Edge werden nicht erkannt, Tool-Params werden ignoriert
oder Rollen-Aenderungen werden faelschlich als neutral behandelt. Genau solche
Regressionsfaelle wurden in diesem PR nachgezogen.

Was die Tests noch nicht beweisen: Es gibt noch keine echte Registry, kein
Deployment Gate, keine Datenbank und keine Runtime. Die Tests beweisen also die
lokalen Schema-, Invariant- und Assembler-Regeln, nicht das spaetere
Produktionsverhalten.

## 8. Transfer und Übungen ableiten

Das Muster aus diesem PR ist uebertragbar: Baue bei riskanten Agenten- oder
Automationssystemen zuerst deklarative Artefakte und pruefbare Invarianten,
bevor du Runtime und Integration baust.

Wiederverwenden sollte man diesen Ansatz, wenn ein System Faehigkeiten vergeben,
andere Komponenten aufrufen oder langfristig auditierbar bleiben muss. Ein
anderer Ansatz waere besser fuer einfache Wegwerf-Prototypen ohne Persistenz,
ohne externe Tools und ohne Sicherheitsgrenzen.

### Übung 1: Code lesen

Lies `src/assembler/assemble-spec.ts` und erklaere, warum der Code den Draft
zuerst validiert, danach Rollen aufloest und erst am Ende `contentHash`
berechnet.

### Übung 2: Änderung selbst nachvollziehen

Fuege in einem Test einen zweiten approved Spec mit derselben `declaredRole`,
aber anderer `specId` hinzu. Erwartung: `assembleSpec` muss mit
`ambiguous_callee_role` ablehnen.

### Übung 3: Fehler finden

Stell dir vor, eine finale `AgentSpecContent` enthaelt ploetzlich `calleeRole`.
Wo wuerdest du anfangen? Erwartete Spur: `AgentSpecContentSchema`,
`BuilderIntentDraftSchema`, `assembleSpec` und der Test "never leaks calleeRole".

## Follow-Up

- Trust-Domain-Regeln strukturieren, sobald das Werteuniversum fuer
  `allowedAgentRoles` und `crossDomainRules` feststeht.
- Step 4 planen: Policy/Evaluation Harness v0.1, weiterhin ohne Runtime.
- Spaeter klaeren, wie Registry, Deployment Gate und Runtime-Bindings die jetzt
  definierten Artefakte verwenden.
