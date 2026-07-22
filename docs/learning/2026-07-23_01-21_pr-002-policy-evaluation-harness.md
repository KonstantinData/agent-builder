---
title: "agent-builder - PR #2: Policy/Evaluation Harness v0.1"
date: "2026-07-23"
repository: "agent-builder"
work_reference: "PR #2"
source_links:
  - "https://github.com/KonstantinData/agent-builder/pull/2"
  - "D:\\Git-GitHub\\Repositories\\condata\\agent-builder\\src\\harness\\evaluate-policy.ts"
  - "D:\\Git-GitHub\\Repositories\\condata\\agent-builder\\src\\harness\\harness-types.ts"
notion_tracker: "https://app.notion.com/p/3a51c1ac5ec08171a3c6f9285c3341f4"
status: "draft"
---

# agent-builder - PR #2: Policy/Evaluation Harness v0.1

## 1. Problem verstehen

PR #2 baut den naechsten Kontrollschritt nach dem Spec Assembler aus PR #1.
Der Assembler kann aus einem `BuilderIntentDraft` eine validierte,
aufgeloeste und gehashte `AgentSpecContent` erzeugen. Danach fehlt aber noch
eine Entscheidung: Darf diese Spec ueberhaupt Richtung Deployment Gate weiter?

Ohne Policy/Evaluation Harness muesste entweder ein Mensch jede Spec manuell
auf Trust-Domain-Regeln, verbotene Tool-Kombinationen und Evaluationsergebnisse
pruefen, oder jede gehashte Spec wuerde praktisch automatisch weiterlaufen.
Beides waere fuer einen Agent Builder riskant.

Das Ziel von PR #2 ist deshalb eine reine Entscheidungsschicht: Sie sagt, ob
eine Spec abgelehnt wird, ob Evaluation erforderlich ist oder ob sie als
`approved_pending_gate` an ein spaeteres Deployment Gate weitergegeben werden
darf. Sie erzeugt keine Freigabe-Artefakte und aendert keine Lifecycle-States.

## 2. Systemkontext verstehen

Das Repository ist `agent-builder`, Arbeitsbereich `condata.io`. PR #2 baut auf
PR #1 auf:

- `AgentSpecContent` ist bereits immutable, versioniert und hashbar.
- `classifyDelta` kann Spec-Aenderungen als `capability-expanding`,
  `capability-reducing` oder `neutral` einordnen.
- Der Spec Assembler bleibt eine reine Funktion und fuehrt keine Runtime aus.

Der neue Harness liegt in `src/harness/`. Er gehoert zur Control Plane, nicht
zur Data Plane. Das ist die wichtigste Systemgrenze: Der Harness entscheidet
ueber Policy- und Evaluationsergebnisse, aber er fuehrt keine Evaluation-Suite,
keine Sandbox, keine Runtime und keine Deployments aus.

Die relevanten Artefakte sind:

- `PolicyContext`: injizierter Kontext aus approved Specs, Trust Domains und
  verbotenen Tool-Kombinationen.
- `EvaluationOutcome`: bereits fertiges Evaluationsergebnis.
- `PolicyEvaluationResult`: strukturierte Entscheidung fuer den naechsten
  Schritt.

## 3. Lösung verstehen

PR #2 fuehrt `evaluatePolicy(candidate, context, evalOutcome?)` ein.

Die Funktion kombiniert vier Pruefbereiche:

1. Trust-Domain-Compliance: Sind deklarierte Tools und Rollen in der Trust
   Domain erlaubt?
2. Forbidden Tool Combinations: Enthaelt die Spec eine injizierte verbotene
   Tool-Kombination?
3. Capability Delta: Ist die Spec neu, capability-erweiternd oder
   capability-reduzierend?
4. Evaluation Outcome: Wenn ein Ergebnis vorliegt oder Evaluation noetig ist,
   passt Suite und Score zur Spec?

Das Ergebnis ist bewusst keine Freigabe:

```ts
type PolicyEvaluationResult =
  | { outcome: "rejected"; reasons: PolicyRejectionReason[] }
  | { outcome: "evaluation_required" }
  | { outcome: "approved_pending_gate"; delta: DeltaClassification | "initial" };
```

Damit bleibt das Deployment Gate ein spaeterer Schritt. Der Harness liefert nur
die entscheidungsreife Information.

