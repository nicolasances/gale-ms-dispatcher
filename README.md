# Gale Dispatcher Service

This service is taking care of dispatching tasks to agents in my Gale ecosystem.

Gale was a first attempt to build an agent orchestrator, and I am now moving towards a different setup. So the Github Gale project is NOT up-to-date with this service here. 
This service represents the beginning of the "new Gale".

It exposes two endpoints: one to dispatch a task to an agent (which writes the agent's Task File to GCS and triggers its Cloud Run Job), and one to check what happened to that task.

```
POST /agents/{agentId}/tasks    →  { "taskId": "…" }
GET  /tasks/{taskId}            →  { "status": "running", … }
```

Supported agents: 
- [agent-coder](https://github.com/nicolasances/agent-coder) 

## Documentation

- [Concept](docs/concept.md) — what this service is, what it deliberately isn't, its data models and open questions.
- [Creating a Delegate](docs/create-dlg.md)
