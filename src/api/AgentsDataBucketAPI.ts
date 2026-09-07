import { Storage } from "@google-cloud/storage";
import { Agent } from "../model/Agent";
import { TaskFile } from "../model/TaskFile";

/**
 * All access to the agents-data GCS bucket, which carries the Task Files, Result Files and Trace Files of
 * every agent, one folder per agent (docs/concept.md §4.1).
 *
 * No raw GCS calls belong outside this class.
 */
export class AgentsDataBucketAPI {

    private bucketName: string;         // The agents-data bucket, derived from the project id.
    private storage: Storage;           // The GCS client.

    constructor({ bucketName }: { bucketName: string }) {

        this.bucketName = bucketName;
        this.storage = new Storage();

    }

    /**
     * Writes the Task File for one dispatch.
     *
     * Must happen *before* the execution is triggered: the container resolves its TASK_ID against GCS as soon
     * as it starts, so triggering first races the container to its own input (docs/concept.md §3.1).
     *
     * @param {Agent} agent - the agent being dispatched to, which owns the bucket prefix
     * @param {string} taskId - the minted task id
     * @param {any} payload - the caller's body, written through verbatim
     *
     * @returns {string} the full gs:// path the Task File was written to
     */
    async writeTaskFile({ agent, taskId, payload }: { agent: Agent, taskId: string, payload: any }): Promise<string> {

        const objectName = agent.taskFileObjectName({ taskId: taskId });

        await this.storage.bucket(this.bucketName).file(objectName).save(TaskFile.toJSON({ taskId: taskId, payload: payload }), { contentType: "application/json" });

        return agent.taskFileGsPath({ bucketName: this.bucketName, taskId: taskId });

    }

}
