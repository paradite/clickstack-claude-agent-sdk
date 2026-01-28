/**
 * Demo agent showing how to log user prompts with OpenTelemetry
 *
 * This example shows how to capture user prompts that Claude Code's
 * built-in telemetry doesn't include.
 *
 * Usage:
 *   # Start ClickStack first
 *   ./run.sh
 *
 *   # Run the demo agent
 *   npx tsx demo-agent.ts "Your prompt here"
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
import { query } from "@anthropic-ai/claude-agent-sdk";

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

/**
 * Log user prompt to OpenTelemetry
 */
function logUserPrompt(prompt: string, sessionId?: string): void {
  if (!telemetryLogger) return;

  telemetryLogger.emit({
    severityNumber: SeverityNumber.INFO,
    severityText: "INFO",
    body: "user_prompt",
    attributes: {
      "prompt.content": prompt,
      ...(sessionId && { "session.id": sessionId }),
    },
  });

  console.log(`[Telemetry] Logged user_prompt (session: ${sessionId?.slice(0, 8) || "unknown"})`);
}

// ============================================================================
// Agent Runner
// ============================================================================

async function runAgent(userPrompt: string) {
  console.log("\n--- Running Agent ---");
  console.log(`Prompt: ${userPrompt}\n`);

  for await (const message of query({
    prompt: userPrompt,
    options: {
      maxTurns: 1, // Keep it simple for demo
    },
  })) {
    // Capture session ID from init message and log prompt
    if (message.type === "system" && message.subtype === "init") {
      console.log(`[Agent] Session: ${message.session_id}`);
      console.log(`[Agent] Model: ${message.model}`);

      // Log user prompt to OpenTelemetry with session ID
      logUserPrompt(userPrompt, message.session_id);
    }

    // Display assistant response
    if (message.type === "assistant" && message.message?.content) {
      for (const block of message.message.content) {
        if ("text" in block) {
          process.stdout.write(block.text);
        }
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
