import assert from "assert";
import { TaskFile } from "../../src/model/TaskFile";

describe('TaskFile.contents', () => {

    it('carries the caller payload through verbatim', () => {

        const contents = TaskFile.contents({ taskId: "5f3c1e7a", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3", baseBranch: "main" } });

        assert.strictEqual(contents.repoURL, "https://github.com/x/y.git");
        assert.strictEqual(contents.issueURL, "https://github.com/x/y/issues/3");
        assert.strictEqual(contents.baseBranch, "main");

    })

    it('adds the minted taskId', () => {

        const contents = TaskFile.contents({ taskId: "5f3c1e7a", payload: { repoURL: "https://github.com/x/y.git" } });

        assert.strictEqual(contents.taskId, "5f3c1e7a");

    })

    it('lets the minted taskId win over one supplied by the caller', () => {

        const contents = TaskFile.contents({ taskId: "5f3c1e7a", payload: { taskId: "caller-chosen", repoURL: "https://github.com/x/y.git" } });

        assert.strictEqual(contents.taskId, "5f3c1e7a");

    })

    it('does not default baseBranch, since the agent owns that default', () => {

        const contents = TaskFile.contents({ taskId: "5f3c1e7a", payload: { repoURL: "https://github.com/x/y.git" } });

        assert.ok(!("baseBranch" in contents), "expected baseBranch to be absent when the caller did not send it");

    })

    it('keeps fields the Dispatcher knows nothing about', () => {

        const contents = TaskFile.contents({ taskId: "5f3c1e7a", payload: { repoURL: "https://github.com/x/y.git", someFutureField: { nested: true } } });

        assert.deepStrictEqual(contents.someFutureField, { nested: true });

    })

    it('serialises to indented JSON, so a Task File is readable in the GCS console', () => {

        const json = TaskFile.toJSON({ taskId: "5f3c1e7a", payload: { repoURL: "https://github.com/x/y.git" } });

        assert.ok(json.includes("\n"), "expected multi-line JSON");
        assert.deepStrictEqual(JSON.parse(json), { repoURL: "https://github.com/x/y.git", taskId: "5f3c1e7a" });

    })

})
