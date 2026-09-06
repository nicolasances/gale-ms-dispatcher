import { Db } from "mongodb";
import { ControllerConfig } from "../Config";
import { TaskRecord, TaskStatus } from "../model/TaskRecord";

/**
 * All database access for dispatched tasks.
 *
 * No other file may read or write the `tasks` collection.
 */
export class TasksStore {

    private db: Db;                         // The Mongo database handle.
    private tasksCollection: string;        // Name of the collection holding TaskRecords.

    constructor({ db, config }: { db: Db, config: ControllerConfig }) {

        this.db = db;
        this.tasksCollection = config.getCollections().tasks;

    }

    /**
     * Inserts the record of a dispatched task.
     *
     * @param {TaskRecord} task - the record to store
     *
     * @returns {string} the inserted document's id
     */
    async saveTask(task: TaskRecord): Promise<string> {

        const result = await this.db.collection(this.tasksCollection).insertOne(task.toBSON());

        return result.insertedId.toString();

    }

    /**
     * Records the Cloud Run execution that was started for a task, and moves it to the given status.
     *
     * The execution name cannot be recovered later — jobs.run accepts no label or caller-chosen name and
     * executions.list offers no filter — so this write is the only chance to keep it (docs/concept.md §3.2).
     *
     * @param {string} taskId - the task to update
     * @param {string} executionName - the Cloud Run execution resource name
     * @param {TaskStatus} status - the status to move the task to
     */
    async updateTaskExecution({ taskId, executionName, status }: { taskId: string, executionName: string, status: TaskStatus }): Promise<void> {

        await this.db.collection(this.tasksCollection).updateOne({ taskId: taskId }, { $set: { executionName: executionName, status: status, updatedAt: new Date() } });

    }

    /**
     * Moves a task to a given status, optionally recording why.
     *
     * @param {string} taskId - the task to update
     * @param {TaskStatus} status - the status to move the task to
     * @param {any} error - optional dispatch-time failure detail
     */
    async updateTaskStatus({ taskId, status, error }: { taskId: string, status: TaskStatus, error?: any }): Promise<void> {

        await this.db.collection(this.tasksCollection).updateOne({ taskId: taskId }, { $set: { status: status, error: error ?? null, updatedAt: new Date() } });

    }

    /**
     * Finds one task by its id.
     *
     * @param {string} taskId - the task to find
     *
     * @returns {TaskRecord | null} the record, or null when no task carries that id
     */
    async findTaskById(taskId: string): Promise<TaskRecord | null> {

        const result = await this.db.collection(this.tasksCollection).findOne({ taskId: taskId });

        if (!result) return null;

        return TaskRecord.fromBSON(result);

    }

}
