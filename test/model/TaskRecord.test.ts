import assert from "assert";
import { ObjectId } from "mongodb";
import { TaskRecord } from "../../src/model/TaskRecord";

describe('TaskRecord', () => {

    it('starts a dispatched task in the starting status with no execution yet', () => {

        const record = TaskRecord.dispatching({ taskId: "5f3c1e7a", agentId: "agent-coder", taskFilePath: "gs://bucket/coder/5f3c1e7a/task.json", payload: { repoURL: "https://github.com/x/y.git" } });

        assert.strictEqual(record.status, "starting");
        assert.strictEqual(record.executionName, null);
        assert.strictEqual(record.endedAt, null);
        assert.ok(record.createdAt instanceof Date);

    })

    it('survives a round trip through BSON', () => {

        const record = TaskRecord.dispatching({ taskId: "5f3c1e7a", agentId: "agent-coder", taskFilePath: "gs://bucket/coder/5f3c1e7a/task.json", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } });

        const roundTripped = TaskRecord.fromBSON({ _id: new ObjectId(), ...record.toBSON() });

        assert.strictEqual(roundTripped.taskId, "5f3c1e7a");
        assert.strictEqual(roundTripped.agentId, "agent-coder");
        assert.strictEqual(roundTripped.status, "starting");
        assert.strictEqual(roundTripped.taskFilePath, "gs://bucket/coder/5f3c1e7a/task.json");
        assert.deepStrictEqual(roundTripped.payload, { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" });

    })

    it('does not put the mongo _id in the BSON it writes', () => {

        const record = TaskRecord.dispatching({ taskId: "5f3c1e7a", agentId: "agent-coder", taskFilePath: "gs://bucket/coder/5f3c1e7a/task.json", payload: {} });

        assert.ok(!("_id" in record.toBSON()), "expected toBSON not to carry an _id");

    })

})
