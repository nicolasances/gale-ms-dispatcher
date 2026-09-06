import assert from "assert";
import { ConfigMock } from "totoms";
import { PostAgentTask } from "../../src/dlg/PostAgentTask";
import { ControllerConfig } from "../../src/Config";

/** Builds the express-like request shape that parseRequest reads from. */
function fakeRequest({ agentId, body }: { agentId?: string, body?: any }): any {
    return { params: { agentId: agentId }, body: body, query: {}, headers: {} };
}

describe('PostAgentTask.parseRequest', () => {

    it('extracts the agentId from the path and the payload from the body', () => {

        const delegate = new PostAgentTask(null as any, new ConfigMock());

        const request = delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } }));

        assert.strictEqual(request.agentId, "agent-coder");
        assert.strictEqual(request.payload.repoURL, "https://github.com/x/y.git");

    })

    it('rejects a request with no body', () => {

        const delegate = new PostAgentTask(null as any, new ConfigMock());

        assert.throws(() => delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: undefined })), (error: any) => {

            assert.strictEqual(error.code, 400);

            return true;
        });

    })

    it('rejects a body that is not an object', () => {

        const delegate = new PostAgentTask(null as any, new ConfigMock());

        assert.throws(() => delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: "a string" })), (error: any) => error.code === 400);

    })

    it('does not mint a taskId at parse time, since minting is not validation', () => {

        const delegate = new PostAgentTask(null as any, new ConfigMock());

        const request = delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: { repoURL: "https://github.com/x/y.git" } })) as any;

        assert.strictEqual(request.taskId, undefined);

    })

})

describe('PostAgentTask.do', () => {

    it('dispatches a valid task, returning a minted taskId and the Task File path', async () => {

        process.env.GCP_PID = "totoexperiments";
        const delegate = new PostAgentTask(null as any, new ControllerConfig(null as any));

        const response = await delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } } as any);

        assert.ok(response.taskId, "expected a minted taskId");
        assert.strictEqual(response.agentId, "agent-coder");
        assert.strictEqual(response.taskFile, `gs://totoexperiments-agents-data/coder/${response.taskId}/task.json`);

    })

    it('mints a different taskId for every dispatch', async () => {

        process.env.GCP_PID = "totoexperiments";
        const delegate = new PostAgentTask(null as any, new ControllerConfig(null as any));

        const first = await delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } } as any);
        const second = await delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } } as any);

        assert.notStrictEqual(first.taskId, second.taskId);

    })

    it('rejects an unregistered agent with a 404', async () => {

        const delegate = new PostAgentTask(null as any, new ControllerConfig(null as any));

        await assert.rejects(() => delegate.do({ agentId: "agent-codr", payload: { repoURL: "https://github.com/x/y.git" } } as any), (error: any) => {

            assert.strictEqual(error.code, 404);

            return true;
        });

    })

    it('rejects a payload missing the fields agent-coder requires', async () => {

        const delegate = new PostAgentTask(null as any, new ControllerConfig(null as any));

        await assert.rejects(() => delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git" } } as any), (error: any) => {

            assert.strictEqual(error.code, 400);
            assert.ok(error.message.includes("issueURL"), `expected the message to name issueURL, got: ${error.message}`);

            return true;
        });

    })

})
