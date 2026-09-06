import { Request } from "express";
import { randomUUID } from "crypto";
import { TotoDelegate, UserContext, ValidationError } from "totoms";
import { ControllerConfig } from "../Config";
import { Agent } from "../model/Agent";
import { AgentsDataBucketAPI } from "../api/AgentsDataBucketAPI";
import { CloudRunJobsAPI } from "../api/CloudRunJobsAPI";
import { TaskRecord } from "../model/TaskRecord";
import { TasksStore } from "../store/TasksStore";

/**
 * Dispatches one task to one agent: POST /agents/{agentId}/tasks.
 *
 * Implements the sequence in docs/concept.md §3.1, whose ordering is load-bearing:
 *
 *   1. resolve agentId          → 404 if not in the registry
 *   2. validate required fields → 400, listing what's missing
 *   3. mint taskId
 *   4. write Task File to GCS   → before the trigger, so the container cannot outrun its own input
 *   5. insert Task Record       → before the trigger, so a crash never leaves a billing, invisible execution
 *   6. trigger the execution    → TASK_ID={taskId} as a per-execution override
 *   7. update Task Record       → executionName, status: "running"
 *
 * Nothing moves the status past `running`: refreshing it is GET /tasks/{taskId}'s job, which does not exist yet.
 */
export class PostAgentTask extends TotoDelegate<PostAgentTaskRequest, PostAgentTaskResponse> {

    async do(req: PostAgentTaskRequest, userContext?: UserContext): Promise<PostAgentTaskResponse> {

        const config = this.config as ControllerConfig;

        const agent = config.getAgentRegistry().resolve({ agentId: req.agentId });

        agent.validateTaskPayload(req.payload);

        const taskId = randomUUID();

        const taskFilePath = await new AgentsDataBucketAPI({ bucketName: config.getAgentsDataBucket() }).writeTaskFile({ agent: agent, taskId: taskId, payload: req.payload });

        const db = await config.getMongoDb(config.getDBName());

        const store = new TasksStore({ db: db, config: config });

        await store.saveTask(TaskRecord.dispatching({ taskId: taskId, agentId: agent.agentId, taskFilePath: taskFilePath, payload: req.payload }));

        await this.triggerExecution({ agent: agent, taskId: taskId, store: store });

        return { taskId: taskId, agentId: agent.agentId, status: "running", taskFile: taskFilePath };

    }

    /**
     * Starts the agent's Cloud Run Job execution and records it against the task.
     *
     * A failure here is a dispatch failure, not an agent failure: the Task File and the Task Record both
     * already exist, so the task is marked `failed_to_start` and the error is re-thrown for the caller to see
     * as a 500. The orphan Task File is left in place — it costs nothing and records something that was asked
     * and never ran (docs/concept.md §3.1).
     *
     * A null execution name is recorded as null rather than as an empty string, so that "we never captured it"
     * stays distinguishable from a real name.
     *
     * @param {Agent} agent - the resolved agent
     * @param {string} taskId - the minted task id
     * @param {TasksStore} store - the store holding the task's record
     */
    private async triggerExecution({ agent, taskId, store }: { agent: Agent, taskId: string, store: TasksStore }): Promise<void> {

        try {

            const executionName = await new CloudRunJobsAPI().runJob({ agent: agent, projectId: String(process.env.GCP_PID), taskId: taskId });

            await store.updateTaskExecution({ taskId: taskId, executionName: executionName, status: "running" });

        } catch (error: any) {

            await store.updateTaskStatus({ taskId: taskId, status: "failed_to_start", error: { message: error?.message ?? String(error) } });

            throw error;

        }

    }

    /**
     * Extracts the agentId and the task payload from the request.
     *
     * Only *structural* validation happens here. Whether the payload carries the fields a given agent requires
     * cannot be known until the agent has been resolved in the registry, which is business logic and therefore
     * lives in do().
     *
     * The payload is taken verbatim: the Dispatcher adds a taskId and interprets nothing else
     * (docs/concept.md §3.1).
     *
     * @param {Request} req - the express request
     *
     * @returns {PostAgentTaskRequest} the parsed dispatch request
     */
    parseRequest(req: Request): PostAgentTaskRequest {

        const agentId = req.params.agentId;
        const payload = req.body;

        if (!agentId) throw new ValidationError(400, "No agentId provided");
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new ValidationError(400, "No task payload provided: the request body must be a JSON object");

        return { agentId: agentId, payload: payload };

    }

}

interface PostAgentTaskRequest {
    agentId: string;        // The agent to dispatch to. Resolved against the Agent Registry in do().
    payload: any;           // The caller's request body, verbatim. Written to the Task File untouched, apart from the added taskId.
}

interface PostAgentTaskResponse {
    taskId: string;             // The minted task id. The caller's handle for GET /tasks/{taskId}.
    agentId: string;            // The agent the task was dispatched to.
    status: string;             // Status of the task. See docs/concept.md §4.4.
    taskFile: string;           // Full gs:// path of the Task File.
}