## 4. Dateien und Code konkret durchgehen

`src/harness/harness-types.ts` definiert die gemeinsame Sprache der Harness-
Schicht. `PolicyContext` ist rein injiziert: keine Registry, keine DB, keine
Runtime. `EvaluationOutcome` ist ebenfalls nur Dateninput; der Harness fuehrt
nichts aus.

`src/harness/evaluate-policy.ts` orchestriert die Entscheidung. Zuerst sammelt
die Funktion harte Ablehnungsgruende aus Trust-Domain- und
Forbidden-Combination-Pruefungen. Danach sucht sie bei neuen Versionen die
Parent-Spec und nutzt `classifyDelta`, um zu entscheiden, ob Evaluation
erforderlich ist.

Wichtig ist die Review-Fix-Logik:

```ts
if (evalOutcome) {
  const evalReasons = checkEvaluationOutcome(candidate, evalOutcome);
  if (evalReasons.length > 0) {
    return { outcome: "rejected", reasons: evalReasons };
  }
  return { outcome: "approved_pending_gate", delta };
}
```

Ein uebergebenes Evaluationsergebnis wird immer geprueft. Auch wenn eine
`capability-reducing` Aenderung eigentlich keine Evaluation gebraucht haette,
darf ein bekannt fehlgeschlagenes Ergebnis nicht ignoriert werden.

`src/harness/trust-domain-check.ts` prueft, ob `declaredTools` und
`declaredRoles` zur Trust Domain passen. Fuer v0.1 gilt:
`allowedToolClasses` wird als exakte Tool-ID interpretiert, weil es noch keine
eigene Tool-Taxonomie gibt. Leere Allow-Listen bedeuten Default-Deny.

`src/harness/forbidden-combinations.ts` prueft injizierte verbotene
Tool-Kombinationen. Eine Kombination ist verletzt, wenn die Spec alle Tools
dieser Kombination enthaelt. Leere Kombinationen werden bewusst ignoriert, weil
`[].every(...)` sonst technisch immer `true` waere und jede Spec faelschlich
blockieren wuerde.

`src/harness/evaluation-check.ts` macht nur einen Schwellenwertvergleich:
`suiteRef` muss passen und `score >= passThreshold` gelten. Ein Suite-Mismatch
bricht kurz ab, weil ein Score aus der falschen Suite keine Aussage ueber die
richtige Evaluation macht.

Die Tests in `tests/harness/` decken diese Grenzen ab: Trust-Domain-Verletzung,
verbotene Kombination, leere Kombination, Evaluation-Suite-Mismatch,
Threshold-Fehler, Evaluation-Required-Pfad und der Review-Fix fuer
fehlgeschlagene Evaluation bei reduzierendem Delta.

## 5. Entscheidungen erklären

Die wichtigste Entscheidung war: Step 4 liefert nur eine Entscheidung, kein
Deployment Gate. Das verhindert, dass Policy Harness, Approval und Lifecycle
wieder vermischt werden.

Die zweite Entscheidung war eine injizierte Regel-Liste fuer verbotene
Tool-Kombinationen. Damit bleibt das Regelwerk testbar und austauschbar,
anstatt erste Beispielregeln hart in den Code zu schreiben.

Die dritte Entscheidung war Default-Deny fuer Trust-Domain-Listen. Wenn eine
Domain keine erlaubten Tools oder Rollen angibt, ist nichts erlaubt. Das passt
zum Least-Privilege-Modell der Architektur.

Die vierte Entscheidung war, `EvaluationOutcome` immer zu pruefen, sobald es
uebergeben wird. Urspruenglich wurde es bei reduzierenden Deltas ignoriert.
Das Review hat korrekt erkannt, dass ein bekannter Fehlbefund nicht
weggeworfen werden darf.

Bewusst unveraendert blieben `allowedDataClasses` und `crossDomainRules`.
Diese Trust-Domain-Felder sind noch nicht enforcebar, weil das Werteuniversum
und die Cross-Domain-Semantik spaeter sauber modelliert werden muessen.

## 6. Konzepte abstrahieren

Das zentrale Konzept ist eine Policy-Entscheidung als reine Funktion. Eine
solche Funktion braucht keine Datenbank und keine Runtime, sondern nur
validierte Eingabedaten und liefert ein strukturiertes Ergebnis.

