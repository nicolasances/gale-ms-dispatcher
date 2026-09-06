"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const assert_1 = __importDefault(require("assert"));
const totoms_1 = require("totoms");
const PostAgentTask_1 = require("../../src/dlg/PostAgentTask");
const Config_1 = require("../../src/Config");
/** Builds the express-like request shape that parseRequest reads from. */
function fakeRequest({ agentId, body }) {
    return { params: { agentId: agentId }, body: body, query: {}, headers: {} };
}
describe('PostAgentTask.parseRequest', () => {
    it('extracts the agentId from the path and the payload from the body', () => {
        const delegate = new PostAgentTask_1.PostAgentTask(null, new totoms_1.ConfigMock());
        const request = delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } }));
        assert_1.default.strictEqual(request.agentId, "agent-coder");
        assert_1.default.strictEqual(request.payload.repoURL, "https://github.com/x/y.git");
    });
    it('rejects a request with no body', () => {
        const delegate = new PostAgentTask_1.PostAgentTask(null, new totoms_1.ConfigMock());
        assert_1.default.throws(() => delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: undefined })), (error) => {
            assert_1.default.strictEqual(error.code, 400);
            return true;
        });
    });
    it('rejects a body that is not an object', () => {
        const delegate = new PostAgentTask_1.PostAgentTask(null, new totoms_1.ConfigMock());
        assert_1.default.throws(() => delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: "a string" })), (error) => error.code === 400);
    });
    it('does not mint a taskId at parse time, since minting is not validation', () => {
        const delegate = new PostAgentTask_1.PostAgentTask(null, new totoms_1.ConfigMock());
        const request = delegate.parseRequest(fakeRequest({ agentId: "agent-coder", body: { repoURL: "https://github.com/x/y.git" } }));
        assert_1.default.strictEqual(request.taskId, undefined);
    });
});
describe('PostAgentTask.do', () => {
    it('dispatches a valid task, returning a minted taskId and the Task File path', () => __awaiter(void 0, void 0, void 0, function* () {
        process.env.GCP_PID = "totoexperiments";
        const delegate = new PostAgentTask_1.PostAgentTask(null, new Config_1.ControllerConfig(null));
        const response = yield delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } });
        assert_1.default.ok(response.taskId, "expected a minted taskId");
        assert_1.default.strictEqual(response.agentId, "agent-coder");
        assert_1.default.strictEqual(response.taskFile, `gs://totoexperiments-agents-data/coder/${response.taskId}/task.json`);
    }));
    it('mints a different taskId for every dispatch', () => __awaiter(void 0, void 0, void 0, function* () {
        process.env.GCP_PID = "totoexperiments";
        const delegate = new PostAgentTask_1.PostAgentTask(null, new Config_1.ControllerConfig(null));
        const first = yield delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } });
        const second = yield delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git", issueURL: "https://github.com/x/y/issues/3" } });
        assert_1.default.notStrictEqual(first.taskId, second.taskId);
    }));
    it('rejects an unregistered agent with a 404', () => __awaiter(void 0, void 0, void 0, function* () {
        const delegate = new PostAgentTask_1.PostAgentTask(null, new Config_1.ControllerConfig(null));
        yield assert_1.default.rejects(() => delegate.do({ agentId: "agent-codr", payload: { repoURL: "https://github.com/x/y.git" } }), (error) => {
            assert_1.default.strictEqual(error.code, 404);
            return true;
        });
    }));
    it('rejects a payload missing the fields agent-coder requires', () => __awaiter(void 0, void 0, void 0, function* () {
        const delegate = new PostAgentTask_1.PostAgentTask(null, new Config_1.ControllerConfig(null));
        yield assert_1.default.rejects(() => delegate.do({ agentId: "agent-coder", payload: { repoURL: "https://github.com/x/y.git" } }), (error) => {
            assert_1.default.strictEqual(error.code, 400);
            assert_1.default.ok(error.message.includes("issueURL"), `expected the message to name issueURL, got: ${error.message}`);
            return true;
        });
    }));
});
