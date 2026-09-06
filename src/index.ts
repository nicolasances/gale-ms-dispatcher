import { getHyperscalerConfiguration, SupportedHyperscalers, TotoMicroservice, TotoMicroserviceConfiguration } from 'totoms';
import { ControllerConfig } from "./Config";
import { PostAgentTask } from './dlg/PostAgentTask';

const config: TotoMicroserviceConfiguration = {
    serviceName: "gale-ms-dispatcher",
    basePath: '/dispatcher',
    environment: {
        hyperscaler: process.env.HYPERSCALER as SupportedHyperscalers || "gcp",
        hyperscalerConfiguration: getHyperscalerConfiguration()
    },
    customConfiguration: ControllerConfig,
    apiConfiguration: {
        apiEndpoints: [
            { method: 'POST', path: '/agents/:agentId/tasks', delegate: PostAgentTask }
        ],
        apiOptions: { noCorrelationId: true }
    },
};

TotoMicroservice.init(config).then(microservice => {
    microservice.start();
});
