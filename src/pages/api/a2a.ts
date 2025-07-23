// import type { NextApiRequest, NextApiResponse } from "next";
// import { v4 as uuidv4 } from "uuid";
// import Cors from 'cors';
// import axios from "axios";

// import {
//     JSONRPCError,
//     MessagePart,
//     HistoryMessage,
//     TaskState,
//     PushNotificationConfig,
//     Task
// } from "../../types/a2a";

// import { chatWithDora, determineDoraIntent } from "@/lib/gemini";
// import { generatePdfFromText } from "@/lib/pdf";

// // In-memory store (consider persistence like database or Redis for production)
// const tasks: Record<string, Task> = {};
// const contexts: Record<string, string> = {};

// const cors = Cors({
//     origin: [
//         "http://localhost:3000",
//         "http://localhost:3001",
//         "http://localhost:3002",
//         "https://telex.im",
//         "https://staging.telex.im",
//         "https://telex-auth.vercel.app",
//     ],
//     methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
//     allowedHeaders: ["Content-Type", "Authorization", "X-TELEX-API-KEY"],
//     credentials: true,
// });

// function runMiddleware(req: NextApiRequest, res: NextApiResponse, fn: any) {
//     return new Promise((resolve, reject) => {
//         fn(req, res, (result: any) => {
//             if (result instanceof Error) {
//                 return reject(result);
//             }
//             return resolve(result);
//         });
//     });
// }

// async function sendWebhookNotification(
//     webhookConfig: PushNotificationConfig,
//     payload: any
// ) {
//     try {
//         console.log(`[Webhook] Sending notification to: ${webhookConfig.url}`);
//         await axios.post(webhookConfig.url, payload, {
//             headers: {
//                 "Content-Type": "application/json",
//                 "X-TELEX-API-KEY": webhookConfig.authentication.credentials,
//             },
//             timeout: 15000
//         });
//         console.log(`[Webhook] Notification sent successfully for task: ${payload.result?.id || 'unknown'}`);
//     } catch (err: any) {
//         console.error(`[Webhook] Failed to send notification to ${webhookConfig.url} for task ${payload.result?.id || 'unknown'}:`,
//             err.response?.data || err.message || err);
//     }
// }

// export default async function handler(req: NextApiRequest, res: NextApiResponse) {
//     const { method } = req;

//     if (method === "OPTIONS") {
//         await runMiddleware(req, res, cors);
//         return res.status(200).end();
//     }

//     if (method !== "POST") {
//         return res.status(405).json({
//             jsonrpc: "2.0",
//             error: { code: -32601, message: "Method not found" },
//             id: null,
//         });
//     }

//     await runMiddleware(req, res, cors);

//     const { jsonrpc, method: rpcMethod, params, id: rpcRequestId } = req.body;

//     if (jsonrpc !== "2.0") {
//         return res.status(400).json({
//             jsonrpc: "2.0",
//             error: { code: -32600, message: "Invalid JSON-RPC version. Must be 2.0." },
//             id: rpcRequestId,
//         });
//     }

//     if (rpcMethod === "message/send") {
//         const clientMessageId = params?.message?.messageId || uuidv4();
//         const incomingMessage = params?.message;
//         const incomingContextId = params?.message?.contextId;
//         const pushNotificationConfig: PushNotificationConfig | undefined = params?.configuration?.pushNotificationConfig;

//         if (!incomingMessage || !Array.isArray(incomingMessage.parts) || incomingMessage.parts.length === 0) {
//             return res.status(400).json({
//                 jsonrpc: "2.0",
//                 error: { code: -32602, message: "Missing or invalid 'message.parts'." },
//                 id: rpcRequestId,
//             });
//         }
//         const userMessageTextPart = incomingMessage.parts.find((p: any) => p.kind === "text");
//         const userMessageText = userMessageTextPart?.text;

