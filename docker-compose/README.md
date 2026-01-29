# ClickStack Docker Compose Setup

This directory contains a Docker Compose configuration that replicates the `clickhouse/clickstack-all-in-one` image functionality using separate containers.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Docker Network: clickstack                   │
│                                                                  │
│  ┌──────────┐    ┌──────────────┐    ┌─────────────────────┐   │
│  │ MongoDB  │    │  ClickHouse  │    │  OTEL Collector     │   │
│  │  (db)    │    │ (ch-server)  │    │ (otel-collector)    │   │
│  │          │    │              │    │                     │   │
│  │ :27017   │    │ :8123 HTTP   │◄───│ :4317 gRPC          │   │
│  │          │    │ :9000 TCP    │    │ :4318 HTTP          │   │
│  └────┬─────┘    └──────┬───────┘    └──────────┬──────────┘   │
│       │                 │                       │               │
│       │                 │                       │               │
│       └────────┬────────┴───────────────────────┘               │
│                │                                                 │
│                ▼                                                 │
│       ┌────────────────┐                                        │
│       │   HyperDX App  │                                        │
│       │     (app)      │                                        │
│       │                │                                        │
│       │ :8000 API      │                                        │
│       │ :8080 UI       │                                        │
│       └────────────────┘                                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Services

| Service | Image | Purpose | Ports |
|---------|-------|---------|-------|
| `db` | mongo:5.0.32-focal | Application state (dashboards, alerts, users) | 27017 (internal) |
| `ch-server` | clickhouse/clickhouse-server:25.6-alpine | Telemetry storage | 8123 (HTTP) |
| `otel-collector` | clickhouse/clickstack-otel-collector | Data ingestion | 4317, 4318, 13133 |
| `app` | hyperdx/hyperdx | Web UI and API | 8000, 8080 |

## Quick Start

```bash
# Start all services
docker compose up -d

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and remove volumes (clean slate)
docker compose down -v
```

## Accessing Services

| Service | URL |
|---------|-----|
| HyperDX UI | http://localhost:8080 |
| HyperDX API | http://localhost:8000 |
| ClickHouse HTTP | http://localhost:8123 |
| OTLP gRPC | localhost:4317 |
| OTLP HTTP | http://localhost:4318 |
| Health Check | http://localhost:13133 |

## Sending Telemetry Data

Configure your OpenTelemetry SDK:

**gRPC:**
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
```

**HTTP/Protobuf:**
```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

## Configuration

### Environment Variables

Edit `.env` to customize:

| Variable | Default | Description |
|----------|---------|-------------|
| `IMAGE_VERSION` | `2` | Docker image version tag |
| `HYPERDX_API_PORT` | `8000` | API server port |
| `HYPERDX_APP_PORT` | `8080` | Web UI port |
| `HYPERDX_APP_URL` | `http://localhost` | Base URL for frontend |
| `HYPERDX_LOG_LEVEL` | `debug` | Logging level |
| `HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE` | `default` | Target ClickHouse database |

### ClickHouse Configuration

- `clickhouse/config.xml` - Server configuration
- `clickhouse/users.xml` - User accounts and permissions

Pre-configured users:
| User | Password | Purpose |
|------|----------|---------|
| `default` | (empty) | Default admin user |
| `api` | `api` | API access |
| `worker` | `worker` | Worker processes |

## Volumes

Data is persisted to `~/.clickstack/` in your home directory:

| Path | Purpose |
|------|---------|
| `~/.clickstack/mongo/` | MongoDB database files |
| `~/.clickstack/clickhouse/data/` | ClickHouse data directory |
| `~/.clickstack/clickhouse/logs/` | ClickHouse server logs |

To reset all data:
```bash
rm -rf ~/.clickstack
```

## Comparison with All-in-One Image

| Aspect | All-in-One | Docker Compose |
|--------|------------|----------------|
| Startup | Single command | `docker compose up` |
| Resource isolation | Shared | Separate per service |
| Scaling | Not possible | Can scale individual services |
| Debugging | Harder (single container) | Easier (separate logs) |
| Production use | Not recommended | Suitable for single-server |
| Customization | Limited | Full control per component |
| Version pinning | All-or-nothing | Individual component versions |
| Issue isolation | Difficult | Easy to identify problematic service |

## Benefits of Separate Containers

### Customization
- **ClickHouse tuning**: Modify `clickhouse/config.xml` to adjust memory limits, query settings, or enable features without rebuilding the entire stack
- **OTEL Collector pipelines**: Mount custom collector configs to add processors, exporters, or receivers
- **Resource limits**: Set CPU/memory limits per service based on workload (e.g., give ClickHouse more memory)

### Debugging & Issue Resolution
- **Isolated restarts**: Restart only the problematic service without affecting others (`docker compose restart otel-collector`)
- **Independent logs**: Each service has its own log stream, making it easier to trace issues
- **Version rollback**: Roll back a single component to a previous version if an upgrade causes issues

### Upgrades
- **Incremental updates**: Upgrade ClickHouse independently of HyperDX, or vice versa
- **Testing**: Test a new version of one component while keeping others stable
- **Compatibility**: Pin specific versions that work well together

## OTLP Support

This Docker Compose setup includes a custom OTEL collector configuration (`otel-collector/custom-config.yaml`) that enables OTLP receivers for logs, traces, and metrics. This is necessary because HyperDX's default OpAMP-managed config defines OTLP receivers but doesn't connect them to pipelines.

The custom config wires the `otlp/hyperdx` receiver to:
- **Logs pipeline** (`logs/in`) - alongside FluentForward
- **Traces pipeline** (`traces`) - replacing the no-op receiver
- **Metrics pipeline** (`metrics`) - alongside Prometheus scraping

Both gRPC (4317) and HTTP (4318) protocols are supported.

## Troubleshooting

**Check service health:**
```bash
docker compose ps
```

**View service logs:**
```bash
docker compose logs ch-server
docker compose logs otel-collector
docker compose logs app
```

**Connect to ClickHouse:**
```bash
docker compose exec ch-server clickhouse-client
```

**Connect to MongoDB:**
```bash
docker compose exec db mongosh hyperdx
```

**Restart a specific service:**
```bash
docker compose restart otel-collector
```
