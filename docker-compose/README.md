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

## Production Deployment

Hardened configuration with strong passwords, MongoDB auth, resource limits, and ports bound to localhost.

### Quick Start (Production)

```bash
./setup-prod.sh
docker compose -f docker-compose.prod.yml --env-file .env.prod up -d
```

### ClickHouse Users (Production)

| User | Purpose |
|------|---------|
| `clickstack` | HyperDX app queries and admin |
| `worker` | OTEL collector data ingestion |

### Production Files

| File | Purpose |
|------|---------|
| `docker-compose.prod.yml` | Hardened compose configuration |
| `clickhouse/config.prod.xml` | Hardened server config |
| `clickhouse/users.prod.xml.template` | User config template |
| `.env.prod.example` | Environment variable template |
| `setup-prod.sh` | Generates credentials and configs |

### Key Differences from Development

| Feature | Development | Production |
|---------|-------------|------------|
| Passwords | Weak/empty | Strong random (32 chars) |
| Password storage | Plaintext | SHA256 hashed |
| Network access | Any IP | Docker network only |
| Port binding | All interfaces | OTLP external, UI/DB localhost |
| MongoDB auth | Disabled | Enabled |
| Memory limits | None | Set per container |

### Production Data

Data stored in `~/.clickstack-prod/` (separate from dev)

### Security Considerations

**OTLP Ingestion (ports 4317/4318):**

HyperDX requires an API key for OTLP ingestion. Clients must include the `authorization` header.

1. Get your API key from HyperDX UI: **Settings → Ingestion API Key**

2. Configure clients:
   ```bash
   export OTEL_EXPORTER_OTLP_ENDPOINT=http://your-server:4318
   export OTEL_EXPORTER_OTLP_HEADERS="authorization=<YOUR_API_KEY>"
   ```

3. Or in OTEL Collector config:
   ```yaml
   exporters:
     otlphttp:
       endpoint: 'http://your-server:4318'
       headers:
         authorization: <YOUR_API_KEY>
   ```

**Additional hardening (optional):**
- Firewall rules to restrict source IPs
- Deploy in private network/VPC
- Cloud security groups

**Internal ports (localhost only):**

| Port | Service | Security |
|------|---------|----------|
| 8080 | HyperDX UI | Localhost only |
| 8000 | HyperDX API | Localhost only |
| 8123 | ClickHouse HTTP | Localhost + strong password |

**Database security:**
- MongoDB: Authenticated with strong password
- ClickHouse: SHA256 hashed passwords, network restricted to Docker + localhost

### Security Test Results

The following security tests verify the production configuration:

**Port Binding Verification:**
| Port | Expected | Actual | Status |
|------|----------|--------|--------|
| 4317 (OTLP gRPC) | 0.0.0.0 (external) | 0.0.0.0 | ✅ Pass |
| 4318 (OTLP HTTP) | 0.0.0.0 (external) | 0.0.0.0 | ✅ Pass |
| 8080 (HyperDX UI) | 127.0.0.1 | 127.0.0.1 | ✅ Pass |
| 8000 (HyperDX API) | 127.0.0.1 | 127.0.0.1 | ✅ Pass |
| 8123 (ClickHouse) | 127.0.0.1 | 127.0.0.1 | ✅ Pass |
| 27017 (MongoDB) | Not exposed | Not exposed | ✅ Pass |

**Authentication Tests:**
| Test | Expected | Actual | Status |
|------|----------|--------|--------|
| ClickHouse no auth | 401 Unauthorized | 401 | ✅ Pass |
| ClickHouse wrong password | 401 Unauthorized | 401 | ✅ Pass |
| ClickHouse valid credentials | Success | Success | ✅ Pass |
| ClickHouse default user empty password | Rejected | Rejected | ✅ Pass |
| OTLP HTTP no auth | 401 Unauthorized | 401 | ✅ Pass |
| OTLP HTTP invalid API key | Rejected | Rejected | ✅ Pass |
| HyperDX UI on localhost | Accessible | 200 OK | ✅ Pass |

**Configuration Verification:**
| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| Passwords SHA256 hashed | 64-char hex | 64-char hex | ✅ Pass |
| ClickHouse memory limit | 8GB | 8GB | ✅ Pass |
| HyperDX app memory limit | 2GB | 2GB | ✅ Pass |
| Docker network isolation | 172.x.x.x/16 | 172.18.0.0/16 | ✅ Pass |

**Test Commands:**
```bash
# Verify port binding
netstat -an | grep -E '(4317|4318|8123|8080|8000)' | grep LISTEN

# Test ClickHouse auth (should return 401)
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:8123/?query=SELECT%201"

# Test OTLP auth (should return 401)
curl -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4318/v1/logs" -X POST \
  -H "Content-Type: application/json" -d '{"resourceLogs":[]}'

# Test ClickHouse with valid credentials
source .env.prod && curl -s "http://127.0.0.1:8123/?query=SELECT%201" \
  --user "worker:${CLICKHOUSE_WORKER_PASSWORD}"
```
