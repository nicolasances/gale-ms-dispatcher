"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const Agent_1 = require("../../src/model/Agent");
/** The agent-coder registry entry, as it is declared in Config.ts. */
function coderAgent({ requiredTaskFields }) {
    return new Agent_1.Agent({ agentId: "agent-coder", jobName: "agent-coder", region: "europe-west1", bucketPrefix: "coder", requiredTaskFields: requiredTaskFields });
}
describe('Agent.validateTaskPayload', () => {
    it('accepts a payload carrying every required field', () => {
        const agent = coderAgent({ requiredTaskFields: ["repoURL", "issueURL"] });
        assert_1.default.doesNotThrow(() => agent.validateTaskPayload({ repoURL: "https://github.com/nicolasances/agent-coder.git", issueURL: "https://github.com/nicolasances/agent-coder/issues/3" }));
    });
    it('rejects a payload missing a required field, naming the field', () => {
        const agent = coderAgent({ requiredTaskFields: ["repoURL", "issueURL"] });
        assert_1.default.throws(() => agent.validateTaskPayload({ repoURL: "https://github.com/nicolasances/agent-coder.git" }), (error) => {
            assert_1.default.strictEqual(error.code, 400);
            assert_1.default.ok(error.message.includes("issueURL"), `expected the message to name issueURL, got: ${error.message}`);
            return true;
        });
    });
    it('names every missing required field, not just the first', () => {
        const agent = coderAgent({ requiredTaskFields: ["repoURL", "issueURL"] });
        assert_1.default.throws(() => agent.validateTaskPayload({ baseBranch: "main" }), (error) => {
            assert_1.default.ok(error.message.includes("repoURL"), `expected the message to name repoURL, got: ${error.message}`);
            assert_1.default.ok(error.message.includes("issueURL"), `expected the message to name issueURL, got: ${error.message}`);
            return true;
        });
    });
    it('treats a blank string as missing', () => {
        const agent = coderAgent({ requiredTaskFields: ["repoURL"] });
        assert_1.default.throws(() => agent.validateTaskPayload({ repoURL: "   " }), (error) => error.code === 400);
    });
    it('ignores fields it does not require, so unknown fields pass through', () => {
        const agent = coderAgent({ requiredTaskFields: ["repoURL"] });
        assert_1.default.doesNotThrow(() => agent.validateTaskPayload({ repoURL: "https://github.com/x/y.git", somethingElse: 42 }));
    });
});
describe('Agent.taskFileObjectName', () => {
    it('names the object under the agent bucket prefix, not the agentId', () => {
        const agent = coderAgent({ requiredTaskFields: [] });
        assert_1.default.strictEqual(agent.taskFileObjectName({ taskId: "5f3c1e7a" }), "coder/5f3c1e7a/task.json");
    });
});