Ein zweites Konzept ist "required vs supplied". Evaluation kann fuer einen
Delta-Typ nicht erforderlich sein. Wenn aber ein Evaluationsergebnis geliefert
wird, muss es trotzdem ernst genommen werden. Pflicht und Evidenz sind zwei
verschiedene Fragen.

Ein drittes Konzept ist "policy as data". Verbotene Tool-Kombinationen werden
injiziert. Dadurch kann ein spaeterer Policy Owner Regeln liefern, ohne dass
der Harness selbst zu einem Ort voller hartcodierter Sonderfaelle wird.

Ein viertes Konzept ist "no side effects before the gate". Der Harness darf
sagen, was passieren soll, aber er erzeugt keine `ApprovalArtifact`s, setzt
keine States und startet keine Evaluation. Dadurch bleibt die Control Plane in
kleine, pruefbare Schritte zerlegt.

## 7. Debugging und Prüfung zeigen

Die wichtigsten Pruefbefehle fuer PR #2 waren:

```bash
pnpm typecheck
pnpm test
```

Im Acceptance Review waren 19 Testdateien und 86 Tests gruen.

Wenn `evaluatePolicy` unerwartet `rejected` liefert, sollte man zuerst die
`reasons` ansehen. Typische Gruende:

- `trust_domain_not_found`
- `tool_not_allowed_in_domain`
- `role_not_allowed_in_domain`
- `forbidden_tool_combination`
- `parent_version_not_found`
- `evaluation_suite_mismatch`
- `evaluation_below_threshold`

Wenn ein Delta falsch behandelt wird, liegt der Einstieg bei
`src/invariants/classify-delta.ts`; `evaluatePolicy` nutzt diese Entscheidung
nur weiter.

Wenn eine Evaluation falsch ausgewertet wird, ist
`src/harness/evaluation-check.ts` der richtige Ort. Dort wird nur Suite und
Score geprueft, nicht die Ausfuehrung einer Suite.

Was die Tests nicht beweisen: Es gibt weiterhin kein echtes Deployment Gate,
keine Persistenz, keine Registry und keine Runtime. Der PR beweist die lokale
Policy-Entscheidung, nicht den spaeteren Gesamtprozess.

## 8. Transfer und Übungen ableiten

Das Muster ist uebertragbar auf viele Governance- oder Automationssysteme:
Baue eine pure Entscheidungsschicht, bevor du Freigabe, Persistenz oder
Ausfuehrung baust.

Der Ansatz passt besonders, wenn ein System riskante Aktionen vorbereiten,
aber noch nicht selbst ausfuehren soll. Ein anderer Ansatz waere nur dann
sinnvoll, wenn es sich um einen simplen Prototyp ohne Sicherheitsgrenzen,
Auditbedarf und externe Effekte handelt.

### Übung 1: Code lesen

Lies `src/harness/evaluate-policy.ts` und erklaere, warum Trust-Domain- und
Forbidden-Combination-Verletzungen vor der Delta-/Evaluation-Logik ausgewertet
werden.

### Übung 2: Änderung selbst nachvollziehen

Fuege in `tests/harness/forbidden-combinations.test.ts` eine zweite verbotene
Kombination hinzu und pruefe, dass beide Treffer als eigene Reasons
zurueckgegeben werden.

### Übung 3: Fehler finden

Stell dir vor, eine `capability-reducing` Spec bekommt ein
`EvaluationOutcome` mit falscher `suiteRef`, wird aber trotzdem
`approved_pending_gate`. Wo wuerdest du suchen? Erwartete Spur:
`evaluate-policy.ts`, danach `evaluation-check.ts`, danach der Regressionstest
fuer supplied failing eval outcomes.

## Follow-Up

- `TrustDomain.allowedDataClasses` und `crossDomainRules` vor echter
  Policy-Auswertung strukturieren und enforcebar machen.
- Klaeren, ob `allowedToolClasses` dauerhaft exakte Tool-IDs bleiben oder ob
  eine eigene Tool-Taxonomie gebraucht wird.
- Step 5 planen: Deployment Gate v0.1 mit `ApprovalArtifact` und
  Lifecycle-Uebergaengen, weiterhin ohne Data-Plane-Runtime.
