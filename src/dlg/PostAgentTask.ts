import { Request } from "express";
import { randomUUID } from "crypto";
import { TotoDelegate, UserContext, ValidationError } from "totoms";
import { ControllerConfig } from "../Config";
import { AgentsDataBucketAPI } from "../api/AgentsDataBucketAPI";
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
 *   6. trigger the execution    → task 3 of issue #1
 *   7. record the execution     → task 3 of issue #1
 *
 * Steps 6 and 7 are not implemented yet, so a dispatched task stays in the `starting` status and no agent
 * actually runs.
 */
export class PostAgentTask extends TotoDelegate<PostAgentTaskRequest, PostAgentTaskResponse> {

    async do(req: PostAgentTaskRequest, userContext?: UserContext): Promise<PostAgentTaskResponse> {

        const config = this.config as ControllerConfig;

        const agent = config.getAgentRegistry().resolve({ agentId: req.agentId });

        agent.validateTaskPayload(req.payload);

        const taskId = randomUUID();

        const taskFilePath = await new AgentsDataBucketAPI({ bucketName: config.getAgentsDataBucket() }).writeTaskFile({ agent: agent, taskId: taskId, payload: req.payload });

        const db = await config.getMongoDb(config.getDBName());

        await new TasksStore({ db: db, config: config }).saveTask(TaskRecord.dispatching({ taskId: taskId, agentId: agent.agentId, taskFilePath: taskFilePath, payload: req.payload }));

        return { taskId: taskId, agentId: agent.agentId, status: "starting", taskFile: taskFilePath };

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
    taskId: string;         // The minted task id. The caller's handle for GET /tasks/{taskId}.
    agentId: string;        // The agent the task was dispatched to.
    status: string;         // Status of the task. See docs/concept.md §4.4.
    taskFile: string;       // Full gs:// path of the Task File.
}
