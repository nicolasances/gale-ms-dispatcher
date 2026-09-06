import assert from "assert";
import { Agent } from "../../src/model/Agent";
import { AgentRegistry } from "../../src/model/AgentRegistry";

/** The agent-coder registry entry, as it is declared in Config.ts. */
function coderAgent(): Agent {
    return new Agent({ agentId: "agent-coder", jobName: "agent-coder", region: "europe-west1", bucketPrefix: "coder", requiredTaskFields: ["repoURL"] });
}

describe('AgentRegistry.resolve', () => {

    it('returns the agent registered under the given agentId', () => {

        const coder = coderAgent();
        const registry = new AgentRegistry({ agents: [coder] });

        assert.strictEqual(registry.resolve({ agentId: "agent-coder" }), coder);

    })

    it('throws a 404 for an agentId that is not registered', () => {

        const registry = new AgentRegistry({ agents: [coderAgent()] });

        assert.throws(() => registry.resolve({ agentId: "agent-codr" }), (error: any) => {

            assert.strictEqual(error.code, 404);
            assert.ok(error.message.includes("agent-codr"), `expected the message to name the unknown agent, got: ${error.message}`);

            return true;
        });

    })

    it('does not resolve an agent by its bucket prefix', () => {

        const registry = new AgentRegistry({ agents: [coderAgent()] });

        assert.throws(() => registry.resolve({ agentId: "coder" }), (error: any) => error.code === 404);

    })

})