//         if (!userMessageText || typeof userMessageText !== 'string') {
//             return res.status(400).json({
//                 jsonrpc: "2.0",
//                 error: { code: -32602, message: "Missing or invalid text content in message parts." },
//                 id: rpcRequestId,
//             });
//         }

//         let task: Task;
//         let currentTaskId: string;
//         let currentContextId: string;

//         if (incomingContextId && contexts[incomingContextId]) {
//             currentContextId = incomingContextId;
//             currentTaskId = contexts[currentContextId];
//             task = tasks[currentTaskId];

//             if (!task) {
//                 return res.status(404).json({
//                     jsonrpc: "2.0",
//                     error: { code: -32001, message: "Conversation context found, but task data lost. Please start a new conversation." },
//                     id: rpcRequestId,
//                 });
//             }
//         } else {
//             currentTaskId = uuidv4();
//             currentContextId = uuidv4();

//             task = {
//                 id: currentTaskId,
//                 contextId: currentContextId,
//                 createdAt: new Date().toISOString(),
//                 updatedAt: new Date().toISOString(),
//                 state: "submitted",
//                 history: [],
//                 internalInputData: { type: "chat", data: userMessageText },
//             };
//             tasks[currentTaskId] = task;
//             contexts[currentContextId] = currentTaskId;
//         }

//         if (pushNotificationConfig) {
//             task.webhookConfig = pushNotificationConfig;
//         }

//         const newUserHistoryMessage: HistoryMessage = {
//             role: "user",
//             parts: incomingMessage.parts as MessagePart[],
//             messageId: clientMessageId,
//             taskId: currentTaskId,
//             contextId: currentContextId,
//         };
//         task.history.push(newUserHistoryMessage);
//         task.internalInputData.data = userMessageText;

//         const geminiIntent = await determineDoraIntent(userMessageText);

//         if (geminiIntent === "chat") {
//             try {
//                 const agentResponseText = await chatWithDora(userMessageText);
//                 const inputRequiredPdfTag = '[INPUT_REQUIRED_PDF_CONTENT]';

//                 if (agentResponseText.includes(inputRequiredPdfTag)) {
//                     const finalAgentResponseText = agentResponseText.replace(inputRequiredPdfTag, '').trim();
//                     const agentMessageId = uuidv4();
//                     const agentParts: MessagePart[] = [{ kind: "text", text: finalAgentResponseText, metadata: null }];

//                     task.state = "working";
//                     task.internalInputData.type = "pdf_conversion"; // Intent is now PDF, even if chat started it
//                     task.lastAgentResponseParts = agentParts;
//                     task.lastAgentMessageId = agentMessageId;
//                     task.updatedAt = new Date().toISOString();

//                     (async () => {
//                         try {
//                             task.state = "input-required";
//                             task.updatedAt = new Date().toISOString();
//                             const finalResultPayload = {
//                                 kind: "task",
//                                 id: currentTaskId,
//                                 contextId: currentContextId,
//                                 status: { state: task.state, message: null, timestamp: new Date().toISOString() },
//                                 artifacts: [{ name: null, description: null, parts: agentParts, metadata: null, index: 0, append: null, lastChunk: null }],
//                                 history: null, metadata: null,
//                             };
//                             if (task.webhookConfig) {
//                                 await sendWebhookNotification(task.webhookConfig, { jsonrpc: "2.0", id: rpcRequestId, result: finalResultPayload, error: null });
//                             }
//                         } catch (asyncErr: any) {
//                             console.error("[API] Asynchronous chat task error:", asyncErr.message || asyncErr);
//                             task.state = "failed"; task.error = asyncErr.message || "An unexpected error occurred during chat task processing."; task.updatedAt = new Date().toISOString();
//                             const errorParts: MessagePart[] = [{ kind: "text", text: `Sorry, an internal error occurred for this chat task: ${task.error}`, metadata: null }];
//                             task.lastAgentResponseParts = errorParts; task.lastAgentMessageId = uuidv4();
//                             if (task.webhookConfig) {
//                                 await sendWebhookNotification(task.webhookConfig, { jsonrpc: "2.0", id: rpcRequestId, result: { kind: "task", id: currentTaskId, contextId: currentContextId, status: { state: "failed", message: null, timestamp: new Date().toISOString() }, artifacts: [{ name: null, description: null, parts: errorParts, metadata: null, index: 0, append: null, lastChunk: null }], history: null, metadata: null, }, error: null });
//                             }
//                         }
//                     })();

