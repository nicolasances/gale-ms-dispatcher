import assert from "assert";
import { CloudRunJobsAPI } from "../../src/api/CloudRunJobsAPI";

describe('CloudRunJobsAPI.runJobRequest', () => {

    it('names the job to execute', () => {

        const request = CloudRunJobsAPI.runJobRequest({ jobResourceName: "projects/p/locations/europe-west1/jobs/agent-coder", taskId: "5f3c1e7a" });

        assert.strictEqual(request.name, "projects/p/locations/europe-west1/jobs/agent-coder");

    })

    it('passes the taskId as the TASK_ID container env override', () => {

        const request = CloudRunJobsAPI.runJobRequest({ jobResourceName: "projects/p/locations/europe-west1/jobs/agent-coder", taskId: "5f3c1e7a" });

        assert.deepStrictEqual(request.overrides?.containerOverrides, [{ env: [{ name: "TASK_ID", value: "5f3c1e7a" }] }]);

    })

    it('overrides nothing else, since TASK_ID is the only per-execution variable', () => {

        const request = CloudRunJobsAPI.runJobRequest({ jobResourceName: "projects/p/locations/europe-west1/jobs/agent-coder", taskId: "5f3c1e7a" });

        assert.strictEqual(request.overrides?.taskCount, undefined);
        assert.strictEqual(request.overrides?.timeout, undefined);
        assert.strictEqual(request.validateOnly, undefined);

    })

})

describe('CloudRunJobsAPI.executionNameOf', () => {

    it('reads the execution name off the operation metadata', () => {

        const executionName = CloudRunJobsAPI.executionNameOf({ metadata: { name: "projects/p/locations/europe-west1/jobs/agent-coder/executions/agent-coder-abc12" } } as any);

        assert.strictEqual(executionName, "projects/p/locations/europe-west1/jobs/agent-coder/executions/agent-coder-abc12");

    })

    it('returns null when the operation carries no metadata, rather than throwing', () => {

        assert.strictEqual(CloudRunJobsAPI.executionNameOf({ metadata: null } as any), null);

    })

})
