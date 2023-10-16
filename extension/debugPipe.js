"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createFifoPipe = exports.createNamedPipe = void 0;
const crypto = require("crypto");
const net = require("net");
const childProcess = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
function createNamedPipe() {
    const pipeId = crypto.randomBytes(16).toString("hex");
    const outputPipePath = `\\\\.\\pipe\\lldbg_out_${pipeId}`;
    const inputPipePath = `\\\\.\\pipe\\lldbg_in_${pipeId}`;
    const pullPipePath = `\\\\.\\pipe\\lldbg_pull_${pipeId}`;
    let outputPipe = null;
    let inputPipe = null;
    let pullPipe = null;
    let inputStream;
    let pullStream;
    let onErrorCallback = null;
    return {
        open: (onData, onError) => {
            onErrorCallback = onError;
            outputPipe = net.createServer(stream => {
                stream.on("data", onData);
                stream.on("error", err => onError(`error on output pipe: ${err}`));
            });
            outputPipe.listen(outputPipePath);
            inputPipe = net.createServer(stream => {
                stream.on("error", err => onError(`error on input pipe: ${err}`));
                inputStream = stream;
            });
            inputPipe.listen(inputPipePath);
        },
        openPull: (onError) => {
            if (!onErrorCallback) {
                onErrorCallback = onError;
            }
            pullPipe = net.createServer(stream => {
                stream.on("error", err => {
                    onError(`error on pull pipe: ${err}`);
                });
                pullStream = stream;
            });
            pullPipe.listen(pullPipePath);
        },
        close: () => {
            outputPipe === null || outputPipe === void 0 ? void 0 : outputPipe.close();
            outputPipe = null;
            inputPipe === null || inputPipe === void 0 ? void 0 : inputPipe.close();
            inputPipe = null;
            inputStream = null;
            pullPipe = null;
            pullStream = null;
        },
        write: data => {
            inputStream === null || inputStream === void 0 ? void 0 : inputStream.write(data);
        },
        requestPull: () => {
            pullStream === null || pullStream === void 0 ? void 0 : pullStream.write("pull|\n");
        },
        getOutputPipePath: () => outputPipePath,
        getInputPipePath: () => inputPipePath,
        getPullPipePath: () => pullPipePath,
    };
}
exports.createNamedPipe = createNamedPipe;
function createFifoPipe() {
    const pipeId = crypto.randomBytes(16).toString("hex");
    const outputPipePath = `/tmp/lldbg_out_${pipeId}`;
    const inputPipePath = `/tmp/lldbg_in_${pipeId}`;
    let pullPipePath = "";
    let debuggerTmpDir = "";
    let outputFd = null;
    let inputFd = null;
    let pullFd = null;
    let inputStream = null;
    let pullStream = null;
    let onErrorCallback = null;
    return {
        open: (onData, onError) => {
            onErrorCallback = onError;
            childProcess.exec(`mkfifo ${outputPipePath}`, fifoErr => {
                if (fifoErr) {
                    onError(`error executing mkfifo for output pipe: ${fifoErr}`);
                    return;
                }
                fs.open(outputPipePath, fs.constants.O_RDWR, (fdErr, fd) => {
                    if (fdErr) {
                        onError(`error opening fifo for output pipe: ${fdErr}`);
                        return;
                    }
                    outputFd = fd;
                    const outputStream = fs.createReadStream(null, { fd });
                    outputStream.on("data", onData);
                });
            });
            childProcess.exec(`mkfifo ${inputPipePath}`, fifoErr => {
                if (fifoErr) {
                    onError(`error executing mkfifo for input pipe: ${fifoErr}`);
                    return;
                }
                fs.open(inputPipePath, fs.constants.O_RDWR, (fdErr, fd) => {
                    if (fdErr) {
                        onError(`error opening fifo for input pipe: ${fdErr}`);
                        return;
                    }
                    inputFd = fd;
                    inputStream = fs.createWriteStream(null, { fd });
                });
            });
        },
        openPull: (onError) => {
            if (!onErrorCallback) {
                onErrorCallback = onError;
            }
            const appPrefix = "lldebugger";
            try {
                debuggerTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), appPrefix));
                pullPipePath = path.join(debuggerTmpDir, "pull.txt");
                const fd = fs.openSync(pullPipePath, fs.constants.O_WRONLY | fs.constants.O_CREAT);
                pullFd = fd;
                pullStream = fs.createWriteStream(null, { fd });
            }
            catch (e) {
                onErrorCallback(e);
            }
        },
        close: () => {
            if (outputFd !== null) {
                fs.close(outputFd);
                outputFd = null;
                fs.rm(outputPipePath, err => {
                    if (err) {
                        onErrorCallback === null || onErrorCallback === void 0 ? void 0 : onErrorCallback(`error removing fifo for output pipe: ${err}`);
                    }
                });
            }
            if (inputFd !== null) {
                fs.close(inputFd);
                inputFd = null;
                fs.rm(inputPipePath, err => {
                    if (err) {
                        onErrorCallback === null || onErrorCallback === void 0 ? void 0 : onErrorCallback(`error removing fifo for input pipe: ${err}`);
                    }
                });
            }
            inputStream = null;
            try {
                if (pullFd !== null) {
                    fs.close(pullFd);
                    fs.rmSync(pullPipePath);
                    pullFd = null;
                }
                pullStream = null;
                if (debuggerTmpDir.length > 0) {
                    fs.rmdirSync(debuggerTmpDir);
                }
            }
            catch (e) {
                onErrorCallback === null || onErrorCallback === void 0 ? void 0 : onErrorCallback(e);
            }
        },
        write: data => {
            inputStream === null || inputStream === void 0 ? void 0 : inputStream.write(data);
        },
        requestPull: () => {
            pullStream === null || pullStream === void 0 ? void 0 : pullStream.write("pull|\n");
        },
        getOutputPipePath: () => outputPipePath,
        getInputPipePath: () => inputPipePath,
        getPullPipePath: () => pullPipePath,
    };
}
exports.createFifoPipe = createFifoPipe;
//# sourceMappingURL=debugPipe.js.map