//                     return res.status(200).json({
//                         jsonrpc: "2.0", id: rpcRequestId, result: { kind: "task", id: currentTaskId, contextId: currentContextId, status: { state: "working", message: null, timestamp: new Date().toISOString(), }, artifacts: null, history: null, metadata: null, }, error: null
//                     });

//                 } else {
//                     task.state = "completed"; task.updatedAt = new Date().toISOString();
//                     const agentMessageId = uuidv4();
//                     const agentParts: MessagePart[] = [{ kind: "text", text: agentResponseText, metadata: null }];
//                     task.history.push({ role: "agent", parts: agentParts, messageId: agentMessageId, taskId: currentTaskId, contextId: currentContextId, });
//                     task.lastAgentResponseParts = agentParts; task.lastAgentMessageId = agentMessageId;

//                     return res.status(200).json({
//                         jsonrpc: "2.0", id: rpcRequestId, result: { kind: "message", role: "agent", parts: agentParts, metadata: null, messageId: agentMessageId, taskId: currentTaskId, contextId: currentContextId, status: { state: "completed", message: null, timestamp: new Date().toISOString(), }, }, error: null
//                     });
//                 }
//             } catch (err: any) {
//                 console.error("[API] Synchronous chat processing error:", err.message || err);
//                 const errorMessageId = uuidv4();
//                 const errorText = `Sorry, I couldn't process your chat request right now: ${err.message || "An unexpected error occurred."}`;
//                 const errorParts: MessagePart[] = [{ kind: "text", text: errorText, metadata: null }];
//                 task.state = "failed"; task.error = err.message || "Synchronous chat processing failed."; task.updatedAt = new Date().toISOString();
//                 task.history.push({ role: "agent", parts: errorParts, messageId: errorMessageId, taskId: currentTaskId, contextId: currentContextId, });
//                 task.lastAgentResponseParts = errorParts; task.lastAgentMessageId = errorMessageId;

//                 return res.status(200).json({
//                     jsonrpc: "2.0", id: rpcRequestId, result: { kind: "message", role: "agent", parts: errorParts, metadata: null, messageId: errorMessageId, taskId: currentTaskId, contextId: currentContextId, status: { state: "failed", message: null, timestamp: new Date().toISOString(), }, }, error: null
//                 });
//             }
//         } else if (geminiIntent === "pdf_conversion") {
//             task.state = "working";
//             task.updatedAt = new Date().toISOString();
//             task.internalInputData.type = "pdf_conversion";
//             // Gemini is expected to provide content in the input text for conversion here
//             task.internalInputData.data = userMessageText;

//             (async () => {
//                 let agentResponseText: string = "";
//                 let finalTaskState: TaskState = "completed";
//                 const agentMessageId = uuidv4();
//                 let agentParts: MessagePart[] = [];
//                 let fileArtifact: MessagePart["file"] | undefined = undefined;

//                 try {
//                     const pdfUri = await generatePdfFromText(task.internalInputData.data as string);
//                     agentResponseText = "Your PDF has been successfully generated!";
//                     fileArtifact = {
//                         name: "document.pdf",
//                         mimeType: "application/pdf",
//                         uri: pdfUri,
//                     };
//                     finalTaskState = "completed";

