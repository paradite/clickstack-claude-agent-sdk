/**
 * Demo agent showing how to log full agent trajectory with OpenTelemetry
 *
 * This example shows how to capture:
 * - User prompts
 * - Agent responses
 * - Tool calls (requests and results)
 *
 * Usage:
 *   # Start ClickStack first
 *   ./run.sh
 *
 *   # Run the demo agent
 *   npx tsx demo-agent.ts "Your prompt here"
 *
 *   # Try the calculator tool
 *   npx tsx demo-agent.ts "What is 15 * 7 using the calculator?"
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { logs, SeverityNumber } from "@opentelemetry/api-logs";
import {
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-grpc";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { query, createSdkMcpServer, tool } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// ============================================================================
// OpenTelemetry Setup
// ============================================================================

const SERVICE_NAME = "demo-agent";

/**
 * Initialize OpenTelemetry logger
 * Only initializes if CLAUDE_CODE_ENABLE_TELEMETRY is set
 */
function initTelemetryLogger() {
  if (!process.env.CLAUDE_CODE_ENABLE_TELEMETRY) {
    console.log("[Telemetry] Disabled (set CLAUDE_CODE_ENABLE_TELEMETRY=1 to enable)");
    return null;
  }

  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || "http://localhost:4317";
  console.log(`[Telemetry] Enabled, exporting to ${endpoint}`);

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: SERVICE_NAME,
  });

  // OTLPLogExporter picks up endpoint and headers from env vars
  const logExporter = new OTLPLogExporter();
  const loggerProvider = new LoggerProvider({
    resource,
    processors: [new SimpleLogRecordProcessor(logExporter)],
  });

  logs.setGlobalLoggerProvider(loggerProvider);
  return logs.getLogger(SERVICE_NAME, "1.0.0");
}

const telemetryLogger = initTelemetryLogger();

type MessageRole = "user" | "assistant" | "tool";

interface ToolAttributes {
  callId: string;
  name: string;
  input: unknown;
  result: unknown;
}

/**
 * Log a message to OpenTelemetry with unified schema
 */
function logMessage(
  role: MessageRole,
  content: string,
  sessionId?: string,
  toolAttrs?: ToolAttributes
): void {
  if (!telemetryLogger) return;

  telemetryLogger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: "message",
    attributes: {
      role,
      content,
      ...(sessionId && { "session.id": sessionId }),
      ...(toolAttrs && {
        "tool.call_id": toolAttrs.callId,
        "tool.name": toolAttrs.name,
        "tool.input": JSON.stringify(toolAttrs.input),
        "tool.result": JSON.stringify(toolAttrs.result),
      }),
    },
  });

  const toolInfo = toolAttrs ? ` [${toolAttrs.name}]` : "";
  console.log(`[Telemetry] Logged message (role: ${role}${toolInfo}, session: ${sessionId?.slice(0, 8) || "unknown"})`);
}

// ============================================================================
// Demo Tool Definition (MCP Server)
// ============================================================================

// Track session ID for telemetry (set when session initializes)
let currentSessionId: string | undefined;

/**
 * Create MCP server with calculator tool
 */
// Simple counter for generating tool call IDs
let toolCallCounter = 0;
function generateToolCallId(): string {
  return `${currentSessionId?.slice(0, 8) || "unknown"}-${++toolCallCounter}`;
}

const demoMcpServer = createSdkMcpServer({
  name: "demo-tools",
  version: "1.0.0",
  tools: [
    tool(
      "calculator",
      "A simple calculator that can perform basic arithmetic operations (add, subtract, multiply, divide)",
      {
        operation: z.enum(["add", "subtract", "multiply", "divide"]).describe("The arithmetic operation to perform"),
        a: z.number().describe("The first operand"),
        b: z.number().describe("The second operand"),
      },
      async (args) => {
        const { operation, a, b } = args;
        const toolCallId = generateToolCallId();

        let result: number;
        let output: { result?: number; expression?: string; error?: string };

        switch (operation) {
          case "add":
            result = a + b;
            output = { result, expression: `${a} ${operation} ${b} = ${result}` };
            break;
          case "subtract":
            result = a - b;
            output = { result, expression: `${a} ${operation} ${b} = ${result}` };
            break;
          case "multiply":
            result = a * b;
            output = { result, expression: `${a} ${operation} ${b} = ${result}` };
            break;
          case "divide":
            if (b === 0) {
              output = { error: "Division by zero" };
            } else {
              result = a / b;
              output = { result, expression: `${a} ${operation} ${b} = ${result}` };
            }
            break;
        }

        // Log tool call with input and result
        logMessage("tool", JSON.stringify(output), currentSessionId, {
          callId: toolCallId,
          name: "calculator",
          input: args,
          result: output,
        });

        return { content: [{ type: "text", text: JSON.stringify(output) }] };
      }
    ),
  ],
});

// ============================================================================
// Agent Runner
// ============================================================================

async function runAgent(userPrompt: string) {
  console.log("\n--- Running Agent ---");
  console.log(`Prompt: ${userPrompt}\n`);

  for await (const message of query({
    prompt: userPrompt,
    options: {
      maxTurns: 3, // Allow multiple turns for tool use
      mcpServers: {
        "demo-tools": demoMcpServer,
      },
      allowedTools: ["mcp__demo-tools__calculator"], // Auto-approve calculator tool
    },
  })) {
    // Capture session ID from init message and log prompt
    if (message.type === "system" && message.subtype === "init") {
      currentSessionId = message.session_id;
      console.log(`[Agent] Session: ${message.session_id}`);
      console.log(`[Agent] Model: ${message.model}`);

      // Log user prompt to OpenTelemetry with session ID
      logMessage("user", userPrompt, message.session_id);
    }

    // Display assistant response and log each message
    if (message.type === "assistant" && message.message?.content) {
      let messageText = "";
      for (const block of message.message.content) {
        if ("text" in block) {
          process.stdout.write(block.text);
          messageText += block.text;
        }
      }
      // Log each individual assistant message
      if (messageText) {
        logMessage("assistant", messageText, currentSessionId);
      }
    }

    // Handle result
    if (message.type === "result") {
      console.log("\n\n--- Agent Complete ---");
      if (message.subtype === "success") {
        console.log(`Cost: $${message.total_cost_usd?.toFixed(4) || "N/A"}`);
      } else {
        console.error(`Error: ${message.subtype}`);
      }
    }
  }
}

// ============================================================================
// Main
// ============================================================================

const prompt = process.argv[2];

if (!prompt) {
  console.log("Usage: npx tsx demo-agent.ts \"Your prompt\"");
  console.log("\nExample:");
  console.log("  npx tsx demo-agent.ts \"What is 2+2?\"");
  process.exit(1);
}

runAgent(prompt).catch(console.error);
