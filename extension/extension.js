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
exports.deactivate = exports.activate = void 0;
const vscode = require("vscode");
const Net = require("net");
const path = require("path");
const luaDebugSession_1 = require("./luaDebugSession");
const launchConfig_1 = require("./launchConfig");
const enableServer = true;
const debuggerType = "lua-local";
const interpreterSetting = `${debuggerType}.interpreter`;
function abortLaunch(message) {
    void vscode.window.showErrorMessage(message);
    // tslint:disable-next-line:no-null-keyword
    return null;
}
const configurationProvider = {
    resolveDebugConfiguration(folder, config, token) {
        var _a;
        return __awaiter(this, void 0, void 0, function* () {
            //Validate config
            const editor = vscode.window.activeTextEditor;
            if (typeof config.request === "undefined" || typeof config.type === "undefined") {
                if (typeof editor === "undefined" || editor.document.languageId !== "lua" || editor.document.isUntitled) {
                    return abortLaunch("Nothing to debug");
                }
                config.request = "launch";
                config.type = debuggerType;
            }
            if (typeof config.program === "undefined" || !(0, launchConfig_1.isCustomProgramConfig)(config.program)) {
                const luaConfig = (_a = config.program) !== null && _a !== void 0 ? _a : {};
                if (typeof luaConfig.lua === "undefined") {
                    const luaBin = vscode.workspace.getConfiguration().get(interpreterSetting);
                    if (typeof luaBin === "undefined" || luaBin.length === 0) {
                        return abortLaunch(`You must set "${interpreterSetting}" in your settings, or "program.lua" `
                            + "in your launch.json, to debug with a lua interpreter.");
                    }
                    luaConfig.lua = luaBin;
                }
                if (typeof luaConfig.file === "undefined") {
                    if (typeof editor === "undefined"
                        || editor.document.languageId !== "lua"
                        || editor.document.isUntitled) {
                        return abortLaunch("'program.file' not set in launch.json");
                    }
                    luaConfig.file = editor.document.uri.fsPath;
                }
                config.program = luaConfig;
            }
            if (Array.isArray(config.scriptFiles)) {
                const nonString = config.scriptFiles.find(p => typeof p !== "string");
                if (typeof nonString !== "undefined") {
                    return abortLaunch(`invalid value in scriptFiles: "${nonString}"`);
                }
                else {
                    const uris = yield Promise.all(config.scriptFiles.map(p => vscode.workspace.findFiles(path.normalize(p))));
                    config.scriptFiles = uris.flatMap(u => u.map(uri => uri.fsPath));
                }
            }
            //Pass paths to debugger
            if (typeof folder !== "undefined") {
                config.workspacePath = folder.uri.fsPath;
            }
            else if (typeof vscode.window.activeTextEditor !== "undefined") {
                config.workspacePath = path.dirname(vscode.window.activeTextEditor.document.uri.fsPath);
            }
            else {
                return abortLaunch("No path for debugger");
            }
            const extension = vscode.extensions.getExtension("tomblind.local-lua-debugger-vscode");
            if (typeof extension === "undefined") {
                return abortLaunch("Failed to find extension path");
            }
            config.extensionPath = extension.extensionPath;
            if (typeof config.cwd === "undefined") {
                config.cwd = config.workspacePath;
            }
            return config;
        });
    }
};
let debugAdapaterDescriptorFactory;
// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
if (enableServer) {
    let server = null;
    debugAdapaterDescriptorFactory = {
        createDebugAdapterDescriptor(session, executable) {
            if (server === null) {
                server = Net.createServer(socket => {
                    const debugSession = new luaDebugSession_1.LuaDebugSession();
                    debugSession.setRunAsServer(true);
                    debugSession.start(socket, socket);
                }).listen(0);
            }
            return new vscode.DebugAdapterServer(server.address().port);
        },
        dispose() {
            if (server !== null) {
                server.close();
                server = null;
            }
        }
    };
}
function activate(context) {
    context.subscriptions.push(vscode.debug.registerDebugConfigurationProvider(debuggerType, configurationProvider));
    if (typeof debugAdapaterDescriptorFactory !== "undefined") {
        context.subscriptions.push(vscode.debug.registerDebugAdapterDescriptorFactory(debuggerType, debugAdapaterDescriptorFactory));
        context.subscriptions.push(debugAdapaterDescriptorFactory);
    }
}
exports.activate = activate;
function deactivate() {
}
exports.deactivate = deactivate;
//# sourceMappingURL=extension.js.map