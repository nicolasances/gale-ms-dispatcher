import { ValidationError } from "totoms";
import { Agent } from "./Agent";

/**
 * The Agent Registry: the set of agents this Dispatcher can dispatch to.
 *
 * Backed by a literal declared in Config.ts rather than by a collection, so that registering an agent is a
 * reviewable commit rather than an API call (docs/concept.md §3.3). The backing store can change without
 * delegates noticing, which is the only reason this is a class and not a bare map lookup.
 */
export class AgentRegistry {

    private agents: Agent[];        // Every registered agent, in declaration order.

    constructor({ agents }: { agents: Agent[] }) {

        this.agents = agents;

    }

    /**
     * Resolves an agentId to its registered Agent.
     *
     * Resolution is on agentId alone: an agent is never found by its bucketPrefix, even though for some agents
     * the two are similar.
     *
     * @param {string} agentId - the {agentId} path segment of the dispatch request
     *
     * @returns {Agent} the registered agent
     *
     * @throws {ValidationError} 404 when no agent is registered under that id
     */
    resolve({ agentId }: { agentId: string }): Agent {

        const agent = this.agents.find(candidate => candidate.agentId === agentId);

        if (!agent) throw new ValidationError(404, `No agent registered with id [${agentId}]. Registered agents: ${this.agents.map(candidate => candidate.agentId).join(", ")}`);

        return agent;

    }

}
