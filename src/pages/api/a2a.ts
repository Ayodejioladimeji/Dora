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
    Task // Assuming Task interface is updated in types/a2a.ts
} from "../../types/a2a";

import { chatWithDora, determineDoraIntent } from "@/lib/gemini";
import { generatePdfFromText } from "@/lib/pdf";

// In-memory store (consider persistence like database or Redis for production)
const tasks: Record<string, Task> = {};
const contexts: Record<string, string> = {};

// Define a threshold for what constitutes "large content" for automatic PDF conversion
const PDF_CONTENT_THRESHOLD = 50; // Characters

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
        console.log(`[Webhook] Notification sent successfully for webhook event for task: ${payload.result?.id || 'unknown'}`);
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

        // If there's an existing context, retrieve the associated task
        if (incomingContextId && contexts[incomingContextId]) {
            currentContextId = incomingContextId;
            currentTaskId = contexts[currentContextId];
            task = tasks[currentTaskId];

            if (!task) {
                // This scenario means context exists but task data is gone (e.g., server restart)
                return res.status(404).json({
                    jsonrpc: "2.0",
                    error: { code: -32001, message: "Conversation context found, but task data lost. Please start a new conversation." },
                    id: rpcRequestId,
                });
            }
        } else {
            // No existing context, so create a brand new task for this conversation flow
            currentTaskId = uuidv4();
            currentContextId = uuidv4();

            task = {
                id: currentTaskId,
                contextId: currentContextId,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                state: "submitted", // Initial state when a new conversation starts
                history: [], // Initialize history for this conversation
                // Initialize internalInputData here to satisfy the Task interface requirement
                internalInputData: { type: "chat", data: "" }, // Default empty, will be set below
            };
            tasks[currentTaskId] = task;
            contexts[currentContextId] = currentTaskId;
        }

        // Apply push notification config if provided in the incoming message
        if (pushNotificationConfig) {
            task.webhookConfig = pushNotificationConfig;
        }

        // Add the user's current message to the task history
        const newUserHistoryMessage: HistoryMessage = {
            role: "user",
            parts: incomingMessage.parts as MessagePart[],
            messageId: clientMessageId,
            taskId: currentTaskId,
            contextId: currentContextId,
        };
        task.history.push(newUserHistoryMessage);

        let shouldGeneratePdfAsync: boolean = false;
        let initialAgentResponseText: string;
        const agentMessageId = uuidv4();
        let agentParts: MessagePart[] = [];

        try {
            // Determine Gemini's intent for the user's message
            const geminiIntent = await determineDoraIntent(userMessageText);
            console.log(`[API] Gemini's determined intent: ${geminiIntent}`);

            // --- Core Logic: Decide between Chat and PDF Task ---
            if (userMessageText.length >= PDF_CONTENT_THRESHOLD || geminiIntent === "pdf_conversion") {
                // If content is large, OR Gemini explicitly detects PDF conversion intent (even for small content)
                console.log(`[API] Detected content for PDF conversion (length: ${userMessageText.length}, intent: ${geminiIntent}).`);
                shouldGeneratePdfAsync = true;
                task.internalInputData = { type: "pdf_conversion", data: userMessageText }; // Set task data for PDF

                if (userMessageText.length >= PDF_CONTENT_THRESHOLD) {
                    // Specific response for large content + auto-PDF
                    initialAgentResponseText = await chatWithDora(
                        `The user has sent a substantial amount of content. Acknowledge this, offer to chat about it, and also tell them you're **automatically generating a PDF document** from this content in the background. Mention that the PDF will be delivered shortly via a notification.` +
                        `\n\nUser's Content (for your context, do not repeat fully): "${userMessageText.substring(0, Math.min(userMessageText.length, 200))}..."` // Provide snippet
                    );
                } else {
                    // Standard response for explicit PDF conversion of smaller content
                    initialAgentResponseText = "Certainly! I'm starting to process your content for PDF conversion right away. Please wait a moment while I prepare your document.";
                }
            } else {
                // This is a regular chat message (e.g., "Can you convert to PDF?", "Hello Dora")
                console.log(`[API] Processing as general chat.`);
                task.internalInputData = { type: "chat", data: userMessageText }; // Set task data for chat
                initialAgentResponseText = await chatWithDora(userMessageText);

                // Check if Dora's chat response *then* asks for content for PDF
                const inputRequiredPdfTag = '[INPUT_REQUIRED_PDF_CONTENT]';
                if (initialAgentResponseText.includes(inputRequiredPdfTag)) {
                    // Dora is asking for content, so the conversation transitions to an 'input-required' state
                    const finalAgentResponseText = initialAgentResponseText.replace(inputRequiredPdfTag, '').trim();
                    agentParts = [{ kind: "text", text: finalAgentResponseText, metadata: null }];

                    // Send an immediate synchronous 'message' response that this is 'working' (e.g., "Okay, please paste the content")
                    // This 'message' response immediately updates the UI with Dora's prompt
                    res.status(200).json({
                        jsonrpc: "2.0",
                        id: rpcRequestId,
                        result: {
                            kind: "message", // Sending a message, not a task status directly
                            role: "agent",
                            parts: agentParts,
                            metadata: null,
                            messageId: agentMessageId,
                            taskId: currentTaskId, // Still associate with the main conversation task
                            contextId: currentContextId,
                            status: { state: "working", message: "Awaiting content for PDF conversion", timestamp: new Date().toISOString() },
                        },
                        error: null
                    });

                    // Asynchronously send a 'task' status update via webhook to indicate 'input-required'
                    (async () => {
                        try {
                            task.state = "input-required";
                            task.updatedAt = new Date().toISOString();
                            // Update internal data for the next turn, using the newly allowed type
                            task.internalInputData = { type: "pdf_conversion_awaiting_content", data: "" };

                            const webhookPayload = {
                                jsonrpc: "2.0",
                                id: rpcRequestId,
                                result: {
                                    kind: "task", // This webhook updates the task state
                                    id: currentTaskId,
                                    contextId: currentContextId,
                                    status: { state: task.state, message: "Awaiting content for PDF conversion", timestamp: new Date().toISOString() },
                                    artifacts: null, // No artifacts yet
                                    history: null,
                                    metadata: null,
                                },
                                error: null
                            };
                            if (task.webhookConfig) {
                                await sendWebhookNotification(task.webhookConfig, webhookPayload);
                            }
                        } catch (asyncErr: any) {
                            console.error("[API] Asynchronous webhook update error for 'input-required':", asyncErr.message || asyncErr);
                            // Potentially send a webhook for a 'failed' state if the webhook itself failed
                        }
                    })();
                    return; // Exit to prevent sending a second sync response
                }
            }

            // --- Prepare Synchronous Chat Message Response ---
            // If we reach here, it's either a regular chat response OR an initial response
            // for a PDF conversion that's starting (and will be followed by async PDF delivery).
            agentParts = [{ kind: "text", text: initialAgentResponseText, metadata: null }];
            task.history.push({ role: "agent", parts: agentParts, messageId: agentMessageId, taskId: currentTaskId, contextId: currentContextId, });
            task.lastAgentResponseParts = agentParts;
            task.lastAgentMessageId = agentMessageId;
            task.state = "completed"; // The chat message itself is considered completed

            // --- Asynchronous PDF Generation (if triggered) ---
            if (shouldGeneratePdfAsync && task.internalInputData.data) {
                // Run PDF generation and delivery asynchronously
                (async () => {
                    let pdfAgentParts: MessagePart[] = [];
                    let pdfFinalTaskState: TaskState = "completed"; // Assume success
                    const pdfAgentMessageId = uuidv4(); // Unique message ID for the PDF artifact

                    try {
                        // Call generatePdfFromText with only the textContent argument
                        const pdfDataUri = await generatePdfFromText(task.internalInputData.data as string);

                        const pdfTextResponse = "Your PDF has been successfully generated! Here is your document.";
                        const fileArtifact: MessagePart["file"] = {
                            name: `document-${uuidv4().substring(0, 8)}.pdf`, // A slightly unique name
                            mimeType: "application/pdf",
                            uri: pdfDataUri, // This is the Base64 Data URI
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

                    // Update task history and state with the PDF result
                    task.updatedAt = new Date().toISOString();
                    task.history.push({ role: "agent", parts: pdfAgentParts, messageId: pdfAgentMessageId, taskId: currentTaskId, contextId: currentContextId });

                    // Send the PDF artifact and final task status via webhook
                    if (task.webhookConfig) {
                        const webhookPayload = {
                            jsonrpc: "2.0",
                            id: rpcRequestId, // Use original request ID for webhook correlation
                            result: {
                                kind: "task", // This webhook updates the task state (with the PDF artifact)
                                id: currentTaskId,
                                contextId: currentContextId,
                                status: { state: pdfFinalTaskState, message: null, timestamp: new Date().toISOString() },
                                artifacts: [{ name: null, description: null, parts: pdfAgentParts, metadata: null, index: 0, append: null, lastChunk: null }],
                                history: null,
                                metadata: null,
                            },
                            error: null
                        };
                        await sendWebhookNotification(task.webhookConfig, webhookPayload);
                    }
                })();
            }

            // Return the synchronous chat message response (even if PDF generation is happening concurrently)
            return res.status(200).json({
                jsonrpc: "2.0",
                id: rpcRequestId,
                result: {
                    kind: "message", // The immediate response to the user is always a chat message
                    role: "agent",
                    parts: agentParts,
                    metadata: null,
                    messageId: agentMessageId,
                    taskId: currentTaskId, // Associate message with the ongoing conversation task
                    contextId: currentContextId,
                    status: { state: task.state, message: null, timestamp: new Date().toISOString() },
                },
                error: null
            });

        } catch (err: any) {
            console.error("[API] Overall processing error:", err.message || err);
            const errorMessageId = uuidv4();
            const errorText = `Sorry, I encountered an internal error: ${err.message || "An unexpected error occurred."}`;
            const errorParts: MessagePart[] = [{ kind: "text", text: errorText, metadata: null }];

            // For errors, the current task state should reflect failure
            task.state = "failed";
            task.error = err.message || "Overall processing failed.";
            task.updatedAt = new Date().toISOString();
            task.history.push({ role: "agent", parts: errorParts, messageId: errorMessageId, taskId: currentTaskId, contextId: currentContextId, });
            task.lastAgentResponseParts = errorParts;
            task.lastAgentMessageId = errorMessageId;

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