# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClickStack Claude Agent SDK enables tracing and logging of full agent trajectory for Claude Agent SDK applications:
- **Prompts** - User inputs to the agent
- **Responses** - Assistant outputs and reasoning
- **Tool calls** - Tools invoked by the agent
- **Tool call results** - Outputs returned from tool executions

Uses OpenTelemetry to send telemetry data to ClickHouse via gRPC.

Documentation: https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started

## Commands

```bash
# Run the demo agent with a prompt
npm run demo "Your prompt here"

# Start ClickStack (ClickHouse + OTEL collector)
./run.sh

# Start Telescope log viewer (alternative to HyperDX)
./run-telescope.sh
```

## Architecture

**Single-file CLI agent** (`demo-agent.ts`) with:

1. **OpenTelemetry Setup** - Initializes logger provider with gRPC exporter to ClickHouse
2. **Trajectory Logging** - Captures full agent trajectory (prompts, responses, tool calls, tool results) with session correlation
3. **Agent Runner** - Uses Claude Agent SDK `query()` for agentic reasoning, streams responses
4. **CLI Interface** - Accepts prompt as command-line argument

**Key patterns:**
- Environment-driven configuration (see `.env.example`)
- Telemetry opt-in via `CLAUDE_CODE_ENABLE_TELEMETRY` flag
- `SimpleLogRecordProcessor` for synchronous (unbuffered) log sending
- Session IDs correlate all trajectory events
- Human-readable `body` field with standardized format: `[USER]`, `[ASSISTANT]`, `[TOOL] name | Input: ... | Result: ...`
- Content truncated in body (300 chars for messages, 150 chars for JSON) to prevent log overflow

## Tech Stack

- TypeScript 5.9 with TSX executor (no build step)
- `@anthropic-ai/claude-agent-sdk` for Claude AI integration
- OpenTelemetry SDK for logging (`@opentelemetry/api-logs`, `@opentelemetry/sdk-logs`)
- gRPC exporter for sending logs to ClickHouse
- Node.js >=18.0.0

## Infrastructure

Two deployment options:

**Option 1: All-in-One (`run.sh`)** - Single container, quick start
```bash
./run.sh
```

**Option 2: Docker Compose (`docker-compose/`)** - Separate services, better for debugging
```bash
cd docker-compose && docker compose up -d
```

Both expose the same ports:
- Port 8080: HyperDX UI
- Port 8123: ClickHouse HTTP (for Telescope)
- Port 4317: OTLP gRPC (logs/traces/metrics)
- Port 4318: OTLP HTTP (logs/traces/metrics)

Docker Compose includes a custom OTEL config (`otel-collector/custom-config.yaml`) that enables OTLP receivers - the default HyperDX config defines OTLP but doesn't wire it to pipelines.

Telescope runs via Docker (`run-telescope.sh`):
- Port 9898: Telescope UI

Logs stored in ClickHouse table `default.otel_logs` with 30-day TTL (schema in `docs/otel_logs_schema.sql`).

## Setup

1. Copy `.env.example` to `.env.local`
2. Set `OTEL_EXPORTER_OTLP_HEADERS` with authentication token
3. `npm install`
4. Start ClickStack: `./run.sh`
5. Run: `npm run demo "Your prompt"`
