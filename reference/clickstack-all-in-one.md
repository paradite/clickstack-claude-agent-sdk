# ClickStack All-in-One Docker Image Reference

This document describes the internal workings of the `clickhouse/clickstack-all-in-one` Docker image.

## Overview

ClickStack is a production-grade observability platform built on ClickHouse and OpenTelemetry, unifying logs, traces, metrics, and sessions in a single solution.

The all-in-one image bundles:
- **ClickHouse** - Column-oriented database for telemetry storage
- **OpenTelemetry Collector** - Data ingestion via gRPC/HTTP
- **HyperDX** - Web UI for visualization and search
- **MongoDB** - Application state storage (dashboards, alerts, users)

## Docker Run Command

Basic usage:
```bash
docker run \
  -p 8080:8080 \
  -p 4317:4317 \
  -p 4318:4318 \
  -p 8123:8123 \
  -v "$(pwd)/.volumes/db:/data/db" \
  -v "$(pwd)/.volumes/ch_data:/var/lib/clickhouse" \
  -v "$(pwd)/.volumes/ch_logs:/var/log/clickhouse-server" \
  clickhouse/clickstack-all-in-one:latest
```

## Exposed Ports

| Port | Protocol | Service | Description |
|------|----------|---------|-------------|
| 8080 | HTTP | HyperDX UI | Web interface for log/trace visualization |
| 4317 | gRPC | OTLP Collector | OpenTelemetry gRPC endpoint |
| 4318 | HTTP | OTLP Collector | OpenTelemetry HTTP endpoint |
| 8123 | HTTP | ClickHouse | ClickHouse HTTP interface |
| 9000 | TCP | ClickHouse | ClickHouse native TCP protocol |
| 9009 | HTTP | ClickHouse | ClickHouse interserver HTTP |
| 13133 | HTTP | Health Check | OTel collector health endpoint |

## Volume Mounts

| Container Path | Purpose |
|----------------|---------|
| `/data/db` | MongoDB data storage |
| `/var/lib/clickhouse` | ClickHouse data directory |
| `/var/log/clickhouse-server` | ClickHouse logs |

## Internal Architecture

### Startup Sequence

The container uses `/etc/local/entry.sh` as entrypoint, which:

1. Sets authentication mode (`IS_LOCAL_APP_MODE`)
2. Sources `/etc/local/entry.base.sh`

The base entrypoint script:

1. Configures environment variables for all services
2. Adds DNS entries to `/etc/hosts` for service discovery:
   - `127.0.0.1 ch-server` (ClickHouse)
   - `127.0.0.1 db` (MongoDB)
