# Gale Dispatcher — Concept

> Status: concept / decision document. **Nothing in it is implemented yet** — this repo is
> still an unmodified `toto-node-template`. See
> [Appendix A](#appendix-a--current-repo-state-vs-target) for exactly what exists today.
> Last revised: 2026-09-06.
>
> **Depends on `agent-coder` issue
> [#5](https://github.com/nicolasances/agent-coder/issues/5), in implementation as of
> 2026-09-06.** §4.3's Task File drops the free-form `prompt` field in favour of an
> `issueURL`, on the reasoning in
> [§3.1](#31-post-agentsagentidtasks--dispatch-a-task) ("the payload names a target, never a
> behaviour"). Until that issue lands, `agent-coder`'s `TaskSpec` still requires `prompt`
> (`runner/model/task.py`) and the shapes in §4.3 and §4.5 describe the intended contract,
> not the current one. The field names, casing and required set below have been checked
> against #5 and match it.
>
> **What #5 does *not* do, contrary to an earlier draft of this note:** it does not make
> branch naming deterministic. It resolves that repo's OQ-11 by giving branch creation —
> along with commit, push and PR — to the *agent*, via its `prepare` and `build-and-ship`
> skills, reversing §3.1's "the runner owns the git operations, not the agent." That
> reversal has consequences for what this service can report; see
> [§3.2](#32-get-taskstaskid--what-happened-to-it) and OQ-01.
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
- **Validation after a container start is validation too late.** `agent-coder` #5 fixes its
  own field checking (today `TaskSpec.from_dict()` validates two fields and then indexes
  `repoURL` unguarded, raising `KeyError`), but even fixed, it can only reject a bad Task
  File *after* an execution has been scheduled and a container has pulled and booted. The
  same check against a declared field list costs a `400` here. The duplication is
  deliberate: the agent must still validate, because a Task File can be written by hand.
- **"What happened to that run?" has no answer outside the GCP console.** No id you can
  hand to a UI, no record that survives Cloud Run's execution retention.
- **The `agentId → job → bucket prefix` mapping is written down nowhere.** `agent-coder`
  hardcodes `AGENT_NAME = "coder"` and writes to `coder/{task_id}/task.json`; this service
  wants to call it `agent-coder`. Today that mismatch lives only in someone's head.

### 1.4 Out of scope (v1)

- **Deciding that a task exists.** No GitHub webhook, no issue-label trigger, no planner.
  Something else decides an issue is worth an agent's time; this service dispatches it.
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
| **Task** | A unit of work small enough for one unattended run. What the caller POSTs. For `agent-coder`, one GitHub issue — the payload names the issue, never what to do with it. |
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
7. update Task Record       → executionName (from the Operation), status: "running"
```

**Why the Task File is written before the trigger.** `agent-coder` §4.1 is explicit: the
container resolves `TASK_ID` against GCS the moment it starts. Trigger first and you race
the container to its own input. The write is cheap and idempotent; the ordering is free.

**Never wait for the job.** `jobs.run` returns a long-running `Operation`, and awaiting it
(`operation.promise()` in `@google-cloud/run`) blocks until the *job* finishes — 5 to 30
minutes. Step 6 fires the call and reads the execution's name off the returned operation
without awaiting completion. This is the single easiest way to get this endpoint badly
wrong.

**Why the record is inserted before the trigger.** The alternative — trigger, then insert —
has a window where a crash leaves a *running, billing, invisible* execution with no record.
Inserting first inverts the failure: a crash leaves a record with no execution, which is
visible and harmless. That is the right way round.

**Design decision — step 4 writes the payload through, untyped.** The Dispatcher copies the
caller's body into the Task File verbatim, adding only the minted `taskId`. Step 2 checks
that the registry's `requiredTaskFields` are present and non-empty, and that is the whole
extent of its interest in the payload: it does not know what `repoURL` means, and does not
default `baseBranch`.

**The payload names a target, never a behaviour.** This is the rule that makes a declared
field list sufficient. `agent-coder` is an agent that implements GitHub issues — *that* is
its behaviour, it lives in the image alongside the skills §3.5 of its own doc insists on
baking in, and no field in the payload can change it. The payload says only *which* issue.
A free-form prompt would break the rule: it lets any caller alter what the agent does, with
no review gate and nothing in the record marking it as a behaviour change — the exact
failure §3.5 rejects `latest` skills to avoid. Behaviour variation belongs in the Agent
Registry (a different agent, a different job), not in a task field.

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
| Between 6 and 7 (process dies) | Execution **running**, record has no `executionName` | Task appears permanently `starting` while the agent actually works, and the execution can never be re-identified ([§3.2](#32-get-taskstaskid--what-happened-to-it)). The narrowest window here, and the most annoying one. |

An orphan Task File costs nothing and is never garbage-collected. It is an immutable record
of something that was asked and never ran, which is arguably worth keeping.

**Response** is `201` with the minted `taskId` — the only thing the caller needs to track
the run, and the value it will pass to `GET /tasks/{taskId}`.

### 3.2 `GET /tasks/{taskId}` — what happened to it

Read the Task Record. If its status is non-terminal, refresh it from the Cloud Run
Executions API, persist the refreshed status, and return.

**Dispatch is the only moment the execution can be identified, so step 7 must capture it**
*(verified 2026-09-06 against the Cloud Run Admin API v2 reference)*. The `jobs.run` request
body is only `validateOnly`, `etag` and `overrides` — and `overrides` carries just
`containerOverrides[]` (`name`, `args`, `env`, `clearArgs`), `taskCount` and `timeout`.
**There is no way to attach a label, an annotation or a caller-chosen name to an execution
at dispatch**, and `executions.list` documents no filter parameter, so "find the execution
whose `TASK_ID` is X" is not a query that exists. The name comes back from the `Operation`
that `jobs.run` returns, and if the record does not keep it, the Cloud Run API becomes
permanently unreachable for that task.

It is kept internal for that reason alone — stored on the record ([§4.2](#42-taskrecord--the-mongo-document)),
absent from the response ([§4.5](#45-api-shapes)). Callers get `status`, not GCP resource
names. *(The documented fallback, `Job.latestCreatedExecution`, is a single
`ExecutionReference` per job and so is unreliable the moment two tasks are dispatched close
together — it is a debugging aid, not a substitute for recording the name.)*

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

**A caveat that arrived with `agent-coder` #5, and it cuts against the above.** That issue
moves branch creation, commit, push and PR out of the runner and into the agent's skills.
`agent-coder` §3.1 rejected exactly that arrangement on the grounds of *failure
attribution*: "'The agent could not solve the task' and 'the push was rejected' are
different outcomes with different retry semantics. Merging them into one opaque agent turn
destroys that distinction." That distinction is `20` versus `30` — the thing this endpoint
most wants to report. With git inside the agent turn, a rejected push is liable to surface
as an agent failure, so **`exitCode` may become less informative than the taxonomy
suggests, even after `RunResult` exists.** Not this service's decision to make, and #5 does
not address it — deliberately, it will be looked at later. Tracked as OQ-14, because it caps
what this endpoint can ever promise.

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
        requiredTaskFields: ["repoURL", "issueURL"],
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
| `executionName` | string \| null | Cloud Run execution resource name, read off the `Operation` that `jobs.run` returns. **Stored but never returned** — it is a GCP detail no caller can use. `null` until step 7, and forever if the trigger failed. See [§3.2](#32-get-taskstaskid--what-happened-to-it) for why it cannot be recovered later if not captured here. |
| `status` | enum | See [§4.4](#44-status-enum). Stored, not computed — see [§3.2](#32-get-taskstaskid--what-happened-to-it). |
| `taskFilePath` | string | Full `gs://…` path. Redundant (derivable from prefix + id) but cheap and unambiguous in a UI. |
| `payload` | object | The caller's body, verbatim. Duplicates the Task File deliberately — a UI listing tasks needs the issue each one refers to without N GCS reads, and the payload is immutable so the copies cannot drift. GCS remains the audit copy. Note it carries an issue *URL*, not a title: a readable list needs GitHub, which OQ-10 keeps out of this service. |
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
  "issueURL": "https://github.com/nicolasances/agent-coder/issues/3",
  "baseBranch": "main"
}
```

Everything except `taskId` is the caller's, untouched. `baseBranch` appears only if the
caller sent it.

**`repoURL` and `issueURL` are both explicit, and can therefore disagree** — an issue in
one repo, a clone URL for another. Catching that is a string comparison of the two hosts and
paths, no GitHub call needed, but it belongs in `agent-coder`'s `TaskSpec` and not here: the
Dispatcher validates *presence* against `requiredTaskFields` and knows nothing about what
either field means ([§3.1](#31-post-agentsagentidtasks--dispatch-a-task)). Teaching it to
cross-check them would be the first crack in the pass-through design. See OQ-12.

### 4.4 Status enum

| Status | Meaning | Terminal |
|---|---|---|
| `starting` | Record inserted, execution requested or in flight. Not yet observed running, and `executionName` may not be set yet. | No |
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
  "issueURL": "https://github.com/nicolasances/agent-coder/issues/3",
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
  "payload": { "repoURL": "…", "issueURL": "…", "baseBranch": "main" },
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
| OQ-01 | Can the Dispatcher read a run's **exit code** from Cloud Run, or must it wait for `RunResult`? | Partly answered 2026-09-06: the `Execution` resource exposes only `runningCount` / `succeededCount` / `failedCount` / `cancelledCount` and `conditions` — **no per-task exit code**. So `succeeded`/`failed` are available and the `20`-vs-`30` distinction is not, at least at that level. Still to check: whether the `executions.tasks` sub-resource carries an attempt result with an exit code. If it does not, `exitCode` stays `null` until `agent-coder` writes `task-output.json`. |
| OQ-02 | Refresh status on read, or have Cloud Run push state changes via Eventarc/Pub-Sub? | Pull for v1. Switch when a UI makes the N+1 hurt. The `evt/handlers/On{Event}.ts` convention and the `@google-cloud/pubsub` dependency already exist. Design `status` as a stored field either way. |
| OQ-03 | What authenticates a caller? | Does `totoms`' `UserContext` already cover it? If so, drop `--allow-unauthenticated` from the pipeline and the question closes. If not, this needs an answer *before* the URL is shared with anything. |
| OQ-04 | Accept an optional caller-supplied idempotency key? | `agent-coder` §4.4 already frames `taskId` as an idempotency key, so honouring a caller-supplied one is a small branch. Deferred, not rejected. |
| OQ-05 | `taskId` format? | `crypto.randomUUID()` needs no dependency but isn't sortable — hence `createdAt` as the sort key. A ULID-style prefix would make ids sortable and greppable in GCS listings. Low stakes, hard to change later. |
| OQ-06 | ~~Service name and base path?~~ **Decided: `gale-ms-dispatcher`, basePath `/dispatcher`.** | Chosen 2026-09-06 to match the repo and the Cloud Run service name, and to read consistently with the existing `GALE_BROKER_URL` `/galebroker` convention. Effective paths are `/dispatcher/agents/{agentId}/tasks` and `/dispatcher/tasks/{taskId}`; §3 and §4.5 give them without the prefix for readability. |
| OQ-07 | How is a record stuck in `starting` resolved, when no execution was ever created? | Nothing distinguishes it from a task whose execution simply hasn't been observed running yet, and with the execution name off the record (OQ-11) there is no direct handle to check. Options: a staleness rule (`starting` + older than N minutes ⇒ `failed_to_start`), or leave it and let it be visibly wrong. |
| OQ-08 | `GET` on an unknown `taskId` — plain `404`, or check GCS first? | A `404` is honest and cheap. Checking GCS would find tasks dispatched outside this service, which arguably shouldn't exist. Lean `404`. |
| OQ-09 | Should `agent-coder` read its prefix from an env var instead of hardcoding `AGENT_NAME`? | Would let `agentId` and `bucketPrefix` collapse into one field. Contradicts that repo's stated reasoning (the constant names *that repo*, not a deployment choice). Probably leave it; the registry absorbs the difference. |
| OQ-10 | Does the Dispatcher validate anything about the repo — that it exists, that we can push to it? | No, in v1. It would need a GitHub token and would duplicate what `GitOps` already does. Consequence: a bad `repoURL` costs a container start. |
| OQ-11 | ~~With the execution name deliberately off the record, how is a task joined to its Cloud Run execution?~~ **Answered: it is on the record, captured at dispatch.** | Verified 2026-09-06: `jobs.run` accepts no label, annotation or caller-chosen execution name, and `executions.list` documents no filter, so both alternatives (label-and-query, list-and-match) are impossible rather than merely awkward. The `Operation` returned by `jobs.run` is the only source. Kept internal to the record — see [§3.2](#32-get-taskstaskid--what-happened-to-it). |
| OQ-12 | ~~`repoURL` and `issueURL` can name different repositories. Who catches that?~~ **Answered by `agent-coder` #5: nobody, by decision.** | #5 puts both URL-shape validation and the owner/repo consistency check explicitly out of scope, on the grounds that a mismatch self-diagnoses — "the agent clones repo A and cannot find the issue." Sound, with one cost worth recording: that self-diagnosis happens *after* a container start, and since #5 also leaves the exit code taxonomy untouched for malformed Task Files, it likely reports as `20` (agent failed) rather than as bad input. So `GET /tasks/{taskId}` will show a contradictory task as an agent failure. Cheap to revisit later — it is a host/path string comparison, no GitHub call. |
| OQ-13 | With the agent opening the PR (`agent-coder` #5), how does `RunResult.pr_url` get populated — and therefore how does this service ever report a PR link? | The runner no longer creates the PR, so it no longer knows its URL. Recoverable but no longer free: parse it from the agent's stdout/`trace.json`, or query GitHub for the head branch after the run. `commit_shas`, `base_sha` and the branch name stay readable from the clone, so this is specifically a PR-URL problem. Blocks the most user-visible item in [§9](#9-ideas-for-future-versions). |
| OQ-14 | With git operations inside the agent turn (`agent-coder` #5), can `20` (agent failed) still be told from `30` (infra failed)? | The distinction `agent-coder` §4.5 exists to preserve, and the most valuable thing [§3.2](#32-get-taskstaskid--what-happened-to-it) could report. Explicitly not considered in #5's implementation; to be revisited. Candidates: the agent's skills exit with a distinct code when push/PR fails rather than when the task defeats them; the runner re-verifies post-conditions after the agent turn (was a branch pushed? does a PR exist?) and classifies from that; or git returns to the runner as §3.1 originally argued — which is why #5 keeps `GitOps` rather than deleting it. **The post-condition check would answer OQ-13 in the same pass**, since finding the PR is how you verify it exists. |

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
  what makes the endpoint genuinely useful. `prUrl` specifically depends on OQ-13 being
  answered on the agent side first.
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

**The dispatch path is implemented; the read path and all of the infrastructure are not.**
Issue [#1](https://github.com/nicolasances/gale-ms-dispatcher/issues/1) delivered
[§3.1](#31-post-agentsagentidtasks--dispatch-a-task) and
[§3.3](#33-the-agent-registry) in full. Everything below marked ❌ is still open.

| Area | Today | Target |
|---|---|---|
| `src/index.ts` | ✅ `serviceName: "gale-ms-dispatcher"`, `basePath: '/dispatcher'`, `POST /agents/:agentId/tasks` wired | Also `GET /tasks/:taskId` |
| `src/dlg/` | ✅ `PostAgentTask.ts` | Also `GetTask.ts` |
| `src/Config.ts` | ✅ `AGENTS` registry literal, Mongo secret names, `getAgentsDataBucket()` | — |
| `src/model/` | ✅ `Agent.ts`, `AgentRegistry.ts`, `TaskRecord.ts` (+ `fromBSON`/`toBSON`), `TaskFile.ts` | — |
| `src/store/` | ✅ `TasksStore.ts` — save, update execution, update status, find by id | — |
| `src/api/` | ✅ `AgentsDataBucketAPI.ts` (GCS), `CloudRunJobsAPI.ts` (job execution) | — |
| Cloud Run client | ✅ `@google-cloud/run` | — |
| `package.json` | ✅ `name: "gale-ms-dispatcher"` | — |
| Tests | ✅ Mocha under `test/`, mirroring `src/`. 32 tests: registry resolution, required-field validation, Task File composition, `TaskRecord` round-trip, job-request composition, path building | The dispatch happy path is not unit tested — it writes to GCS and Mongo, and the standards forbid tests needing a live database. Verified by hand instead. |
| Status refresh | ❌ Nothing moves a task past `running` | `GET /tasks/:taskId`, blocked on OQ-01 |
| `gcp/terraform/` | ❌ Template boilerplate, `toto-ms-xxx` placeholders, no Cloud Run job permissions | Real service account with permission to execute jobs and read execution state; the agents-data bucket and the Mongo secrets |
| `gcp/.github/workflows/` | ❌ Entirely commented out; `--allow-unauthenticated` | Live pipeline; auth decision resolved (OQ-03) |
