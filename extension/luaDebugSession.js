"use strict";
//MIT License
//
//Copyright (c) 2020 Tom Blind
//
//Permission is hereby granted, free of charge, to any person obtaining a copy
//of this software and associated documentation files (the "Software"), to deal
//in the Software without restriction, including without limitation the rights
//to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
//copies of the Software, and to permit persons to whom the Software is
//furnished to do so, subject to the following conditions:
//
//The above copyright notice and this permission notice shall be included in all
//copies or substantial portions of the Software.
//
//THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
//IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
//FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
//AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
//LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
//OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
//SOFTWARE.
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.LuaDebugSession = void 0;
const vscode_debugadapter_1 = require("vscode-debugadapter");
const childProcess = require("child_process");
const path = require("path");
const fs = require("fs");
const message_1 = require("./message");
const launchConfig_1 = require("./launchConfig");
const debugPipe_1 = require("./debugPipe");
// const mainThreadId = 1;
const maxStackCount = 100;
const metatableDisplayName = "[[metatable]]";
const tableLengthDisplayName = "[[length]]";
const metatableAccessor = "lldbg_getmetatable";
const envVariable = "LOCAL_LUA_DEBUGGER_VSCODE";
const filePathEnvVariable = "LOCAL_LUA_DEBUGGER_FILEPATH";
const scriptRootsEnvVariable = "LOCAL_LUA_DEBUGGER_SCRIPT_ROOTS";
const breakInCoroutinesEnv = "LOCAL_LUA_DEBUGGER_BREAK_IN_COROUTINES";
const stepUnmappedLinesEnv = "LOCAL_LUA_DEBUGGER_STEP_UNMAPPED_LINES";
const inputFileEnv = "LOCAL_LUA_DEBUGGER_INPUT_FILE";
const outputFileEnv = "LOCAL_LUA_DEBUGGER_OUTPUT_FILE";
const pullFileEnv = "LOCAL_LUA_DEBUGGER_PULL_FILE";
function getEnvKey(env, searchKey) {
    const upperSearchKey = searchKey.toUpperCase();
    for (const key in env) {
        if (key.toUpperCase() === upperSearchKey) {
            return key;
        }
    }
    return searchKey;
}
function sortVariables(a, b) {
    const aIsBracketted = a.name.startsWith("[[");
    const bIsBracketted = b.name.startsWith("[[");
    if (aIsBracketted !== bIsBracketted) {
        return aIsBracketted ? -1 : 1;
    }
    const aAsNum = Number(a.name);
    const bAsNum = Number(b.name);
    const aIsNum = !isNaN(aAsNum);
    const bIsNum = !isNaN(bAsNum);
    if (aIsNum !== bIsNum) {
        return aIsNum ? -1 : 1;
    }
    else if (aIsNum && bIsNum) {
        return aAsNum - bAsNum;
    }
    let aName = a.name.replace("[", " ");
    let bName = b.name.replace("[", " ");
    const aNameLower = aName.toLowerCase();
    const bNameLower = bName.toLowerCase();
    if (aNameLower !== bNameLower) {
        aName = aNameLower;
        bName = bNameLower;
    }
    if (aName === bName) {
        return 0;
    }
    else if (aName < bName) {
        return -1;
    }
    else {
        return 1;
    }
}
function parseFrameId(frameId) {
    return { threadId: Math.floor(frameId / maxStackCount) + 1, frame: frameId % maxStackCount + 1 };
}
function makeFrameId(threadId, frame) {
    return (threadId - 1) * maxStackCount + (frame - 1);
}
class LuaDebugSession extends vscode_debugadapter_1.LoggingDebugSession {
    constructor() {
        super("lldebugger-log.txt");
        this.fileBreakpoints = {};
        this.process = null;
        this.debugPipe = null;
        this.outputText = "";
        this.messageHandlerQueue = [];
        this.variableHandles = new vscode_debugadapter_1.Handles(3 /* Global */ + 1);
        this.breakpointsPending = false;
        this.pendingScripts = null;
        this.pendingIgnorePatterns = null;
        this.autoContinueNext = false;
        this.activeThreads = new Map();
        this.isRunning = false;
        this.inDebuggerBreakpoint = false;
        this.pullBreakpointsSupport = false;
        this.usePipeCommutication = false;
    }
    initializeRequest(response, args) {
        this.showOutput("initializeRequest", "request" /* Request */);
        if (typeof response.body === "undefined") {
            response.body = {};
        }
        response.body.supportsConfigurationDoneRequest = true;
        response.body.supportsEvaluateForHovers = true;
        response.body.supportsSetVariable = true;
        response.body.supportsTerminateRequest = true;
        response.body.supportsConditionalBreakpoints = true;
        this.sendResponse(response);
        this.sendEvent(new vscode_debugadapter_1.InitializedEvent());
    }
    configurationDoneRequest(response, args) {
        this.showOutput("configurationDoneRequest", "request" /* Request */);
        super.configurationDoneRequest(response, args);
        if (typeof this.onConfigurationDone !== "undefined") {
            this.onConfigurationDone();
        }
    }
    launchRequest(response, args) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            this.config = args;
            this.autoContinueNext = this.config.stopOnEntry !== true;
            this.showOutput("launchRequest", "request" /* Request */);
            yield this.waitForConfiguration();
            if (this.config.scriptFiles) {
                this.pendingScripts = this.config.scriptFiles;
            }
            if (this.config.ignorePatterns) {
                this.pendingIgnorePatterns = this.config.ignorePatterns;
            }
            //Setup process
            if (!path.isAbsolute(this.config.cwd)) {
                this.config.cwd = path.resolve(this.config.workspacePath, this.config.cwd);
            }
            const cwd = this.config.cwd;
            const processOptions /* : child_process.SpawnOptions */ = {
                env: Object.assign({}, process.env),
                cwd,
                shell: true,
                detached: process.platform !== "win32"
            };
            if (typeof this.config.env !== "undefined") {
                for (const key in this.config.env) {
                    const envKey = getEnvKey(processOptions.env, key);
                    processOptions.env[envKey] = this.config.env[key];
                }
            }
            if (typeof this.config.pullBreakpointsSupport !== "undefined") {
                this.pullBreakpointsSupport = this.config.pullBreakpointsSupport;
            }
            //Set an environment variable so the debugger can detect the attached extension
            processOptions.env[envVariable] = "1";
            processOptions.env[filePathEnvVariable]
                = `${this.config.extensionPath}${path.sep}debugger${path.sep}lldebugger.lua`;
            //Pass options via environment variables
            if (typeof this.config.scriptRoots !== "undefined") {
                processOptions.env[scriptRootsEnvVariable] = this.config.scriptRoots.join(";");
            }
            if (typeof this.config.breakInCoroutines !== "undefined") {
                processOptions.env[breakInCoroutinesEnv] = this.config.breakInCoroutines ? "1" : "0";
            }
            if (typeof this.config.stepUnmappedLines !== "undefined") {
                processOptions.env[stepUnmappedLinesEnv] = this.config.stepUnmappedLines ? "1" : "0";
            }
            this.usePipeCommutication = this.config.program.communication === "pipe";
            //Open pipes
            if (this.usePipeCommutication || this.pullBreakpointsSupport) {
                if (process.platform === "win32") {
                    this.debugPipe = (0, debugPipe_1.createNamedPipe)();
                }
                else {
                    this.debugPipe = (0, debugPipe_1.createFifoPipe)();
                }
                if (this.usePipeCommutication) {
                    this.debugPipe.open(data => { void this.onDebuggerOutput(data); }, err => { this.showOutput(`${err}`, "error" /* Error */); });
                    processOptions.env[outputFileEnv] = this.debugPipe.getOutputPipePath();
                    processOptions.env[inputFileEnv] = this.debugPipe.getInputPipePath();
                }
            }
            if (this.pullBreakpointsSupport) {
                (_a = this.debugPipe) === null || _a === void 0 ? void 0 : _a.openPull(err => { this.showOutput(`${err}`, "error" /* Error */); });
                processOptions.env[pullFileEnv] = (_b = this.debugPipe) === null || _b === void 0 ? void 0 : _b.getPullPipePath();
            }
            //Append lua path so it can find debugger script
            this.updateLuaPath("LUA_PATH_5_2", processOptions.env, false);
            this.updateLuaPath("LUA_PATH_5_3", processOptions.env, false);
            this.updateLuaPath("LUA_PATH_5_4", processOptions.env, false);
            this.updateLuaPath("LUA_PATH", processOptions.env, true);
            //Launch process
            let processExecutable;
            let processArgs;
            if ((0, launchConfig_1.isCustomProgramConfig)(this.config.program)) {
                processExecutable = `"${this.config.program.command}"`;
                processArgs = typeof this.config.args !== "undefined" ? this.config.args : [];
            }
            else {
                processExecutable = `"${this.config.program.lua}"`;
                const programArgs = (typeof this.config.args !== "undefined")
                    ? `, ${this.config.args.map(a => `[[${a}]]`)}`
                    : "";
                processArgs = [
                    "-e",
                    "\"require('lldebugger').runFile("
                        + `[[${this.config.program.file}]],`
                        + "true,"
                        + `{[-1]=[[${this.config.program.lua}]],[0]=[[${this.config.program.file}]]${programArgs}}`
                        + ")\""
                ];
            }
            this.process = childProcess.spawn(processExecutable, processArgs, processOptions);
            this.showOutput(`launching \`${processExecutable} ${processArgs.join(" ")}\` from "${cwd}"`, "info" /* Info */);
            //Process callbacks
            if (this.usePipeCommutication) {
                this.assert(this.process.stdout).on("data", data => { this.showOutput(`${data}`, "stdout" /* StdOut */); });
            }
            else {
                this.assert(this.process.stdout).on("data", data => { void this.onDebuggerOutput(data); });
            }
            this.assert(this.process.stderr).on("data", data => { this.showOutput(`${data}`, "stderr" /* StdErr */); });
            this.process.on("close", (code, signal) => this.onDebuggerTerminated(`${code !== null ? code : signal}`));
            this.process.on("disconnect", () => this.onDebuggerTerminated("disconnected"));
            this.process.on("error", err => this.onDebuggerTerminated(`Failed to launch \`${processExecutable} ${processArgs.join(" ")}\` from "${cwd}": ${err}`, "error" /* Error */));
            this.process.on("exit", (code, signal) => this.onDebuggerTerminated(`${code !== null ? code : signal}`));
            this.isRunning = true;
            this.inDebuggerBreakpoint = false;
            this.showOutput("process launched", "info" /* Info */);
            this.sendResponse(response);
        });
    }
    setBreakPointsRequest(response, args) {
        var _a, _b;
        return __awaiter(this, void 0, void 0, function* () {
            this.showOutput("setBreakPointsRequest", "request" /* Request */);
            const filePath = args.source.path;
            if (this.process !== null && !this.isRunning) {
                if (!this.inDebuggerBreakpoint && this.pullBreakpointsSupport) {
                    this.breakpointsPending = true;
                    this.autoContinueNext = true;
                    (_a = this.debugPipe) === null || _a === void 0 ? void 0 : _a.requestPull();
                }
                const oldBreakpoints = this.fileBreakpoints[filePath];
                if (typeof oldBreakpoints !== "undefined") {
                    for (const breakpoint of oldBreakpoints) {
                        yield this.deleteBreakpoint(filePath, breakpoint);
                    }
                }
                if (typeof args.breakpoints !== "undefined") {
                    for (const breakpoint of args.breakpoints) {
                        yield this.setBreakpoint(filePath, breakpoint);
                    }
                }
            }
            else {
                if (this.pullBreakpointsSupport && this.process !== null) {
                    this.breakpointsPending = true;
                    this.autoContinueNext = true;
                    (_b = this.debugPipe) === null || _b === void 0 ? void 0 : _b.requestPull();
                }
                else {
                    this.breakpointsPending = true;
                }
            }
            this.fileBreakpoints[filePath] = args.breakpoints;
            const breakpoints = (typeof args.breakpoints !== "undefined")
                ? args.breakpoints.map(breakpoint => new vscode_debugadapter_1.Breakpoint(true, breakpoint.line))
                : [];
            response.body = { breakpoints };
            this.sendResponse(response);
        });
    }
    threadsRequest(response) {
        return __awaiter(this, void 0, void 0, function* () {
            this.showOutput("threadsRequest", "request" /* Request */);
            const msg = yield this.waitForCommandResponse("threads");
            if (msg.type === "threads") {
                //Remove dead threads
                const activeThreadIds = [...this.activeThreads.keys()];
                for (const activeId of activeThreadIds) {
                    if (!msg.threads.some(({ id }) => activeId === id)) {
                        this.sendEvent(new vscode_debugadapter_1.ThreadEvent("exited", activeId));
                        this.activeThreads.delete(activeId);
                    }
                }
                //Create new threads
                const newThreads = msg.threads.filter(({ id }) => !this.activeThreads.has(id));
                for (const { id, name } of newThreads) {
                    this.activeThreads.set(id, new vscode_debugadapter_1.Thread(id, name));
                }
                response.body = { threads: [...this.activeThreads.values()] };
            }
            else {
                response.success = false;
            }
            this.sendResponse(response);
        });
    }
    stackTraceRequest(response, args) {
        return __awaiter(this, void 0, void 0, function* () {
            this.showOutput(`stackTraceRequest ${args.startFrame}/${args.levels} (thread ${args.threadId})`, "request" /* Request */);
            const msg = yield this.waitForCommandResponse(`thread ${args.threadId}`);
            const startFrame = typeof args.startFrame !== "undefined" ? args.startFrame : 0;
            const maxLevels = typeof args.levels !== "undefined" ? args.levels : maxStackCount;
            if (msg.type === "stack") {
                const frames = [];
                const endFrame = Math.min(startFrame + maxLevels, msg.frames.length);
                for (let i = startFrame; i < endFrame; ++i) {
                    const frame = msg.frames[i];
                    let source;
                    let line = frame.line;
                    let column = 1; //Needed for exception display: https://github.com/microsoft/vscode/issues/46080
                    //Mapped source
                    if (typeof frame.mappedLocation !== "undefined") {
                        const mappedPath = this.resolvePath(frame.mappedLocation.source);
                        if (typeof mappedPath !== "undefined") {
                            source = new vscode_debugadapter_1.Source(path.basename(mappedPath), mappedPath);
                            line = frame.mappedLocation.line;
                            column = frame.mappedLocation.column;
                        }
                    }
                    //Un-mapped source
                    const sourcePath = this.resolvePath(frame.source);
                    if (typeof source === "undefined" && typeof sourcePath !== "undefined") {
                        source = new vscode_debugadapter_1.Source(path.basename(frame.source), sourcePath);
                    }
                    //Function name
                    let frameFunc = typeof frame.func !== "undefined" ? frame.func : "???";
                    if (typeof sourcePath === "undefined") {
                        frameFunc += ` ${frame.source}`;
                    }
                    const frameId = makeFrameId(args.threadId, i + 1);
                    const stackFrame = new vscode_debugadapter_1.StackFrame(frameId, frameFunc, source, line, column);
                    stackFrame.presentationHint = typeof sourcePath === "undefined" ? "subtle" : "normal";
                    frames.push(stackFrame);
                }
                response.body = { stackFrames: frames, totalFrames: msg.frames.length };
            }
            else {
                response.success = false;
            }
            this.sendResponse(response);
        });
    }
    scopesRequest(response, args) {
        return __awaiter(this, void 0, void 0, function* () {
            this.showOutput("scopesRequest", "request" /* Request */);
            const { threadId, frame } = parseFrameId(args.frameId);
            yield this.waitForCommandResponse(`thread ${threadId}`);
            yield this.waitForCommandResponse(`frame ${frame}`);
            const scopes = [
                new vscode_debugadapter_1.Scope("Locals", 1 /* Local */, false),
                new vscode_debugadapter_1.Scope("Upvalues", 2 /* Upvalue */, false),
                new vscode_debugadapter_1.Scope("Globals", 3 /* Global */, false)
            ];
            response.body = { scopes };
            this.sendResponse(response);
        });
    }
    variablesRequest(response, args) {
        return __awaiter(this, void 0, void 0, function* () {
            let cmd;
            let baseName;
            let isMultiResult = false;
            switch (args.variablesReference) {
                case 1 /* Local */:
                    cmd = "locals";
                    this.showOutput("variablesRequest locals", "request" /* Request */);
                    break;
                case 2 /* Upvalue */:
                    cmd = "ups";
                    this.showOutput("variablesRequest ups", "request" /* Request */);
                    break;
                case 3 /* Global */:
                    cmd = "globals";
                    this.showOutput("variablesRequest globals", "request" /* Request */);
                    break;
                default:
                    baseName = this.assert(this.variableHandles.get(args.variablesReference));
                    if (baseName.startsWith("@")) {
                        baseName = baseName.substr(1);
                        isMultiResult = true;
                    }
                    cmd = `props ${baseName}`;
                    if (typeof args.filter !== "undefined") {
                        cmd += ` ${args.filter}`;
                        if (typeof args.start !== "undefined") {
                            const start = Math.max(args.start, 1);
                            cmd += ` ${start}`;
                            if (typeof args.count !== "undefined") {
                                const count = args.start + args.count - start;
                                cmd += ` ${count}`;
                            }
                        }
                    }
                    else {
                        cmd += " all";
                    }
                    this.showOutput(`variablesRequest ${baseName} ${args.filter} ${args.start}/${args.count}`, "request" /* Request */);
                    break;
            }
            const vars = yield this.waitForCommandResponse(cmd);
            const variables = [];
            if (vars.type === "variables") {
                for (const variable of vars.variables) {
                    variables.push(this.buildVariable(variable, variable.name));
                }
            }
            else if (vars.type === "properties") {
                for (const variable of vars.properties) {
                    const refName = typeof baseName === "undefined" ? variable.name : `${baseName}[${variable.name}]`;
                    variables.push(this.buildVariable(variable, refName));
                }
                if (typeof vars.metatable !== "undefined" && typeof baseName !== "undefined") {
                    variables.push(this.buildVariable(vars.metatable, `${metatableAccessor}(${baseName})`, metatableDisplayName));
                }
                if (typeof vars.length !== "undefined" && !isMultiResult) {
                    variables.push(this.buildVariable(vars.length, `#${baseName}`, tableLengthDisplayName));
                }
            }
            else if (vars.type === "error") {
                response.success = false;
                response.message = this.filterErrorMessage(vars.error);
                this.sendResponse(response);
                return;
            }
            else {
                response.success = false;
            }
            variables.sort(sortVariables);
            response.body = { variables };
            this.sendResponse(response);
        });
    }
    continueRequest(response, args) {
        this.showOutput("continueRequest", "request" /* Request */);
        if (this.sendCommand("cont")) {
            this.variableHandles.reset();
            this.isRunning = true;
            this.inDebuggerBreakpoint = false;
        }
        else {
            response.success = false;
        }
        this.sendResponse(response);
    }
    nextRequest(response, args) {
        this.showOutput("nextRequest", "request" /* Request */);
        if (this.sendCommand("step")) {
            this.variableHandles.reset();
            this.isRunning = true;
            this.inDebuggerBreakpoint = false;
        }
        else {
            response.success = false;
        }
        this.sendResponse(response);
    }
    stepInRequest(response, args) {
        this.showOutput("stepInRequest", "request" /* Request */);
        if (this.sendCommand("stepin")) {
            this.variableHandles.reset();
            this.isRunning = true;
            this.inDebuggerBreakpoint = false;
        }
        else {
            response.success = false;
        }
        this.sendResponse(response);
    }
    stepOutRequest(response, args) {
        this.showOutput("stepOutRequest", "request" /* Request */);
        if (this.sendCommand("stepout")) {
            this.variableHandles.reset();
            this.isRunning = true;
            this.inDebuggerBreakpoint = false;
        }
        else {
            response.success = false;
        }
        this.sendResponse(response);
    }
    setVariableRequest(response, args) {
        return __awaiter(this, void 0, void 0, function* () {
            let msg;
            if (args.variablesReference === 3 /* Global */
                || args.variablesReference === 1 /* Local */
                || args.variablesReference === 2 /* Upvalue */) {
                this.showOutput(`setVariableRequest ${args.name} = ${args.value}`, "request" /* Request */);
                msg = yield this.waitForCommandResponse(`exec ${args.name} = ${args.value}; return ${args.name}`);
            }
            else if (args.name === metatableDisplayName) {
                const name = this.variableHandles.get(args.variablesReference);
                this.showOutput(`setVariableRequest ${name}[[metatable]] = ${args.value}`, "request" /* Request */);
                msg = yield this.waitForCommandResponse(`eval setmetatable(${name}, ${args.value})`);
            }
            else if (args.name === tableLengthDisplayName) {
                const name = this.variableHandles.get(args.variablesReference);
                this.showOutput(`setVariableRequest ${name}[[length]] = ${args.value}`, "request" /* Request */);
                msg = yield this.waitForCommandResponse(`eval #${name}`);
            }
            else {
                const name = `${this.variableHandles.get(args.variablesReference)}[${args.name}]`;
                this.showOutput(`setVariableRequest ${name} = ${args.value}`, "request" /* Request */);
                msg = yield this.waitForCommandResponse(`exec ${name} = ${args.value}; return ${name}`);
            }
            const result = this.handleEvaluationResult(args.value, msg);
            if (!result.success) {
                if (typeof result.error !== "undefined") {
                    this.showOutput(result.error, "error" /* Error */);
                }
                response.success = false;
            }
            else {
                response.body = result;
            }
            this.sendResponse(response);
        });
    }
    evaluateRequest(response, args) {
        return __awaiter(this, void 0, void 0, function* () {
            const expression = args.expression;
            this.showOutput(`evaluateRequest ${expression}`, "request" /* Request */);
            if (typeof args.frameId !== "undefined") {
                const { threadId, frame } = parseFrameId(args.frameId);
                yield this.waitForCommandResponse(`thread ${threadId}`);
                yield this.waitForCommandResponse(`frame ${frame}`);
            }
            const msg = yield this.waitForCommandResponse(`eval ${expression}`);
            const result = this.handleEvaluationResult(expression, msg);
            if (!result.success) {
                if (typeof result.error !== "undefined" && args.context !== "hover") {
                    if (args.context !== "watch") {
                        this.showOutput(result.error, "error" /* Error */);
                    }
                    response.success = false;
                    response.message = result.error;
                }
            }
            else {
                response.body = { result: result.value, variablesReference: result.variablesReference };
            }
            this.sendResponse(response);
        });
    }
    terminateRequest(response, args) {
        this.showOutput("terminateRequest", "request" /* Request */);
        if (this.process !== null) {
            if (process.platform === "win32") {
                childProcess.spawn("taskkill", ["/pid", this.assert(this.process.pid).toString(), "/f", "/t"]);
            }
            else {
                process.kill(-this.assert(this.process.pid), "SIGKILL");
            }
        }
        this.isRunning = false;
        this.inDebuggerBreakpoint = false;
        this.sendResponse(response);
    }
    handleEvaluationResult(expression, msg) {
        if (msg.type === "result") {
            if (msg.results.length === 0) {
                return { success: true, value: "nil", variablesReference: 0 };
            }
            else if (msg.results.length === 1) {
                const result = msg.results[0];
                const variablesReference = (result.type === "table" || result.type === "function")
                    ? this.variableHandles.create(expression)
                    : 0;
                return { success: true, value: this.getValueString(result), variablesReference };
            }
            else {
                const variablesReference = this.variableHandles.create(`@({${expression}})`);
                const value = `(${msg.results.map(r => this.getValueString(r)).join(", ")})`;
                return { success: true, value, variablesReference };
            }
        }
        else if (msg.type === "error") {
            return { success: false, error: this.filterErrorMessage(msg.error) };
        }
        else {
            return { success: false };
        }
    }
    buildVariable(variable, refName, variableName) {
        var _a;
        let valueStr;
        let ref;
        if (refName === "...") {
            valueStr = typeof variable.error !== "undefined"
                ? `[error: ${this.filterErrorMessage(variable.error)}]`
                : `(${(_a = variable.value) !== null && _a !== void 0 ? _a : ""})`;
            ref = variable.type === "table" ? this.variableHandles.create("@({...})") : 0;
        }
        else if (variable.type === "table" || variable.type === "function") {
            valueStr = this.getValueString(variable);
            ref = this.variableHandles.create(refName);
        }
        else {
            valueStr = this.getValueString(variable);
        }
        const name = typeof variableName !== "undefined" ? variableName : variable.name;
        const indexedVariables = typeof variable.length !== "undefined" && variable.length > 0
            ? variable.length + 1
            : variable.length;
        if (variable.type === "table" || variable.type === "function") {
            return new vscode_debugadapter_1.Variable(name, valueStr, ref, indexedVariables, 1);
        }
        else {
            return new vscode_debugadapter_1.Variable(name, valueStr, ref, indexedVariables);
        }
    }
    assert(value, message = "assertion failed") {
        if (value === null || typeof value === "undefined") {
            this.sendEvent(new vscode_debugadapter_1.OutputEvent(message));
            throw new Error(message);
        }
        return value;
    }
    filterErrorMessage(errorMsg) {
        const errorOnly = /^.+:\d+:\s*(.+)/.exec(errorMsg);
        return (errorOnly !== null && errorOnly.length > 1) ? errorOnly[1] : errorMsg;
    }
    getValueString(value) {
        if (typeof value.error !== "undefined") {
            return `[error: ${this.filterErrorMessage(value.error)}]`;
        }
        else if (typeof value.value !== "undefined") {
            return value.value;
        }
        else {
            return `[${value.type}]`;
        }
    }
    resolvePath(filePath) {
        if (filePath.length === 0) {
            return;
        }
        const config = this.assert(this.config);
        let fullPath = path.isAbsolute(filePath) ? filePath : path.join(config.cwd, filePath);
        if (fs.existsSync(fullPath)) {
            return fullPath;
        }
        if (typeof config.scriptRoots === "undefined") {
            return;
        }
        for (const rootPath of config.scriptRoots) {
            if (path.isAbsolute(rootPath)) {
                fullPath = path.join(rootPath, filePath);
            }
            else {
                fullPath = path.join(config.cwd, rootPath, filePath);
            }
            if (fs.existsSync(fullPath)) {
                return fullPath;
            }
        }
        return;
    }
    updateLuaPath(pathKey, env, force) {
        const luaPathKey = getEnvKey(env, pathKey);
        let luaPath = env[luaPathKey];
        if (typeof luaPath === "undefined") {
            if (!force) {
                return;
            }
            luaPath = ";;"; //Retain defaults
        }
        else if (luaPath.length > 0 && !luaPath.endsWith(";")) {
            luaPath += ";";
        }
        env[luaPathKey] = `${luaPath}${this.assert(this.config).extensionPath}/debugger/?.lua`;
    }
    setBreakpoint(filePath, breakpoint) {
        const cmd = typeof breakpoint.condition !== "undefined"
            ? `break set ${filePath}:${breakpoint.line} ${breakpoint.condition}`
            : `break set ${filePath}:${breakpoint.line}`;
        return this.waitForCommandResponse(cmd);
    }
    deleteBreakpoint(filePath, breakpoint) {
        return this.waitForCommandResponse(`break delete ${filePath}:${breakpoint.line}`);
    }
    onDebuggerStop(msg) {
        return __awaiter(this, void 0, void 0, function* () {
            this.isRunning = false;
            const prevInDebugger = this.inDebuggerBreakpoint;
            this.inDebuggerBreakpoint = true;
            if (this.pendingScripts) {
                for (const scriptFile of this.pendingScripts) {
                    const resultMsg = yield this.waitForCommandResponse(`script ${scriptFile}`);
                    if (resultMsg.type === "result") {
                        for (const result of resultMsg.results) {
                            if (typeof result.value !== "undefined") {
                                this.showOutput(this.getValueString(result), "info" /* Info */);
                            }
                        }
                    }
                    else if (resultMsg.type === "error") {
                        this.showOutput(resultMsg.error, "error" /* Error */);
                    }
                }
                this.pendingScripts = null;
            }
            if (this.pendingIgnorePatterns) {
                for (const ignorePattern of this.pendingIgnorePatterns) {
                    const resultMsg = yield this.waitForCommandResponse(`ignore ${ignorePattern}`);
                    if (resultMsg.type === "result") {
                        for (const result of resultMsg.results) {
                            if (typeof result.value !== "undefined") {
                                this.showOutput(this.getValueString(result), "info" /* Info */);
                            }
                        }
                    }
                    else if (resultMsg.type === "error") {
                        this.showOutput(resultMsg.error, "error" /* Error */);
                    }
                }
                this.pendingIgnorePatterns = null;
            }
            if (this.breakpointsPending) {
                this.breakpointsPending = false;
                yield this.waitForCommandResponse("break clear");
                for (const filePath in this.fileBreakpoints) {
                    const breakpoints = this.fileBreakpoints[filePath];
                    for (const breakpoint of breakpoints) {
                        yield this.setBreakpoint(filePath, breakpoint);
                    }
                }
            }
            if (msg.breakType === "error") {
                this.showOutput(msg.message, "error" /* Error */);
                const evt = new vscode_debugadapter_1.StoppedEvent("exception", msg.threadId, msg.message);
                evt.body.allThreadsStopped = true;
                this.sendEvent(evt);
                return;
            }
            if (this.autoContinueNext) {
                this.autoContinueNext = false;
                this.inDebuggerBreakpoint = prevInDebugger;
                this.assert(this.sendCommand("autocont"));
            }
            else {
                const evt = new vscode_debugadapter_1.StoppedEvent("breakpoint", msg.threadId);
                evt.body.allThreadsStopped = true;
                this.sendEvent(evt);
            }
        });
    }
    handleDebugMessage(msg) {
        const handler = this.messageHandlerQueue.shift();
        if (typeof handler !== "undefined") {
            handler(msg);
        }
    }
    onDebuggerOutput(data) {
        return __awaiter(this, void 0, void 0, function* () {
            this.outputText += `${data}`;
            const [messages, processed, unprocessed] = message_1.Message.parse(this.outputText);
            let debugBreak;
            for (const msg of messages) {
                this.showOutput(JSON.stringify(msg), "message" /* Message */);
                if (msg.type === "debugBreak") {
                    debugBreak = msg;
                }
                else {
                    this.handleDebugMessage(msg);
                }
            }
            this.showOutput(processed, "stdout" /* StdOut */);
            this.outputText = unprocessed;
            if (typeof debugBreak !== "undefined") {
                yield this.onDebuggerStop(debugBreak);
            }
        });
    }
    onDebuggerTerminated(result, category = "info" /* Info */) {
        if (this.process === null) {
            return;
        }
        if (this.debugPipe) {
            this.debugPipe.close();
            this.debugPipe = null;
        }
        this.process = null;
        this.isRunning = false;
        this.inDebuggerBreakpoint = false;
        if (this.outputText.length > 0) {
            this.showOutput(this.outputText, "stdout" /* StdOut */);
            this.outputText = "";
        }
        this.showOutput(`debugging ended: ${result}`, category);
        this.sendEvent(new vscode_debugadapter_1.TerminatedEvent());
    }
    sendCommand(cmd) {
        var _a;
        if (this.process === null || this.isRunning) {
            return false;
        }
        this.showOutput(cmd, "command" /* Command */);
        if (this.usePipeCommutication) {
            (_a = this.debugPipe) === null || _a === void 0 ? void 0 : _a.write(`${cmd}\n`);
        }
        else {
            this.assert(this.process.stdin).write(`${cmd}\n`);
        }
        return true;
    }
    waitForCommandResponse(cmd) {
        if (this.sendCommand(cmd)) {
            return new Promise(resolve => {
                this.messageHandlerQueue.push(resolve);
            });
        }
        else {
            return Promise.resolve({ tag: "$luaDebug", type: "error", error: "Failed to send command" });
        }
    }
    showOutput(msg, category) {
        if (msg.length === 0) {
            return;
        }
        else if (category === "stdout" /* StdOut */ || category === "stderr" /* StdErr */) {
            this.sendEvent(new vscode_debugadapter_1.OutputEvent(msg, category));
        }
        else if (category === "error" /* Error */) {
            this.sendEvent(new vscode_debugadapter_1.OutputEvent(`\n[${category}] ${msg}\n`, "stderr"));
        }
        else if (typeof this.config !== "undefined" && this.config.verbose === true) {
            this.sendEvent(new vscode_debugadapter_1.OutputEvent(`\n[${category}] ${msg}\n`));
        }
    }
    waitForConfiguration() {
        return new Promise(resolve => { this.onConfigurationDone = resolve; });
    }
}
exports.LuaDebugSession = LuaDebugSession;
//# sourceMappingURL=luaDebugSession.js.map