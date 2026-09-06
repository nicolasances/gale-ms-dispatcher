import { APIOptions, TotoControllerConfig } from 'totoms';
import { Agent } from './model/Agent';
import { AgentRegistry } from './model/AgentRegistry';

const dbName = 'gale';
const collections = {
    tasks: 'tasks',
};

/**
 * The Agent Registry, declared as a literal.
 *
 * Registering an agent is a commit and a deploy, not an API call: that keeps agent behaviour changes reviewable
 * (docs/concept.md §3.3). Note that `agentId` and `bucketPrefix` are separate on purpose — agent-coder hardcodes
 * AGENT_NAME = "coder" in runner/main.py and writes to coder/{taskId}/task.json, while the identifier this service
 * exposes is "agent-coder".
 *
 * `requiredTaskFields` tracks agent-coder issue #5, which replaces the Task File's free-form `prompt` with
 * `issueURL`. Until that issue is released, the deployed container still expects `prompt` and a dispatched run
 * will fail inside the container.
 */
const AGENTS: Agent[] = [
    new Agent({ agentId: "agent-coder", jobName: "agent-coder", region: "europe-west1", bucketPrefix: "coder", requiredTaskFields: ["repoURL", "issueURL"] }),
];

export class ControllerConfig extends TotoControllerConfig {

    getMongoSecretNames(): { userSecretName: string; pwdSecretName: string; } | null {
        return null;
    }

    getProps(): APIOptions {
        return {}
    }

    /**
     * Provides the Agent Registry.
     *
     * @returns {AgentRegistry} the registry of every agent this Dispatcher can dispatch to
     */
    getAgentRegistry(): AgentRegistry {

        return new AgentRegistry({ agents: AGENTS });

    }

    /**
     * Names the GCS bucket holding Task Files, Result Files and Trace Files for every agent.
     *
     * Derived from the project id rather than configured separately, so there is one fewer variable to keep in
     * sync, at the cost of a naming convention the bucket must follow (docs/concept.md §4.1).
     *
     * @returns {string} the agents-data bucket name
     */
    getAgentsDataBucket(): string {

        return `${process.env.GCP_PID}-agents-data`;

    }

    getDBName(): string {
        return dbName;
    }

    getCollections(): { tasks: string } {
        return collections;
    }

}
