## Setting up ClickStack

Docs: https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started

```bash
docker run \
  -p 8080:8080 \
  -p 4317:4317 \
  -p 4318:4318 \
  -v "$(pwd)/.volumes/db:/data/db" \
  -v "$(pwd)/.volumes/ch_data:/var/lib/clickhouse" \
  -v "$(pwd)/.volumes/ch_logs:/var/log/clickhouse-server" \
  clickhouse/clickstack-all-in-one:latest
```

## Claude Code config

Docs: https://code.claude.com/docs/en/monitoring-usage

```bash
# 1. Enable telemetry
export CLAUDE_CODE_ENABLE_TELEMETRY=1

# 2. Choose exporters (both are optional - configure only what you need)
export OTEL_METRICS_EXPORTER=otlp       # Options: otlp, prometheus, console
export OTEL_LOGS_EXPORTER=otlp          # Options: otlp, console

# 3. Configure OTLP endpoint (for OTLP exporter)
export OTEL_EXPORTER_OTLP_PROTOCOL=grpc
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317

# 4. Set authentication (if required)
export OTEL_EXPORTER_OTLP_HEADERS="Authorization=Bearer your-token"

# 5. For debugging: reduce export intervals
export OTEL_METRIC_EXPORT_INTERVAL=1000
export OTEL_LOGS_EXPORT_INTERVAL=1000

export OTEL_LOG_USER_PROMPTS=1
# 6. Run Claude Code
claude
```

## Logging Full Agent Trajectory with Claude Agent SDK

Claude Code's built-in telemetry doesn't include user prompts, responses, or tool call details. See `demo-agent.ts` for how to add custom OpenTelemetry logging to capture the full agent trajectory.

### Setup

1. Copy `.env.example` to `.env.local`
2. Set `OTEL_EXPORTER_OTLP_HEADERS` with your auth token (required for logs to be accepted)

```bash
# Install dependencies
npm install

# Run the demo agent (with ClickStack running)
npm run demo "What is 15 * 7 using the calculator?"
```

### Key implementation details

- Uses `@opentelemetry/exporter-logs-otlp-grpc` to send logs via gRPC to port 4317
- `OTEL_EXPORTER_OTLP_HEADERS` must be set for authentication
- `SimpleLogRecordProcessor` sends logs immediately (no flush needed)
- All logs include `session.id` for correlation
- Unified event type: `message` with `role` attribute (user/assistant/tool)

### Querying in ClickHouse

```sql
-- Query all trajectory events for a session
SELECT
  Timestamp,
  LogAttributes['role'] as role,
  LogAttributes['content'] as content,
  LogAttributes['session.id'] as session_id,
  LogAttributes['tool.call_id'] as tool_call_id,
  LogAttributes['tool.name'] as tool_name,
  LogAttributes['tool.input'] as tool_input,
  LogAttributes['tool.result'] as tool_result
FROM otel_logs
WHERE ServiceName = 'demo-agent'
ORDER BY Timestamp DESC;

-- Query by role
SELECT
  Timestamp,
  LogAttributes['content'] as content,
  LogAttributes['session.id'] as session_id
FROM otel_logs
WHERE ServiceName = 'demo-agent'
  AND LogAttributes['role'] = 'assistant'
ORDER BY Timestamp DESC;

-- Query tool calls only
SELECT
  Timestamp,
  LogAttributes['session.id'] as session_id,
  LogAttributes['tool.call_id'] as tool_call_id,
  LogAttributes['tool.name'] as tool_name,
  LogAttributes['tool.input'] as tool_input,
  LogAttributes['tool.result'] as tool_result
FROM otel_logs
WHERE ServiceName = 'demo-agent'
  AND LogAttributes['role'] = 'tool'
ORDER BY Timestamp DESC;
```

## Captured fields (not in Claude Code built-in telemetry)

Unified `message` event with attributes:
- `role` - `user`, `assistant`, or `tool`
- `content` - message content
- `session.id` - session ID for correlation
- `tool.call_id`, `tool.name`, `tool.input`, `tool.result` - (tool role only)