//                     agentParts = [{ kind: "text", text: agentResponseText, metadata: null }];
//                     if (fileArtifact) {
//                         agentParts.push({ kind: "file", file: fileArtifact });
//                     }
//                 } catch (asyncErr: any) {
//                     console.error(`[API] Error processing PDF conversion task:`, asyncErr.message || asyncErr);
//                     agentResponseText = `Sorry, I encountered an error while generating your PDF: ${asyncErr.message || "An unexpected error occurred."}`;
//                     finalTaskState = "failed";
//                     agentParts = [{ kind: "text", text: agentResponseText, metadata: null }];
//                 }

//                 task.state = finalTaskState;
//                 task.updatedAt = new Date().toISOString();
//                 task.history.push({ role: "agent", parts: agentParts, messageId: agentMessageId, taskId: currentTaskId, contextId: currentContextId, });
//                 task.lastAgentResponseParts = agentParts;
//                 task.lastAgentMessageId = agentMessageId;

//                 if (task.webhookConfig) {
//                     const webhookPayload = {
//                         jsonrpc: "2.0",
//                         id: rpcRequestId,
//                         result: {
//                             kind: "task",
//                             id: currentTaskId,
//                             contextId: currentContextId,
//                             status: { state: task.state, message: null, timestamp: new Date().toISOString(), },
//                             artifacts: [{ name: null, description: null, parts: agentParts, metadata: null, index: 0, append: null, lastChunk: null }],
//                             history: null, metadata: null,
//                         },
//                         error: null
//                     };
//                     await sendWebhookNotification(task.webhookConfig, webhookPayload);
//                 }
//             })();

//             return res.status(200).json({
//                 jsonrpc: "2.0", id: rpcRequestId, result: { kind: "task", id: currentTaskId, contextId: currentContextId, status: { state: "working", message: null, timestamp: new Date().toISOString(), }, artifacts: null, history: null, metadata: null, }, error: null
//             });
//         }
//     }

//     return res.status(400).json({
//         jsonrpc: "2.0",
//         error: { code: -32601, message: "Method not found" },
//         id: rpcRequestId,
//     });
// }


import type { NextApiRequest, NextApiResponse } from "next";
import { v4 as uuidv4 } from "uuid";
import Cors from 'cors';
import axios from "axios";

import {
    JSONRPCError,
    MessagePart,
    HistoryMessage,
    TaskState,
    PushNotificationConfig,
    Task
} from "../../types/a2a"; // Ensure this path is correct relative to a2a.ts

import { chatWithDora, determineDoraIntent } from "@/lib/gemini"; // Ensure this path is correct
import { generatePdfFromText } from "@/lib/pdf"; // Ensure this path is correct

// In-memory store (consider persistence like database or Redis for production)
const tasks: Record<string, Task> = {};
const contexts: Record<string, string> = {};

// Define a threshold for what constitutes "large content" for automatic PDF conversion
// This is an arbitrary value; adjust based on what you consider "large"
const PDF_CONTENT_THRESHOLD = 300; // Characters

const cors = Cors({
    origin: [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "https://telex.im",
        "https://staging.telex.im",
        "https://telex-auth.vercel.app",
    ],
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    allowedHeaders: ["Content-Type", "Authorization", "X-TELEX-API-KEY"],
    credentials: true,
});

function runMiddleware(req: NextApiRequest, res: NextApiResponse, fn: any) {
    return new Promise((resolve, reject) => {
        fn(req, res, (result: any) => {
            if (result instanceof Error) {
                return reject(result);
            }
            return resolve(result);
        });
    });
}