3. Starts ClickHouse server via `/entrypoint.sh`
4. Starts MongoDB daemon
5. Waits for ClickHouse to be ready (polls http://ch-server:8123)
6. Starts OpenTelemetry Collector via `/otel-entrypoint.sh`
7. Starts HyperDX application components using `concurrently`:
   - API server (port 8000)
   - Frontend app (port 8080)
   - Alert task worker

### Service Startup Commands

**ClickHouse:**
```bash
/entrypoint.sh > /var/log/clickhouse.log 2>&1 &
```

**MongoDB:**
```bash
mongod --quiet --dbpath /data/db > /var/log/mongod.log 2>&1 &
```

**OpenTelemetry Collector:**
```bash
/otel-entrypoint.sh /usr/local/bin/opampsupervisor > /var/log/otel-collector.log 2>&1 &
```

**HyperDX:**
```bash
concurrently \
  "--kill-others-on-fail" \
  "--names=API,APP,ALERT-TASK" \
  "PORT=8000 node ./packages/api/build/index.js" \
  "cd ./packages/app/packages/app && PORT=8080 node server.js" \
  "node ./packages/api/build/tasks/index.js check-alerts" \
  > /var/log/app.log 2>&1 &
```

## Environment Variables

### Logging
| Variable | Default | Description |
|----------|---------|-------------|
| `HYPERDX_LOG_LEVEL` | `error` | HyperDX logging level |
| `CLICKHOUSE_LOG_LEVEL` | `error` | ClickHouse logging level |

### HyperDX Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `HYPERDX_API_PORT` | `8000` | API server port |
| `HYPERDX_APP_PORT` | `8080` | Frontend port |
| `HYPERDX_APP_URL` | `http://localhost` | Base URL for frontend |
| `HYPERDX_OPAMP_PORT` | `4320` | OpAMP server port |
| `SERVER_URL` | `http://127.0.0.1:8000` | Backend API URL |
| `FRONTEND_URL` | `http://localhost:8080` | Frontend URL |

### ClickHouse Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `CLICKHOUSE_ENDPOINT` | `tcp://ch-server:9000` | ClickHouse TCP endpoint |
| `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE` | `default` | Target database |

### MongoDB Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `MONGO_URI` | `mongodb://db:27017/hyperdx` | MongoDB connection string |

### Session Configuration
| Variable | Default | Description |
|----------|---------|-------------|
| `EXPRESS_SESSION_SECRET` | `hyperdx is cool` | Express session secret |

### Feature Flags
| Variable | Description |
|----------|-------------|
| `BETA_CH_OTEL_JSON_SCHEMA_ENABLED` | Enable JSON schema for OTEL |
| `CUSTOM_OTELCOL_CONFIG_FILE` | Path to custom OTEL config |
| `OTEL_AGENT_FEATURE_GATE_ARG` | Feature gate arguments |
| `OTEL_SUPERVISOR_LOGS` | Enable supervisor log output |

## ClickHouse Configuration

### Users

Three users are pre-configured in `/etc/clickhouse-server/users.xml`:

| User | Password | Purpose |
|------|----------|---------|
| `default` | (empty) | Default user, no password |
| `api` | `api` | API access user |
| `worker` | `worker` | Worker process user |

### Server Settings

Key settings from `/etc/clickhouse-server/config.xml`:

- Listen on all interfaces (`0.0.0.0`)
- HTTP port: 8123
- TCP port: 9000
- Interserver port: 9009
- Max connections: 4096
- Max concurrent queries: 100
- Max memory usage: 10GB per query
- Timezone: UTC

### Data Directory Structure

- `/var/lib/clickhouse/` - Main data directory
- `/var/lib/clickhouse/tmp/` - Temporary files
- `/var/lib/clickhouse/user_files/` - User files

## OpenTelemetry Collector Configuration

### Supervisor Configuration

The collector runs under `opampsupervisor` for remote configuration management. Template at `/etc/otel/supervisor.yaml.tmpl`:

```yaml
server:
  endpoint: http://127.0.0.1:4320/v1/opamp

capabilities:
  reports_effective_config: true
  accepts_remote_config: true

agent:
  executable: /otelcontribcol
  config_files:
    - /etc/otelcol-contrib/config.yaml
```

### Collector Processing Pipeline

From `/etc/otelcol-contrib/config.yaml`:

**Processors:**
1. `transform` - Log statement processing:
   - JSON parsing from log body
   - Severity level inference from body content
   - Severity text normalization

2. `resourcedetection` - Detects environment, system, and Docker metadata

3. `batch` - Batches telemetry for efficient export

4. `memory_limiter` - Limits memory usage (1500 MiB limit)

**Extensions:**
- `health_check` - Health endpoint on port 13133

### Log Severity Inference

The collector automatically infers log severity from body content:
- `fatal`, `alert`, `crit`, `emerg` → FATAL
- `error`, `err` → ERROR
- `warn`, `notice` → WARN
- `debug`, `dbug` → DEBUG
- `trace` → TRACE
- Default → INFO

## Default Data Sources

HyperDX pre-configures connections and sources for the local ClickHouse:

**Connection:**
- Name: `Local ClickHouse`
- Host: `http://localhost:8123`
- Username: `default`
- Password: (empty)

**Sources:**
- `Logs` - Table: `default.otel_logs`
- `Traces` - Table: `default.otel_traces`
- `Metrics` - Tables: `otel_metrics_*`
- `Sessions` - Table: `default.hyperdx_sessions`

## OTEL Logs Schema

The `default.otel_logs` table schema:

```sql
CREATE TABLE default.otel_logs (
  Timestamp DateTime64(9),
  TimestampTime DateTime DEFAULT toDateTime(Timestamp),
  TraceId String,
  SpanId String,
  TraceFlags UInt8,
  SeverityText LowCardinality(String),
  SeverityNumber UInt8,
  ServiceName LowCardinality(String),
  Body String,
  ResourceSchemaUrl LowCardinality(String),
  ResourceAttributes Map(LowCardinality(String), String),
  ScopeSchemaUrl LowCardinality(String),
  ScopeName String,
  ScopeVersion LowCardinality(String),
  ScopeAttributes Map(LowCardinality(String), String),
  LogAttributes Map(LowCardinality(String), String),
  -- Indexes for efficient querying
  INDEX idx_trace_id TraceId TYPE bloom_filter(0.001),
  INDEX idx_body Body TYPE tokenbf_v1(32768, 3, 0)
) ENGINE = MergeTree
PARTITION BY toDate(TimestampTime)
PRIMARY KEY (ServiceName, TimestampTime)
ORDER BY (ServiceName, TimestampTime, Timestamp)
TTL TimestampTime + toIntervalDay(30)
```

## Log Files

| Path | Content |
|------|---------|
| `/var/log/clickhouse.log` | ClickHouse stdout/stderr |
| `/var/log/mongod.log` | MongoDB stdout/stderr |
| `/var/log/otel-collector.log` | OTel collector logs |
| `/var/log/app.log` | HyperDX application logs |
| `/var/log/clickhouse-server/` | ClickHouse internal logs |

## Sending Data

Configure your OpenTelemetry SDK to send data:

**gRPC:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

**HTTP/Protobuf:**
```
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Deployment Recommendations

| Use Case | Recommendation |
|----------|---------------|
| Demo/Testing | All-in-one Docker image |
| Local Development | All-in-one with volume mounts |
| Production (single server) | Docker Compose |
| Production (Kubernetes) | Helm chart |

The all-in-one image is not recommended for production due to lack of fault tolerance.

## References

- [ClickStack Documentation](https://clickhouse.com/docs/use-cases/observability/clickstack)
- [Getting Started](https://clickhouse.com/docs/use-cases/observability/clickstack/getting-started)
- [Architecture](https://clickhouse.com/docs/use-cases/observability/clickstack/architecture)
- [Configuration](https://clickhouse.com/docs/use-cases/observability/clickstack/config)
- [Deployment Options](https://clickhouse.com/docs/use-cases/observability/clickstack/deployment)
