/**
 * The Task File: the JSON object written to GCS as the input to one agent run.
 *
 * Written once by the Dispatcher, before the execution is triggered, and never updated — it is the immutable
 * record of what was asked (docs/concept.md §4.3). The container resolves it from its TASK_ID override the
 * moment it starts, which is why the write must precede the trigger.
 *
 * This class only knows how to *compose* the object. Putting it in GCS is the caller's job.
 */
export class TaskFile {

    /**
     * Composes the Task File contents for one dispatch.
     *
     * The payload passes through verbatim: the Dispatcher adds the taskId and interprets nothing else. In
     * particular it does not default `baseBranch` — the agent owns that default, and duplicating it here would
     * create two places for it to drift (docs/concept.md §3.1).
     *
     * The minted taskId is applied last, so a caller that supplies its own cannot make the Task File's id
     * disagree with its own folder name.
     *
     * @param {string} taskId - the id minted by the Dispatcher, which is also the Task File's folder name
     * @param {any} payload - the caller's request body
     *
     * @returns {any} the object to serialise into task.json
     */
    static contents({ taskId, payload }: { taskId: string, payload: any }): any {

        return { ...payload, taskId: taskId };

    }

    /**
     * Serialises the Task File contents, indented so that it stays readable in the GCS console.
     *
     * @param {string} taskId - the id minted by the Dispatcher
     * @param {any} payload - the caller's request body
     *
     * @returns {string} the JSON text of the Task File
     */
    static toJSON({ taskId, payload }: { taskId: string, payload: any }): string {

        return JSON.stringify(TaskFile.contents({ taskId: taskId, payload: payload }), null, 4);

    }

}