async function sendWebhookNotification(
    webhookConfig: PushNotificationConfig,
    payload: any
) {
    try {
        console.log(`[Webhook] Sending notification to: ${webhookConfig.url}`);
        await axios.post(webhookConfig.url, payload, {
            headers: {
                "Content-Type": "application/json",
                "X-TELEX-API-KEY": webhookConfig.authentication.credentials,
            },
            timeout: 15000
        });
        console.log(`[Webhook] Notification sent successfully for task: ${payload.result?.id || 'unknown'}`);
    } catch (err: any) {
        console.error(`[Webhook] Failed to send notification to ${webhookConfig.url} for task ${payload.result?.id || 'unknown'}:`,
            err.response?.data || err.message || err);
    }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { method } = req;

    if (method === "OPTIONS") {
        await runMiddleware(req, res, cors);
        return res.status(200).end();
    }

    if (method !== "POST") {
        return res.status(405).json({
            jsonrpc: "2.0",
            error: { code: -32601, message: "Method not found" },
            id: null,
        });
    }

    await runMiddleware(req, res, cors);

    const { jsonrpc, method: rpcMethod, params, id: rpcRequestId } = req.body;

    if (jsonrpc !== "2.0") {
        return res.status(400).json({
            jsonrpc: "2.0",
            error: { code: -32600, message: "Invalid JSON-RPC version. Must be 2.0." },
            id: rpcRequestId,
        });
    }

    if (rpcMethod === "message/send") {
        const clientMessageId = params?.message?.messageId || uuidv4();
        const incomingMessage = params?.message;
        const incomingContextId = params?.message?.contextId;
        const pushNotificationConfig: PushNotificationConfig | undefined = params?.configuration?.pushNotificationConfig;

        if (!incomingMessage || !Array.isArray(incomingMessage.parts) || incomingMessage.parts.length === 0) {
            return res.status(400).json({
                jsonrpc: "2.0",
                error: { code: -32602, message: "Missing or invalid 'message.parts'." },
                id: rpcRequestId,
            });
        }
        const userMessageTextPart = incomingMessage.parts.find((p: any) => p.kind === "text");
        const userMessageText = userMessageTextPart?.text;

        if (!userMessageText || typeof userMessageText !== 'string') {
            return res.status(400).json({
                jsonrpc: "2.0",
                error: { code: -32602, message: "Missing or invalid text content in message parts." },
                id: rpcRequestId,
            });
        }

        let task: Task;
        let currentTaskId: string;
        let currentContextId: string;

        if (incomingContextId && contexts[incomingContextId]) {
            currentContextId = incomingContextId;
            currentTaskId = contexts[currentContextId];
            task = tasks[currentTaskId];

            if (!task) {
                return res.status(404).json({
                    jsonrpc: "2.0",
                    error: { code: -32001, message: "Conversation context found, but task data lost. Please start a new conversation." },
                    id: rpcRequestId,
                });
            }
        } else {
            currentTaskId = uuidv4();
            currentContextId = uuidv4();

            task = {
                id: currentTaskId,
                contextId: currentContextId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                state: "submitted",
                history: [], // History is crucial, so always initialize it
                internalInputData: { type: "chat", data: userMessageText }, // Default to chat, updated below
            };
            tasks[currentTaskId] = task;
            contexts[currentContextId] = currentTaskId;
        }

        if (pushNotificationConfig) {
            task.webhookConfig = pushNotificationConfig;
        }

        const newUserHistoryMessage: HistoryMessage = {
            role: "user",
            parts: incomingMessage.parts as MessagePart[],
            messageId: clientMessageId,
            taskId: currentTaskId,
            contextId: currentContextId,
        };
        task.history.push(newUserHistoryMessage);
        // task.internalInputData.data is already set during task creation for simplicity
        // It holds the user's current message, which is what we might convert to PDF.

        let shouldGeneratePdfAsync: boolean = false;
        let initialAgentResponseText: string;
        const agentMessageId = uuidv4();
        let agentParts: MessagePart[] = [];

        try {
            // First, determine if a PDF conversion should be initiated due to large content
            if (userMessageText.length > PDF_CONTENT_THRESHOLD) {
                console.log(`[API] Detected large content (${userMessageText.length} chars). Initiating PDF conversion in background.`);
                shouldGeneratePdfAsync = true;
                // For large content, Dora should still provide a chat response acknowledging
                // the content and informing about the PDF creation.
                initialAgentResponseText = await chatWithDora(
                    `The user has sent a large amount of content. Acknowledge this, offer to chat about it, and also tell them you're automatically converting it to PDF.` +
                    `\n\nUser's Content (for context, do not repeat fully): "${userMessageText.substring(0, 100)}..."` // Provide snippet for context
                );
                // Ensure the chat model knows to provide a chat response for large content
                // and a separate PDF conversion is happening.
                task.internalInputData.type = "pdf_conversion"; // Set the task type to PDF for internal tracking
                task.internalInputData.data = userMessageText; // Store the full content for PDF generation

            } else {
                // For smaller content, use Gemini's intent detection
                const geminiIntent = await determineDoraIntent(userMessageText);
                console.log(`[API] Gemini determined intent for small content: ${geminiIntent}`);

                if (geminiIntent === "pdf_conversion") {
                    // If Gemini explicitly says it's a PDF request, initiate PDF conversion
                    shouldGeneratePdfAsync = true;
                    initialAgentResponseText = "Certainly! I'm starting to process your content for PDF conversion right away. Please wait a moment while I prepare your document.";
                    task.internalInputData.type = "pdf_conversion";
                    task.internalInputData.data = userMessageText;
                } else {
                    // Otherwise, it's a regular chat
                    initialAgentResponseText = await chatWithDora(userMessageText);
                    task.internalInputData.type = "chat";
                    task.internalInputData.data = userMessageText;
                }
            }

            // Check if Dora's chat response indicates a need for more input for PDF
            const inputRequiredPdfTag = '[INPUT_REQUIRED_PDF_CONTENT]';
            if (initialAgentResponseText.includes(inputRequiredPdfTag)) {
                // If Dora asks for more content even after initial intent, it implies a waiting state
                const finalAgentResponseText = initialAgentResponseText.replace(inputRequiredPdfTag, '').trim();
                agentParts = [{ kind: "text", text: finalAgentResponseText, metadata: null }];

                task.state = "working"; // Immediate sync response
                task.updatedAt = new Date().toISOString();
                task.lastAgentResponseParts = agentParts;
                task.lastAgentMessageId = agentMessageId;

                // Async transition to 'input-required' via webhook
                (async () => {
                    task.state = "input-required";
                    task.updatedAt = new Date().toISOString();
                    const finalResultPayload = {
                        kind: "task",
                        id: currentTaskId,
                        contextId: currentContextId,
                        status: { state: task.state, message: null, timestamp: new Date().toISOString() },
                        artifacts: [{ name: null, description: null, parts: agentParts, metadata: null, index: 0, append: null, lastChunk: null }],
                        history: null, metadata: null,
                    };
                    if (task.webhookConfig) {
                        await sendWebhookNotification(task.webhookConfig, { jsonrpc: "2.0", id: rpcRequestId, result: finalResultPayload, error: null });
                    }
                })();

                return res.status(200).json({
                    jsonrpc: "2.0", id: rpcRequestId, result: { kind: "task", id: currentTaskId, contextId: currentContextId, status: { state: "working", message: null, timestamp: new Date().toISOString(), }, artifacts: null, history: null, metadata: null, }, error: null
                });

            } else {
                // Prepare synchronous response (chat message)
                agentParts = [{ kind: "text", text: initialAgentResponseText, metadata: null }];
                task.history.push({ role: "agent", parts: agentParts, messageId: agentMessageId, taskId: currentTaskId, contextId: currentContextId, });
                task.lastAgentResponseParts = agentParts;
                task.lastAgentMessageId = agentMessageId;
                task.state = "completed"; // Chat is immediately completed

                // If PDF generation is needed, run it asynchronously and send via webhook
                if (shouldGeneratePdfAsync) {
                    (async () => {
                        let pdfAgentParts: MessagePart[] = [];
                        let pdfFinalTaskState: TaskState = "completed";
                        const pdfAgentMessageId = uuidv4(); // New message ID for the PDF artifact

                        try {
                            const pdfUri = await generatePdfFromText(task.internalInputData.data as string);
                            const pdfTextResponse = "Your PDF has been successfully generated! Here is your document.";
                            const fileArtifact: MessagePart["file"] = {
                                name: "document.pdf",
                                mimeType: "application/pdf",
                                uri: pdfUri,
                            };
                            pdfAgentParts.push({ kind: "text", text: pdfTextResponse, metadata: null });
                            pdfAgentParts.push({ kind: "file", file: fileArtifact });

                            pdfFinalTaskState = "completed";
                            console.log(`[API] PDF generated and ready to send for task ${currentTaskId}`);

                        } catch (pdfErr: any) {
                            console.error(`[API] Error generating PDF for task ${currentTaskId}:`, pdfErr.message || pdfErr);
                            const errorText = `Sorry, I encountered an error while generating your PDF: ${pdfErr.message || "An unexpected error occurred."}`;
                            pdfAgentParts = [{ kind: "text", text: errorText, metadata: null }];
                            pdfFinalTaskState = "failed";
                        }

                        // Update task state and history for the asynchronous PDF result
                        // Note: This updates the shared 'task' object, but the sync response already went out.
                        // The client relies on the webhook for this update.
                        task.updatedAt = new Date().toISOString();
                        task.history.push({ role: "agent", parts: pdfAgentParts, messageId: pdfAgentMessageId, taskId: currentTaskId, contextId: currentContextId });

                        if (task.webhookConfig) {
                            const webhookPayload = {
                                jsonrpc: "2.0",
                                id: rpcRequestId, // Use original request ID or generate a new one if preferred for webhook correlation
                                result: {
                                    kind: "task",
                                    id: currentTaskId,
                                    contextId: currentContextId,
                                    status: { state: pdfFinalTaskState, message: null, timestamp: new Date().toISOString() },
                                    artifacts: [{ name: null, description: null, parts: pdfAgentParts, metadata: null, index: 0, append: null, lastChunk: null }],
                                    history: null, metadata: null, // History is usually sent in full if this is a "task-complete" update
                                },
                                error: null
                            };
                            await sendWebhookNotification(task.webhookConfig, webhookPayload);
                        }
                    })();
                }

                // Return synchronous chat message response
                return res.status(200).json({
                    jsonrpc: "2.0",
                    id: rpcRequestId,
                    result: {
                        kind: "message",
                        role: "agent",
                        parts: agentParts,
                        metadata: null,
                        messageId: agentMessageId,
                        taskId: currentTaskId,
                        contextId: currentContextId,
                        status: { state: task.state, message: null, timestamp: new Date().toISOString() },
                    },
                    error: null
                });
            }
        } catch (err: any) {
            console.error("[API] Overall processing error:", err.message || err);
            const errorMessageId = uuidv4();
            const errorText = `Sorry, I encountered an internal error: ${err.message || "An unexpected error occurred."}`;
            const errorParts: MessagePart[] = [{ kind: "text", text: errorText, metadata: null }];
            task.state = "failed"; task.error = err.message || "Overall processing failed."; task.updatedAt = new Date().toISOString();
            task.history.push({ role: "agent", parts: errorParts, messageId: errorMessageId, taskId: currentTaskId, contextId: currentContextId, });
            task.lastAgentResponseParts = errorParts; task.lastAgentMessageId = errorMessageId;

            return res.status(200).json({
                jsonrpc: "2.0", id: rpcRequestId, result: { kind: "message", role: "agent", parts: errorParts, metadata: null, messageId: errorMessageId, taskId: currentTaskId, contextId: currentContextId, status: { state: "failed", message: null, timestamp: new Date().toISOString(), }, }, error: null
            });
        }
    }

    return res.status(400).json({
        jsonrpc: "2.0",
        error: { code: -32601, message: "Method not found" },
        id: rpcRequestId,
    });
}