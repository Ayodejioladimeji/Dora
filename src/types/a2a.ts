export interface JSONRPCError {
    code: number;
    message: string;
    data?: any;
}

export interface MessagePart {
    kind: "text" | "file";
    text?: string;
    file?: {
        name: string;
        mimeType: string;
        uri: string;
    };
    metadata?: any;
}

export interface HistoryMessage {
    role: "user" | "agent";
    parts: MessagePart[];
    messageId: string;
    taskId: string;
    contextId: string;
}

export type TaskState = "submitted" | "working" | "input-required" | "completed" | "failed";

export interface PushNotificationConfig {
    url: string;
    token: string | null;
    authentication: {
        schemes: string[];
        credentials: string;
    };
}

export type Task = {
    id: string;
    contextId: string;
    createdAt: string;
    updatedAt: string;
    state: TaskState;
    error?: string;
    // ADDED: The history property was missing from the Task type definition
    history: HistoryMessage[];
    internalInputData: {
        type: "chat" | "pdf_conversion";
        data: string;
    };
    lastAgentResponseParts?: MessagePart[];
    lastAgentMessageId?: string;
    webhookConfig?: PushNotificationConfig;
};