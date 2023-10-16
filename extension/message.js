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
Object.defineProperty(exports, "__esModule", { value: true });
exports.Message = void 0;
var Message;
(function (Message) {
    function isMessage(obj) {
        return obj !== null && typeof obj !== "undefined" && obj.tag === "$luaDebug";
    }
    const startToken = "@lldbg|";
    const endToken = "|lldbg@";
    function parseMessage(text, position) {
        const firstStart = text.indexOf(startToken, position);
        if (firstStart === -1) {
            return { leadingText: text.substring(position), newPosition: text.length };
        }
        let start = firstStart;
        while (true) {
            const messageStart = start + startToken.length;
            let messageEnd = text.indexOf(endToken, messageStart);
            while (messageEnd >= 0) {
                const possibleMessage = text.substring(messageStart, messageEnd);
                let message;
                try {
                    message = JSON.parse(possibleMessage);
                }
                catch (_a) {
                }
                const end = messageEnd + endToken.length;
                if (isMessage(message)) {
                    return { leadingText: text.substring(position, start), newPosition: end, message };
                }
                messageEnd = text.indexOf(endToken, end);
            }
            start = text.indexOf(startToken, messageStart);
            if (start < 0) {
                break;
            }
        }
        return { leadingText: text.substring(position, firstStart), newPosition: firstStart };
    }
    function parse(text) {
        const messages = [];
        const processed = [];
        let position = 0;
        while (position < text.length) {
            const result = parseMessage(text, position);
            processed.push(result.leadingText);
            position = result.newPosition;
            if (!result.message) {
                break;
            }
            messages.push(result.message);
        }
        return [messages, processed.join(""), text.substring(position)];
    }
    Message.parse = parse;
})(Message = exports.Message || (exports.Message = {}));
//# sourceMappingURL=message.js.map