import { ValidationError } from "totoms";

/**
 * One entry of the Agent Registry: everything the Dispatcher needs in order to dispatch a task to an agent.
 *
 * See docs/concept.md §4.1. Deliberately a small, dumb record: the Dispatcher knows how to *start* an agent,
 * never what any of its task fields mean (docs/concept.md §3.1 — "the payload names a target, never a behaviour").
 */
export class Agent {

    agentId: string;                    // Public identifier. The {agentId} path segment of POST /agents/{agentId}/tasks.
    jobName: string;                    // Name of the Cloud Run Job resource to execute for this agent.
    region: string;                     // Region the Cloud Run Job lives in. Not necessarily this service's own region.
    bucketPrefix: string;               // Folder under the agents-data bucket. MUST match the agent container's own constant (agent-coder hardcodes "coder").
    requiredTaskFields: string[];       // Task payload fields that must be present and non-blank before dispatch. Presence only, never interpreted.

    constructor({ agentId, jobName, region, bucketPrefix, requiredTaskFields }: { agentId: string, jobName: string, region: string, bucketPrefix: string, requiredTaskFields: string[] }) {

        this.agentId = agentId;
        this.jobName = jobName;
        this.region = region;
        this.bucketPrefix = bucketPrefix;
        this.requiredTaskFields = requiredTaskFields;

    }

    /**
     * Validates a task payload against the fields this agent declares as required.
     *
     * Rules worth documenting:
     * - Presence and non-blankness only. The Dispatcher never interprets a field's value, so a malformed URL passes here.
     * - Fields that are not required are ignored entirely: unknown fields are written to the Task File untouched.
     * - Every missing field is reported at once, so a caller fixes one round trip instead of several.
     *
     * @param {any} payload - the caller's request body, exactly as it will be written to the Task File
     *
     * @throws {ValidationError} 400, naming every missing field
     */
    validateTaskPayload(payload: any): void {

        const missing = this.requiredTaskFields.filter(field => !this.isPresent(payload[field]));

        if (missing.length > 0) throw new ValidationError(400, `Task payload for agent [${this.agentId}] is missing required field(s): ${missing.join(", ")}`);

    }

    /**
     * Builds the GCS object name of the Task File for a given task.
     *
     * Note this uses the bucketPrefix and *not* the agentId: the two differ on purpose, since the agent container
     * names its own folder (docs/concept.md §3.3).
     *
     * @param {string} taskId - the minted task id, which is also the Task File's folder name
     *
     * @returns {string} the object name, relative to the agents-data bucket
     */
    taskFileObjectName({ taskId }: { taskId: string }): string {

        return `${this.bucketPrefix}/${taskId}/task.json`;

    }

    /**
     * Builds the full gs:// path of the Task File for a given task.
     *
     * @param {string} bucketName - the agents-data bucket
     * @param {string} taskId - the minted task id
     *
     * @returns {string} the full gs:// path
     */
    taskFileGsPath({ bucketName, taskId }: { bucketName: string, taskId: string }): string {

        return `gs://${bucketName}/${this.taskFileObjectName({ taskId: taskId })}`;

    }

    /**
     * Builds the fully qualified Cloud Run Job resource name to execute for this agent.
     *
     * Uses the agent's own region, which need not be the region this service runs in.
     *
     * @param {string} projectId - the GCP project holding the job
     *
     * @returns {string} the job resource name
     */
    jobResourceName({ projectId }: { projectId: string }): string {

        return `projects/${projectId}/locations/${this.region}/jobs/${this.jobName}`;

    }

    /**
     * Checks that a task payload field carries an actual value.
     *
     * @param {any} value - the field's value
     *
     * @returns {boolean} true when the field counts as provided
     */
    private isPresent(value: any): boolean {

        if (value == null) return false;
        if (typeof value === "string") return value.trim().length > 0;

        return true;

    }

}
