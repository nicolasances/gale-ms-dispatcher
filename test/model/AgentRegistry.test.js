"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const Agent_1 = require("../../src/model/Agent");
const AgentRegistry_1 = require("../../src/model/AgentRegistry");
/** The agent-coder registry entry, as it is declared in Config.ts. */
function coderAgent() {
    return new Agent_1.Agent({ agentId: "agent-coder", jobName: "agent-coder", region: "europe-west1", bucketPrefix: "coder", requiredTaskFields: ["repoURL"] });
}
describe('AgentRegistry.resolve', () => {
    it('returns the agent registered under the given agentId', () => {
        const coder = coderAgent();
        const registry = new AgentRegistry_1.AgentRegistry({ agents: [coder] });
        assert_1.default.strictEqual(registry.resolve({ agentId: "agent-coder" }), coder);
    });
    it('throws a 404 for an agentId that is not registered', () => {
        const registry = new AgentRegistry_1.AgentRegistry({ agents: [coderAgent()] });
        assert_1.default.throws(() => registry.resolve({ agentId: "agent-codr" }), (error) => {
            assert_1.default.strictEqual(error.code, 404);
            assert_1.default.ok(error.message.includes("agent-codr"), `expected the message to name the unknown agent, got: ${error.message}`);
            return true;
        });
    });
    it('does not resolve an agent by its bucket prefix', () => {
        const registry = new AgentRegistry_1.AgentRegistry({ agents: [coderAgent()] });
        assert_1.default.throws(() => registry.resolve({ agentId: "coder" }), (error) => error.code === 404);
    });
});
