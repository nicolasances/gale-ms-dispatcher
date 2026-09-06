import { JobsClient, protos } from "@google-cloud/run";
import { Agent } from "../model/Agent";

/** The one per-execution environment variable the agent container needs (docs/concept.md §4.4). */
const TASK_ID_VARIABLE = "TASK_ID";

/**
 * All access to the Cloud Run Jobs Admin API.
 *
 * This class starts executions. It never creates or updates a Job resource: the job is deployed by the agent's
 * own pipeline, and the Dispatcher only ever runs it (docs/concept.md §2).
 */
export class CloudRunJobsAPI {

    private client: JobsClient;         // The Cloud Run Jobs Admin API client.

    constructor() {

        this.client = new JobsClient();

    }

    /**
     * Starts one execution of an agent's Cloud Run Job and returns the name of the execution created.
     *
     * The returned operation is deliberately **not** awaited to completion: it resolves only when the job
     * itself finishes, which for a coding agent is 5 to 30 minutes. The execution's name is available on the
     * operation's metadata as soon as the call returns, and capturing it here is the only chance to do so —
     * jobs.run accepts no label or caller-chosen execution name, and executions.list offers no filter, so an
     * execution cannot be found by its TASK_ID afterwards (docs/concept.md §3.2).
     *
     * @param {Agent} agent - the agent whose job to execute
     * @param {string} projectId - the GCP project holding the job
     * @param {string} taskId - the minted task id, passed to the container as its TASK_ID override
     *
     * @returns {string | null} the execution resource name, or null when the operation carried no metadata
     */
    async runJob({ agent, projectId, taskId }: { agent: Agent, projectId: string, taskId: string }): Promise<string | null> {

        const request = CloudRunJobsAPI.runJobRequest({ jobResourceName: agent.jobResourceName({ projectId: projectId }), taskId: taskId });

        const [operation] = await this.client.runJob(request);

        return CloudRunJobsAPI.executionNameOf(operation);

    }

    /**
     * Composes the jobs.run request for one dispatch.
     *
     * TASK_ID is the only thing that varies between executions; everything else the container needs is set on
     * the Job resource itself, once per environment (docs/concept.md §4.4). Container env overrides are merged
     * with the job's existing variables rather than replacing them.
     *
     * @param {string} jobResourceName - the fully qualified job to execute
     * @param {string} taskId - the minted task id
     *
     * @returns {protos.google.cloud.run.v2.IRunJobRequest} the request to send
     */
    static runJobRequest({ jobResourceName, taskId }: { jobResourceName: string, taskId: string }): protos.google.cloud.run.v2.IRunJobRequest {

        return { name: jobResourceName, overrides: { containerOverrides: [{ env: [{ name: TASK_ID_VARIABLE, value: taskId }] }] } };

    }

    /**
     * Reads the execution's resource name off the operation that jobs.run returned.
     *
     * runJob's return type declares the operation's metadata as an Execution, so the name is present as soon
     * as the call returns and there is no need to wait for the operation to complete. The cast is unavoidable:
     * gax's Operation base class types the field as a gRPC Metadata rather than as the proto metadata the
     * generic promises.
     *
     * Because that gap is a claim about a shape rather than something the compiler enforces, an unexpected
     * shape yields null instead of an exception. The execution has been requested either way, and losing its
     * name is not a reason to fail the dispatch — though it does cost the ability to look that execution up
     * later (docs/concept.md §3.2).
     *
     * @param {object} operation - the long-running operation returned by runJob
     *
     * @returns {string | null} the execution resource name, or null when the metadata is absent or unexpected
     */
    static executionNameOf(operation: { metadata?: unknown }): string | null {

        const execution = operation.metadata as protos.google.cloud.run.v2.IExecution | null | undefined;

        return execution?.name ?? null;

    }

}
