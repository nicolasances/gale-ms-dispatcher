import { WithId } from "mongodb";

/**
 * Statuses a task can be in. See docs/concept.md §4.4.
 *
 * Note that only `starting`, `running` and `failed_to_start` are reachable from a dispatch; the terminal
 * statuses are set when a task's status is later refreshed.
 */
export type TaskStatus = "starting" | "running" | "succeeded" | "failed" | "cancelled" | "failed_to_start";

/**
 * The Dispatcher's own record of one dispatched task: the only state this service owns.
 *
 * It exists so that GET /tasks/{taskId} can resolve a bare taskId, which GCS alone cannot do — the Task File
 * lives under {bucketPrefix}/{taskId}/ and the prefix is not derivable from the id (docs/concept.md §3.2, §4.2).
 */
export class TaskRecord {

    taskId: string;                     // Minted by the Dispatcher. Also the Task File's folder name and the container's TASK_ID override.
    agentId: string;                    // Registry key of the agent this task was dispatched to.
    status: TaskStatus;                 // Last known status. Stored rather than computed, so a handler could write it later.
    executionName: string | null;       // Cloud Run execution resource name, read off the Operation that jobs.run returns. Stored but never returned to a caller.
    taskFilePath: string;               // Full gs:// path of the Task File. Derivable, but unambiguous in a UI.
    payload: any;                       // The caller's body, verbatim. Duplicates the Task File so a listing needs no GCS reads; immutable, so the copies cannot drift.
    exitCode: number | null;            // The run's exit code, when it can be read. See docs/concept.md OQ-01.
    error: any | null;                  // Dispatch-time failure detail. Not agent failure detail.
    createdAt: Date;                    // When the record was inserted. Sort key, since taskId is not sortable.
    updatedAt: Date;                    // When the status was last written.
    endedAt: Date | null;               // When a terminal status was first observed.

    constructor({ taskId, agentId, status, executionName, taskFilePath, payload, exitCode, error, createdAt, updatedAt, endedAt }: { taskId: string, agentId: string, status: TaskStatus, executionName: string | null, taskFilePath: string, payload: any, exitCode: number | null, error: any | null, createdAt: Date, updatedAt: Date, endedAt: Date | null }) {

        this.taskId = taskId;
        this.agentId = agentId;
        this.status = status;
        this.executionName = executionName;
        this.taskFilePath = taskFilePath;
        this.payload = payload;
        this.exitCode = exitCode;
        this.error = error;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
        this.endedAt = endedAt;

    }

    /**
     * Builds the record for a task that is about to be dispatched.
     *
     * Inserted *before* the execution is triggered, so that a crash mid-dispatch leaves a record with no
     * execution — visible and harmless — rather than a running, billing, invisible execution
     * (docs/concept.md §3.1).
     *
     * @param {string} taskId - the minted task id
     * @param {string} agentId - the agent being dispatched to
     * @param {string} taskFilePath - full gs:// path of the Task File already written
     * @param {any} payload - the caller's body, verbatim
     *
     * @returns {TaskRecord} a record in the `starting` status
     */
    static dispatching({ taskId, agentId, taskFilePath, payload }: { taskId: string, agentId: string, taskFilePath: string, payload: any }): TaskRecord {

        const now = new Date();

        return new TaskRecord({ taskId: taskId, agentId: agentId, status: "starting", executionName: null, taskFilePath: taskFilePath, payload: payload, exitCode: null, error: null, createdAt: now, updatedAt: now, endedAt: null });

    }

    /**
     * Converts a raw MongoDB document into a TaskRecord.
     *
     * @param {WithId<any>} data - the raw document
     *
     * @returns {TaskRecord} the model instance
     */
    static fromBSON(data: WithId<any>): TaskRecord {

        return new TaskRecord({ taskId: data.taskId, agentId: data.agentId, status: data.status, executionName: data.executionName ?? null, taskFilePath: data.taskFilePath, payload: data.payload, exitCode: data.exitCode ?? null, error: data.error ?? null, createdAt: data.createdAt, updatedAt: data.updatedAt, endedAt: data.endedAt ?? null });

    }

    /**
     * Converts this record into a plain object suitable for MongoDB storage.
     *
     * @returns {any} the document to store, without a mongo _id
     */
    toBSON(): any {

        return { taskId: this.taskId, agentId: this.agentId, status: this.status, executionName: this.executionName, taskFilePath: this.taskFilePath, payload: this.payload, exitCode: this.exitCode, error: this.error, createdAt: this.createdAt, updatedAt: this.updatedAt, endedAt: this.endedAt };

    }

}
