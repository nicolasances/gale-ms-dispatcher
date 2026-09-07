# API Endpoints

All endpoints are served under the service base path `/dispatcher`.

[Table of Content]
- [Tasks](#tasks)
    - [POST /agents/{agentId}/tasks](#post-agentsagentidtasks)

## Tasks

| Method | Endpoint | Description |
| ------ | -------- | ----------- |
| POST | `/agents/{agentId}/tasks` | Dispatches one task to one agent, returning the minted task id |

### POST /agents/{agentId}/tasks

**Used for:** dispatching a task to an agent without a GCP-authenticated shell. It writes the agent's Task File to GCS and starts one Cloud Run Job execution for it, then returns a `taskId` the caller holds on to. Built for three callers: a human with curl, a Gale UI, and another agent dispatching programmatically (see [concept §1.2](../concept.md#12-who-is-it-for)).

The `{agentId}` path segment is resolved against the Agent Registry declared in `src/Config.ts`. The request body is the task payload and is written to the Task File **verbatim**, with only a `taskId` added — the Dispatcher validates that the fields the agent declares in `requiredTaskFields` are present and non-blank, and interprets nothing (see [concept §3.1](../concept.md#31-post-agentsagentidtasks--dispatch-a-task)).

**Request & Response:** `PostAgentTaskRequest` and `PostAgentTaskResponse`, both declared at the bottom of [`src/dlg/PostAgentTask.ts`](../../src/dlg/PostAgentTask.ts).

Request body, for `agent-coder`:

```json
{
    "repoURL": "https://github.com/nicolasances/agent-coder.git",
    "issueURL": "https://github.com/nicolasances/agent-coder/issues/3",
    "baseBranch": "main"
}
```

`baseBranch` is optional and is **not** defaulted here: the agent owns its own default (`main`), so that the default lives in exactly one place.

Response, `201`:

```json
{
    "taskId": "5f3c1e7a-…",
    "agentId": "agent-coder",
    "status": "running",
    "taskFile": "gs://{GCP_PID}-agents-data/coder/5f3c1e7a-…/task.json"
}
```

**Errors:**

| Code | When |
| ---- | ---- |
| `400` | The body is absent or is not a JSON object, or a field in the agent's `requiredTaskFields` is missing or blank. Every missing field is named at once. |
| `404` | No agent is registered under `{agentId}`. |
| `500` | The Task File could not be written, or the Cloud Run Job execution could not be started. |

When the trigger itself fails, the Task File and the Task Record both already exist, so the task is left in the `failed_to_start` status with the failure recorded on it. The orphan Task File is not cleaned up: it costs nothing and records something that was asked and never ran. Retrying is safe, but it produces a **new** task with a new id — this endpoint has no idempotency key (see [concept OQ-04](../concept.md#7-open-questions)).
