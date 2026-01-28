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

## Logging User Prompts with Claude Agent SDK

Claude Code's built-in telemetry doesn't include user prompt content. See `demo-agent.ts` for how to add custom OpenTelemetry logging to capture prompts.

Config is in `.env.local` (copy from `.env.example` if needed).

```bash
# Install dependencies
npm install

# Run the demo agent (with ClickStack running)
npm run demo "What is 2+2?"
```

### Querying in ClickHouse

```sql
SELECT
  Timestamp,
  ServiceName,
  Body,
  LogAttributes['prompt.content'] as prompt_content,
  LogAttributes['session.id'] as session_id
FROM otel_logs
WHERE Body = 'user_prompt'
ORDER BY Timestamp DESC;
```

## Missing fields (from Claude Code built-in telemetry)

- ~~Prompt~~ ✅ Captured via demo-agent.ts
- Response
- Tool call results

Potential solutions for remaining fields:

- https://github.com/badlogic/lemmy/tree/main/apps/claude-trace
- https://github.com/ljw1004/claude-log
