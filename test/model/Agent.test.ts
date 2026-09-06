import assert from "assert";
import { Agent } from "../../src/model/Agent";

/** The agent-coder registry entry, as it is declared in Config.ts. */
function coderAgent({ requiredTaskFields }: { requiredTaskFields: string[] }): Agent {
    return new Agent({ agentId: "agent-coder", jobName: "agent-coder", region: "europe-west1", bucketPrefix: "coder", requiredTaskFields: requiredTaskFields });
}

describe('Agent.validateTaskPayload', () => {

    it('accepts a payload carrying every required field', () => {

        const agent = coderAgent({ requiredTaskFields: ["repoURL", "issueURL"] });

        assert.doesNotThrow(() => agent.validateTaskPayload({ repoURL: "https://github.com/nicolasances/agent-coder.git", issueURL: "https://github.com/nicolasances/agent-coder/issues/3" }));

    })

    it('rejects a payload missing a required field, naming the field', () => {

        const agent = coderAgent({ requiredTaskFields: ["repoURL", "issueURL"] });

        assert.throws(() => agent.validateTaskPayload({ repoURL: "https://github.com/nicolasances/agent-coder.git" }), (error: any) => {

            assert.strictEqual(error.code, 400);
            assert.ok(error.message.includes("issueURL"), `expected the message to name issueURL, got: ${error.message}`);

            return true;
        });

    })

    it('names every missing required field, not just the first', () => {

        const agent = coderAgent({ requiredTaskFields: ["repoURL", "issueURL"] });

        assert.throws(() => agent.validateTaskPayload({ baseBranch: "main" }), (error: any) => {

            assert.ok(error.message.includes("repoURL"), `expected the message to name repoURL, got: ${error.message}`);
            assert.ok(error.message.includes("issueURL"), `expected the message to name issueURL, got: ${error.message}`);

            return true;
        });

    })

    it('treats a blank string as missing', () => {

        const agent = coderAgent({ requiredTaskFields: ["repoURL"] });

        assert.throws(() => agent.validateTaskPayload({ repoURL: "   " }), (error: any) => error.code === 400);

    })

    it('ignores fields it does not require, so unknown fields pass through', () => {

        const agent = coderAgent({ requiredTaskFields: ["repoURL"] });

        assert.doesNotThrow(() => agent.validateTaskPayload({ repoURL: "https://github.com/x/y.git", somethingElse: 42 }));

    })

})

describe('Agent.taskFileObjectName', () => {

    it('names the object under the agent bucket prefix, not the agentId', () => {

        const agent = coderAgent({ requiredTaskFields: [] });

        assert.strictEqual(agent.taskFileObjectName({ taskId: "5f3c1e7a" }), "coder/5f3c1e7a/task.json");

    })

})

describe('Agent.taskFileGsPath', () => {

    it('builds the full gs:// path of the Task File', () => {

        const agent = coderAgent({ requiredTaskFields: [] });

        assert.strictEqual(agent.taskFileGsPath({ bucketName: "totoexperiments-agents-data", taskId: "5f3c1e7a" }), "gs://totoexperiments-agents-data/coder/5f3c1e7a/task.json");

    })

})
