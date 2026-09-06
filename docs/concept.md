# Gale Dispatcher — Concept

> Status: concept / decision document. **Nothing in it is implemented yet** — this repo is
> still an unmodified `toto-node-template`. See
> [Appendix A](#appendix-a--current-repo-state-vs-target) for exactly what exists today.
> Last revised: 2026-09-06.
>
> This document deliberately borrows its vocabulary from
> [`agent-coder/docs/concept.md`](https://github.com/nicolasances/agent-coder/blob/main/docs/concept.md)
> §2. Where a term is defined there, it means the same thing here. That doc calls this
> service *the Dispatcher* and declares it out of its own scope — this is that service.

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [Core Concepts](#2-core-concepts)
3. [Features](#3-features)
4. [Data Models](#4-data-models)
5. [Key User Stories](#5-key-user-stories)
6. [Constraints & Assumptions](#6-constraints--assumptions)
7. [Open Questions](#7-open-questions)
8. [Not Doing (and Why)](#8-not-doing-and-why)
9. [Ideas for Future Versions](#9-ideas-for-future-versions)
- [Appendix A — Current repo state vs. target](#appendix-a--current-repo-state-vs-target)

---

## 1. Purpose & Scope

### 1.1 What is this?

An HTTP service that turns **one POST into one agent run**, and hands back an id to track it.

```
POST /agents/agent-coder/tasks          →  { "taskId": "…" }
     │
     ├─ 1. resolve agentId in the Agent Registry
     ├─ 2. validate the required task fields
     ├─ 3. mint a taskId
     ├─ 4. write the Task File to GCS      ← before the trigger, always
     ├─ 5. record the task in Mongo
     └─ 6. trigger a Cloud Run Job execution with TASK_ID as an override

GET  /tasks/{taskId}                    →  { "status": "running", … }
```

That is the whole service. It is a **trigger and an index**, not an orchestrator. It does
not decide that a task should exist, does not retry, does not schedule, does not know what
a repository is. Those are either the caller's job or `agent-coder`'s job.

The one idea that makes it more than a shell script in a container: an **Agent Registry**.
An agent is a named row — `agentId`, the Cloud Run Job to execute, the bucket prefix its
Task Files live under, and the task fields it requires. Adding `agent-reviewer` later means
adding a row, not writing code.

### 1.2 Who is it for?

Three callers, in the order they arrive:

| Caller | What they need from this |
|---|---|
| **Me, via curl** | To start an `agent-coder` run without a GCP-authenticated shell and without hand-assembling a `task.json`. This is the caller that exists today. |
| **A Gale UI** | To list tasks, show status, and dispatch new ones. Drives the shape of `GET` more than `POST`. |
| **Another agent / orchestrator** | Programmatic dispatch. This is the caller that makes cost and idempotency real problems — see [§6](#6-constraints--assumptions) and OQ-04. |

### 1.3 What problems does it solve?

- **Starting a run currently takes two local commands and a GCP identity.** You must copy a
  `task.json` to the right GCS path *and* run `gcloud run jobs execute` with a matching
  `TASK_ID` override. A browser cannot do that. Another agent cannot do that.
- **Three strings have to agree, and nothing enforces it.** The Task File's `taskId`, its
  GCS folder name, and the `TASK_ID` execution override are the same value by convention
  only (`agent-coder` §4.1, §4.4). Getting one wrong produces a container that starts and
  then can't find its work.
- **`repoURL` is required in practice but unvalidated in code.** `TaskSpec.from_dict()`
  only checks `taskId` and `prompt`, then indexes `task_details["repoURL"]` directly. A
  Task File missing it fails inside the container instead of at the API boundary.
- **"What happened to that run?" has no answer outside the GCP console.** No id you can
  hand to a UI, no record that survives Cloud Run's execution retention.
- **The `agentId → job → bucket prefix` mapping is written down nowhere.** `agent-coder`
  hardcodes `AGENT_NAME = "coder"` and writes to `coder/{task_id}/task.json`; this service
  wants to call it `agent-coder`. Today that mismatch lives only in someone's head.

### 1.4 Out of scope (v1)

- **Deciding that a task exists.** No GitHub webhook, no issue-label trigger, no planner.
  Something else forms the prompt; this service runs it.
- **Orchestration.** No retries, no scheduling, no task dependencies, no timeouts of our
  own. `agent-coder`'s exit code taxonomy (§4.5) exists so the *caller* can make those
  decisions.
- **Cancelling a run** — deliberately deferred, see [§8](#8-not-doing-and-why).
- **Logs, traces, `RunResult` subpaths, streaming progress** — see [§8](#8-not-doing-and-why) for why these are gated on `agent-coder`, not on us.
- **Listing tasks.** The UI caller will want it; v1 does not have it (see [§9](#9-ideas-for-future-versions)).
- **Concurrency caps and budget enforcement.** Discussed, rejected for v1, consequences written down in [§8](#8-not-doing-and-why).
- **Any runtime other than Cloud Run Jobs.** No GKE seam.
- **An API for managing agents.** The registry is code.

---

## 2. Core Concepts

| Term | Definition |
|---|---|
| **Dispatcher** | This repository. The always-on HTTP tier that starts agent runs and indexes them. `agent-coder` §2 names this component and places it outside itself; this is it. |
| **Agent** | A containerised worker that takes one Task and terminates. Identified by an `agentId`. `agent-coder` is the only one today. |
| **Agent Registry** | The map from `agentId` to everything needed to dispatch to that agent: Cloud Run Job name, region, bucket prefix, required task fields. A literal in `Config.ts` for v1. |
| **Agent Job** | The Cloud Run Job *resource* backing an agent. Long-lived, deployed by the agent's own pipeline. The Dispatcher only ever executes it — it never creates or updates it. |
| **Task** | A unit of work small enough for one unattended run. What the caller POSTs. |
| **Task File** | `task.json` in GCS, holding the task payload. Written once by the Dispatcher **before** triggering, immutable — the audit record of what was asked. Same object `agent-coder` §4.1 reads. |
| **Task Record** | One Mongo document per task: the Dispatcher's own index. Maps `taskId` to its agent, its Cloud Run execution, and its last-known status. The only state this service owns. |
| **Dispatch** | The act of writing a Task File and starting an execution for it. One POST = one dispatch = one execution. |
| **Execution** | One Cloud Run Job execution. `agent-coder` §2 calls this a **Run**. One per dispatch, never more — a retry is a new Task with a new id. |
| **Bucket Prefix** | The folder under the agents-data bucket that an agent reads its Task Files from (`coder/` for `agent-coder`). Distinct from `agentId`, and that distinction is the point. |
| **Agents Data Bucket** | `gs://{GCP_PID}-agents-data`. Shared across agents, one prefix each. Derived from the project id, not separately configured (`agent-coder` §4.1). |

---

## 3. Features

### 3.1 `POST /agents/{agentId}/tasks` — dispatch a task

The one write operation. Six steps, and **the order is load-bearing**:

```
1. resolve agentId          → 404 if not in the registry
2. validate required fields → 400, listing what's missing
3. mint taskId
4. write Task File to GCS   → gs://{GCP_PID}-agents-data/{bucketPrefix}/{taskId}/task.json
5. insert Task Record       → status: "starting"
6. trigger the execution    → TASK_ID={taskId} as a per-execution override
7. update Task Record       → status: "running"
```

**Why the Task File is written before the trigger.** `agent-coder` §4.1 is explicit: the
container resolves `TASK_ID` against GCS the moment it starts. Trigger first and you race
the container to its own input. The write is cheap and idempotent; the ordering is free.

**Why the record is inserted before the trigger.** The alternative — trigger, then insert —
has a window where a crash leaves a *running, billing, invisible* execution with no record.
Inserting first inverts the failure: a crash leaves a record with no execution, which is
visible and harmless. That is the right way round.

**Design decision — step 4 writes the payload through, untyped.** The Dispatcher copies the
caller's body into the Task File verbatim, adding only the minted `taskId`. Step 2 checks
that the registry's `requiredTaskFields` are present and non-empty, and that is the whole
extent of its interest in the payload: it does not know what `repoURL` means, and does not
default `baseBranch`.

**The bet this rests on:** agents differ only in their task schema, never in how they are
launched. If that holds, `agent-reviewer` needs one registry row and zero lines of dispatch
code. If it breaks — an agent that needs a GKE Job rather than a Cloud Run Job — the
registry gains a runtime field and this service gains a second seam. Named in
[§6](#6-constraints--assumptions), and accepted.

Two consequences worth stating plainly:

- **Defaults belong to the agent, not to us.** `agent-coder` defaults `baseBranch` to
  `main` in `TaskSpec.from_dict()`. Duplicating that default here would create two places
  for it to drift. So we don't.
- **A typo in an optional field is not caught.** `basebranch` instead of `baseBranch` sails
  through and silently gets `agent-coder`'s default. Only *required* fields are checked.
  That is the price of the generic dispatcher, and it is the right price for now.

**Failure modes, stated rather than discovered:**

| Fails at | Result | Caller sees |
|---|---|---|
| Step 1 | Nothing happened | `404 unknown agent` |
| Step 2 | Nothing happened | `400` + the missing field names |
| Step 4 (GCS write) | Nothing started | `500`, safe to retry |
| Step 6 (trigger) | Orphan Task File + record marked `failed_to_start` | `500`, safe to retry as a *new* task |
| Between 5 and 6 (process dies) | Record stuck in `starting`, no execution ever started | Task appears permanently `starting` — a known wart, see OQ-07 |

An orphan Task File costs nothing and is never garbage-collected. It is an immutable record
of something that was asked and never ran, which is arguably worth keeping.

**Response** is `201` with the minted `taskId` — the only thing the caller needs to track
the run, and the value it will pass to `GET /tasks/{taskId}`.

### 3.2 `GET /tasks/{taskId}` — what happened to it

Read the Task Record. If its status is non-terminal, refresh it from the Cloud Run
Executions API, persist the refreshed status, and return.

**The record does not store the execution's name** *(revised — see OQ-11)*. It is a GCP
implementation detail with no meaning to any caller, so it is deliberately absent from both
the record and the response. The cost is that the join from `taskId` to execution has to be
re-established on every refresh, and **how is unresolved**: labelling the execution with the
`taskId` at dispatch, listing the job's executions and matching on the `TASK_ID` override,
or abandoning the Cloud Run API entirely in favour of `agent-coder`'s own
`task-output.json` once that exists. Whether Cloud Run's `run` call accepts a label or a
caller-chosen execution name must be verified against its API reference, not assumed.

**What it can honestly say — and what it can't.** `agent-coder`'s exit code taxonomy (§4.5)
exists to separate outcomes that demand opposite responses: `20` (the agent could not solve
it — do not retry) versus `30` (infra failed — do retry). That distinction is the most
valuable thing this endpoint could return, and **v1 probably cannot return it.** The Cloud
Run Admin API reports execution-level succeeded/failed counts; a per-attempt exit code, if
exposed at all, lives on a different resource than the execution itself. The exact shape
must be checked against Google's Cloud Run Admin API v2 reference before the response model
is fixed — not asserted from memory (OQ-01).

So v1 commits only to what is certainly available: `running` / `succeeded` / `failed`
derived from execution state, plus an `exitCode` populated *if* it turns out to be cheaply
readable and `null` otherwise. The full-fidelity answer arrives when `agent-coder`
implements `RunResult` / `task-output.json` (its §4.3, **not built yet**), at which point
this endpoint reads one GCS object and reports `status`, `prUrl`, `tokenUsage` and the rest
properly. That is the real plan; Cloud Run's execution state is the stopgap.

**Refresh-on-read, not pushed.** The alternative is to have Cloud Run execution state
changes arrive via Eventarc/Pub-Sub and update records asynchronously, making `GET` a pure
Mongo read. That is the better design *the day a UI lists fifty tasks and triggers fifty
Cloud Run API calls*. It is not the better design today, and the repo already depends on
`@google-cloud/pubsub` with an `evt/handlers/` convention in `AGENTS.md`, so the door is
open. See OQ-02.

The one design constraint this imposes: `status` must be a **stored field that a handler
could write**, not a value computed inside the delegate. Otherwise swapping to push later
means rewriting the read path.

**Note that this path carries no `agentId`.** That works only because the Task Record
indexes it. It is the single thing the Mongo index buys that GCS alone could not give:
`gs://…/{bucketPrefix}/{taskId}/…` cannot be located from a bare `taskId`.

### 3.3 The Agent Registry

A literal map in `Config.ts`. Registering an agent is a commit and a deploy — reviewable,
diffable, and requiring no CRUD API.

```typescript
export const AGENTS = {
    "agent-coder": {
        jobName: "agent-coder",              // Cloud Run Job resource
        region: "europe-west1",
        bucketPrefix: "coder",               // MUST equal AGENT_NAME in the container
        requiredTaskFields: ["repoURL", "prompt"],
    },
}
```

**`agentId` and `bucketPrefix` are separate fields on purpose.** `agent-coder` hardcodes
`AGENT_NAME = "coder"` (`runner/main.py`) — it names the repo, not a deployment choice. The
public identifier this service exposes is `agent-coder`. Rather than forcing either side to
rename, the registry holds both and makes the seam explicit. If the two are ever unified
(see OQ-10), this becomes one field and nothing else changes.

`requiredTaskFields` is what turns the pass-through of [§3.1](#31-post-agentsagentidtasks--dispatch-a-task) into something safer
than a shrug.

---

## 4. Data Models

### 4.1 `Agent` — a registry entry

| Field | Type | Notes |
|---|---|---|
| `agentId` | string | Public identifier. The `{agentId}` path segment. |
| `jobName` | string | Cloud Run Job resource name to execute. |
| `region` | string | Job's region. Not necessarily this service's. |
| `bucketPrefix` | string | Folder under the agents-data bucket. Must match the agent container's own constant. |
| `requiredTaskFields` | string[] | Validated as present and non-empty before dispatch. |

### 4.2 `TaskRecord` — the Mongo document

Collection: `tasks`. Unique index on `taskId`.

| Field | Type | Notes |
|---|---|---|
| `taskId` | string | Minted by the Dispatcher. Also the GCS folder name and the `TASK_ID` override. |
| `agentId` | string | Registry key. What makes `GET /tasks/{taskId}` resolvable without an agent in the path. |
| `status` | enum | See [§4.4](#44-status-enum). Stored, not computed — see [§3.2](#32-get-taskstaskid--what-happened-to-it). |
| `taskFilePath` | string | Full `gs://…` path. Redundant (derivable from prefix + id) but cheap and unambiguous in a UI. |
| `payload` | object | The caller's body, verbatim. Duplicates the Task File deliberately — a UI listing tasks needs prompts without N GCS reads, and the payload is immutable so the copies cannot drift. GCS remains the audit copy. |
| `exitCode` | int \| null | If readable — see OQ-01. |
| `error` | object \| null | Dispatch-time failure detail. Not agent failure detail. |
| `createdAt` | date | Record insert time. Sort key, since `taskId` is not sortable. |
| `updatedAt` | date | Last status refresh. |
| `endedAt` | date \| null | When a terminal status was first observed. |

Per `AGENTS.md`: `TaskRecord` implements `fromBSON()` / `toBSON()`, and all access goes
through a `TasksStore`.

### 4.3 The Task File written to GCS

`gs://{GCP_PID}-agents-data/{bucketPrefix}/{taskId}/task.json`, camelCase keys per
`agent-coder` §4.1's wire format note:

```json
{
  "taskId": "5f3c1e7a-…",
  "repoURL": "https://github.com/nicolasances/agent-coder.git",
  "prompt": "/implement feature described in https://github.com/…/issues/3",
  "baseBranch": "main"
}
```

Everything except `taskId` is the caller's, untouched. `baseBranch` appears only if the
caller sent it.

### 4.4 Status enum

| Status | Meaning | Terminal |
|---|---|---|
| `starting` | Record inserted, execution requested or in flight. Not yet observed running. | No |
| `running` | Cloud Run reports the execution as running. | No |
| `succeeded` | Execution completed successfully. Says nothing about whether the agent solved the task — see OQ-01. | Yes |
| `failed` | Execution failed. Conflates "agent gave up" with "clone failed" until OQ-01 is resolved. | Yes |
| `cancelled` | Execution cancelled. Reachable via console/gcloud even though v1 exposes no cancel endpoint. | Yes |
| `failed_to_start` | The trigger call itself failed. No execution exists. | Yes |

### 4.5 API shapes

**`POST /agents/agent-coder/tasks`**

```json
{
  "repoURL": "https://github.com/nicolasances/agent-coder.git",
  "prompt": "/implement feature described in https://github.com/…/issues/3",
  "baseBranch": "main"
}
```

`201`:

```json
{
  "taskId": "5f3c1e7a-…",
  "agentId": "agent-coder",
  "status": "running",
  "taskFile": "gs://…-agents-data/coder/5f3c1e7a-…/task.json"
}
```

**`GET /tasks/5f3c1e7a-…`** → `200`:

```json
{
  "taskId": "5f3c1e7a-…",
  "agentId": "agent-coder",
  "status": "succeeded",
  "exitCode": 0,
  "payload": { "repoURL": "…", "prompt": "…", "baseBranch": "main" },
  "createdAt": "2026-09-06T10:00:00Z",
  "endedAt": "2026-09-06T10:12:41Z"
}
```

Per `AGENTS.md`, request/response interfaces are private to their delegate file:
`PostAgentTask.ts`, `GetTask.ts`.

---

## 5. Key User Stories

| # | As a user, I want to… | So that… |
|---|---|---|
| US-01 | start an agent run with one HTTP call | I don't need a GCP-authenticated shell or a hand-written `task.json` to delegate a task |
| US-02 | get back an id I can hold onto | I can ask what happened later, from a script or a UI, without digging in the console |
| US-03 | be told immediately that a required field is missing | a typo fails at the API boundary, not 30 seconds later inside a container |
| US-04 | be told immediately that an agent doesn't exist | dispatching to `agent-codr` is a `404`, not a silent no-op |
| US-05 | know whether a run is still going or finished | I can decide whether to wait, and eventually so can a UI |
| US-06 | add a new agent without changing dispatch code | the second agent costs a registry row, not a feature |
| US-07 | see exactly what was asked of a past run | the Task File is an immutable audit record, and I can find it from the task id |
| US-08 | (deferred) distinguish "the agent failed" from "the infrastructure failed" | retries happen when they can help — gated on OQ-01 and on `agent-coder`'s `RunResult` |

---

## 6. Constraints & Assumptions

**Assumptions — what we're betting is true:**

- **Cloud Run Jobs `run`-with-overrides is the only trigger mechanism needed.** Kills it:
  DR's Kubernetes Jobs (`agent-coder` §3.2's runtime table). Would force a runtime seam in
  the registry.
- **Agents differ only by task payload, not by launch mechanism.** The whole
  pass-through-plus-registry design rests on this. See [§3.1](#31-post-agentsagentidtasks--dispatch-a-task).
- **One execution per task; a retry is a new task with a new id.** Consequence: three
  attempts at the same intent are three unrelated records in three GCS folders, with
  nothing linking them. `agent-coder`'s own OQ-12 admits the sibling version of this
  problem. Accepted for v1; retrofitting a `runs[]` array onto live records is the painful
  version of this decision.
- **A Dispatcher-minted id is enough; no caller-side idempotency key.** Consequence: a
  network timeout on `POST` where the execution *did* start leaves the caller unable to
  tell, and its natural response is to retry — paying twice. Real, accepted, see OQ-04.
- **`agent-coder` will eventually write `RunResult`.** If it never does, the status endpoint
  stays permanently low-fidelity.

**Constraints — facts we have to live with:**

- **The service account cannot start a job today.** `gcp/terraform/gale-ms-dispatcher.tf`
  grants `secretmanager.secretAccessor`, `storage.admin` and `pubsub.publisher`. Nothing
  that can execute a Cloud Run Job or read execution state. This is the first thing that
  will fail, and the terraform is still template boilerplate ("YOU CAN DELETE THIS FILE").
- **The deploy pipeline uses `--allow-unauthenticated`** (`gcp/.github/workflows/release-dev.yml`).
  An unauthenticated endpoint where each `POST` commits $1–20 of tokens and 5–30 minutes of
  runtime is a bad combination. `totoms` supplies a `UserContext`, so auth may already be
  handled at the framework level — this needs confirming, not assuming. See OQ-03.
- **`bucketPrefix` must match the agent container's hardcoded constant.** Change one
  without the other and the container starts, finds no Task File, and dies.
- **Cloud Run retains execution history for a bounded period.** Once an execution ages out,
  the Task Record is the only surviving trace of status. Another reason status is stored
  rather than computed.
- **Mongo is not wired up.** `Config.ts`'s `getMongoSecretNames()` returns `null`. A
  connection and the two Mongo secrets have to exist before a single task can be recorded.
- **No Cloud Run client in `package.json`.** Either add `@google-cloud/run` or call
  `run.googleapis.com/v2` directly with the already-present `google-auth-library`. Either
  way, **the exact request shape for env-var overrides must be verified against Google's
  primary API reference** before implementation.
- **This service is stateful now.** One Mongo collection, but that means backups, an index,
  and a migration path — none of which a pure GCS-plus-Cloud-Run design would have needed.
  It buys `GET /tasks/{taskId}` exactly as specified, plus future listing. Worth it, but not
  free.

---

## 7. Open Questions

| # | Question | Options / Notes |
|---|---|---|
| OQ-01 | Can the Dispatcher read a run's **exit code** from Cloud Run, or must it wait for `RunResult`? | **Verify against Google's Cloud Run Admin API v2 reference — do not assume.** Execution-level state is certain; a per-attempt exit code may live on a different resource. If unreadable: `exitCode` stays `null` and the `20`-vs-`30` distinction waits for `task-output.json`. Highest-value unknown in this doc. |
| OQ-02 | Refresh status on read, or have Cloud Run push state changes via Eventarc/Pub-Sub? | Pull for v1. Switch when a UI makes the N+1 hurt. The `evt/handlers/On{Event}.ts` convention and the `@google-cloud/pubsub` dependency already exist. Design `status` as a stored field either way. |
| OQ-03 | What authenticates a caller? | Does `totoms`' `UserContext` already cover it? If so, drop `--allow-unauthenticated` from the pipeline and the question closes. If not, this needs an answer *before* the URL is shared with anything. |
| OQ-04 | Accept an optional caller-supplied idempotency key? | `agent-coder` §4.4 already frames `taskId` as an idempotency key, so honouring a caller-supplied one is a small branch. Deferred, not rejected. |
| OQ-05 | `taskId` format? | `crypto.randomUUID()` needs no dependency but isn't sortable — hence `createdAt` as the sort key. A ULID-style prefix would make ids sortable and greppable in GCS listings. Low stakes, hard to change later. |
| OQ-06 | Service name and base path? | `src/index.ts` still says `serviceName: "toto-ms-ex1"`, `basePath: '/ex1'`. Needs a real value; `/dispatcher` reads well against `GALE_BROKER_URL`'s existing `/galebroker` convention. |
| OQ-07 | How is a record stuck in `starting` resolved, when no execution was ever created? | Nothing distinguishes it from a task whose execution simply hasn't been observed running yet, and with the execution name off the record (OQ-11) there is no direct handle to check. Options: a staleness rule (`starting` + older than N minutes ⇒ `failed_to_start`), or leave it and let it be visibly wrong. |
| OQ-08 | `GET` on an unknown `taskId` — plain `404`, or check GCS first? | A `404` is honest and cheap. Checking GCS would find tasks dispatched outside this service, which arguably shouldn't exist. Lean `404`. |
| OQ-09 | Should `agent-coder` read its prefix from an env var instead of hardcoding `AGENT_NAME`? | Would let `agentId` and `bucketPrefix` collapse into one field. Contradicts that repo's stated reasoning (the constant names *that repo*, not a deployment choice). Probably leave it; the registry absorbs the difference. |
| OQ-10 | Does the Dispatcher validate anything about the repo — that it exists, that we can push to it? | No, in v1. It would need a GitHub token and would duplicate what `GitOps` already does. Consequence: a bad `repoURL` costs a container start. |
| OQ-11 | With the execution name deliberately off the record ([§4.2](#42-taskrecord--the-mongo-document)), how is a task joined to its Cloud Run execution when refreshing status or cancelling? | Candidates: a label carrying the `taskId` set at dispatch; listing the job's executions and matching the `TASK_ID` override; or dropping the Cloud Run API as a status source once `agent-coder` writes `task-output.json` (OQ-01). **Verify against the Cloud Run Admin API v2 reference whether `run` accepts labels or a caller-chosen execution name** — do not assume. Blocks both refresh-on-read and a future cancel. |

---

## 8. Not Doing (and Why)

- **Cancel (`DELETE /tasks/{taskId}`)** — deferred by decision. One Cloud Run API call, and
  it satisfies `agent-coder`'s US-05 ("cancel a runaway run"). **Stated consequence:** v1
  lets you watch a looping agent burn tokens and gives you no API to stop it — the escape
  hatch is `gcloud` or the console. Note that it now shares a prerequisite with the status
  refresh itself: without the execution's name on the record, cancelling first requires
  finding the execution (OQ-11).
- **Task → many runs history** — one execution per task, a retry is a new task. Simpler
  records, and no ambiguity about which execution a status refers to. The cost is no
  grouping of attempts at the same intent, and this is the decision most expensive to
  reverse once records exist.
- **Concurrency caps and budget enforcement** — considered, and it *is* the honest answer to
  "why not just `gcloud run jobs execute`", since gcloud has no policy point. Rejected for
  v1 because it needs a policy model (per agent? per user? per day?) that nothing has asked
  for yet. **Consequence: a looping caller can start unbounded parallel runs.** The mitigation
  in the meantime is the Cloud Run Job's own `max_retries` and task timeout — set on the job
  resource, not here.
- **Typed per-agent task payloads** — would give better validation errors today, but every
  new agent would become a code change, defeating the registry. `requiredTaskFields` is the
  compromise.
- **`/logs`, `/trace`, `RunResult` subpaths** — gated on `agent-coder`, not on us.
  `task-output.json` does not exist there yet at all. And `trace.json` is uploaded only
  after the agent subprocess exits (`agent-coder` §3.4), so a `/trace` endpoint would 404
  for the entire 5–30 minutes anyone actually wants it, then return a wall of raw stdout —
  worse than not having it.
- **Streaming progress (SSE/websocket)** — needs `agent-coder`'s `AgentEvent`/`EventSink`
  (its §3.4), which is unbuilt. We'd be building both halves of a protocol at once.
- **Listing tasks** — the UI caller needs it and v1 doesn't have it. Called out honestly
  rather than pretended away: the UI is not fully served by v1.
- **A GitHub webhook / issue-label trigger** — that decides tasks *exist*, which is a
  different service's job. Folding it in here would make this the orchestrator, and
  `agent-coder` §3.2's whole argument is that those tiers stay apart.
- **An `agents` CRUD API** — the registry is code precisely so that adding an agent is
  reviewable. A DB-backed registry without an API is worse than a literal; with an API it's
  a feature nobody asked for.
- **A GKE / non-Cloud-Run runtime seam** — `agent-coder` §3.2 anticipates Kubernetes Jobs at
  DR. Building for it now means abstracting over one implementation. Rejected until the
  second one is real.
- **Retries** — the exit code taxonomy exists so the *caller* decides. Retrying exit `20`
  wastes tokens to reach the same conclusion (`agent-coder` §4.5), and a dispatcher that
  retries blindly does exactly that.

---

## 9. Ideas for Future Versions

- **Cancel** — `DELETE /tasks/{taskId}`. High-value and small, once OQ-11 settles how a
  task's execution is located.
- **`GET /agents/{agentId}/tasks`** — paginated listing, sorted by `createdAt`. The thing the
  UI needs first.
- **`GET /agents`** — expose the registry, so a UI can populate a dropdown and discover
  `requiredTaskFields` rather than hardcoding a form.
- **Read `RunResult`** — once `agent-coder` writes `task-output.json`, fold `status`,
  `prUrl`, `commitShas`, `tokenUsage` and `durationSeconds` into the `GET` response. This is
  what makes the endpoint genuinely useful.
- **Pushed status via Eventarc** — `OnExecutionStateChange` handler updating records, making
  `GET` a pure Mongo read (OQ-02).
- **Concurrency cap / budget** — max non-terminal runs per agent, `429` past the limit. Add
  when a programmatic caller actually exists.
- **Idempotency key** — honour a caller-supplied `taskId` and de-duplicate (OQ-04).
- **Task → runs** — a `runs[]` array and a re-dispatch endpoint, if grouping attempts turns
  out to matter.
- **A second agent** — the real test of the registry. Until `agent-reviewer` or similar
  exists, §3.1's bet is untested.
- **A runtime field in the registry** — `cloudrun` \| `gke`, the day DR needs it.

---

## Appendix A — Current repo state vs. target

**Nothing in this document is implemented.** The repo is an unmodified `toto-node-template`:

| Area | Today | Target |
|---|---|---|
| `src/index.ts` | `serviceName: "toto-ms-ex1"`, `basePath: '/ex1'`, one `GET /hello` wired to `SayHello` | Real service name and base path; `POST /agents/:agentId/tasks` and `GET /tasks/:taskId` |
| `src/dlg/` | `ExampleDelegate.ts` (`SayHello`) | `PostAgentTask.ts`, `GetTask.ts` |
| `src/Config.ts` | `getMongoSecretNames()` returns `null`; `getProps()` returns `{}` | Mongo secrets wired; `AGENTS` registry literal |
| `src/store/` | Does not exist | `TasksStore.ts` |
| `src/model/` | Does not exist | `TaskRecord.ts` (+ `fromBSON`/`toBSON`) |
| Cloud Run client | Not a dependency | `@google-cloud/run`, or REST via the existing `google-auth-library` |
| `package.json` | `name: "toto-node-template"` | `gale-ms-dispatcher` |
| `gcp/terraform/` | Template boilerplate, `toto-ms-xxx` placeholders, no Cloud Run job permissions | Real service account with permission to execute jobs and read execution state |
| `gcp/.github/workflows/` | Entirely commented out; `--allow-unauthenticated` | Live pipeline; auth decision resolved (OQ-03) |
| Tests | None | Registry resolution, required-field validation, dispatch ordering |
