#!/bin/bash
# Production Setup Script for ClickStack
# Generates secure passwords and creates config files

set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

echo "=== ClickStack Production Setup ==="

# Generate passwords
generate_password() {
    openssl rand -base64 32 | tr -d '/+=' | head -c 32
}

sha256_hash() {
    echo -n "$1" | sha256sum | cut -d' ' -f1
}

MONGO_ROOT_PASSWORD=$(generate_password)
CLICKHOUSE_DEFAULT_PASSWORD=$(generate_password)
CLICKHOUSE_PASSWORD=$(generate_password)
CLICKHOUSE_WORKER_PASSWORD=$(generate_password)

# Create .env.prod
cat > .env.prod << EOF
IMAGE_VERSION=2
HYPERDX_API_PORT=8000
HYPERDX_APP_PORT=8080
HYPERDX_APP_URL=http://localhost
HYPERDX_OPAMP_PORT=4320
HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE=default
HYPERDX_LOG_LEVEL=info

MONGO_ROOT_USERNAME=mongoadmin
MONGO_ROOT_PASSWORD=${MONGO_ROOT_PASSWORD}

CLICKHOUSE_USER=clickstack
CLICKHOUSE_PASSWORD=${CLICKHOUSE_PASSWORD}
CLICKHOUSE_WORKER_PASSWORD=${CLICKHOUSE_WORKER_PASSWORD}
EOF
chmod 600 .env.prod

# Create users.prod.xml with hashes
DEFAULT_HASH=$(sha256_hash "$CLICKHOUSE_DEFAULT_PASSWORD")
CLICKSTACK_HASH=$(sha256_hash "$CLICKHOUSE_PASSWORD")
WORKER_HASH=$(sha256_hash "$CLICKHOUSE_WORKER_PASSWORD")

cat > clickhouse/users.prod.xml << EOF
<?xml version="1.0"?>
<clickhouse>
    <profiles>
        <default>
            <max_memory_usage>10000000000</max_memory_usage>
            <use_uncompressed_cache>0</use_uncompressed_cache>
            <load_balancing>in_order</load_balancing>
            <log_queries>1</log_queries>
        </default>
    </profiles>

    <users>
        <default>
            <password_sha256_hex>${DEFAULT_HASH}</password_sha256_hex>
            <profile>default</profile>
            <networks>
                <ip>127.0.0.1</ip>
                <ip>::1</ip>
            </networks>
            <quota>default</quota>
        </default>

        <clickstack>
            <password_sha256_hex>${CLICKSTACK_HASH}</password_sha256_hex>
            <profile>default</profile>
            <networks>
                <ip>127.0.0.1</ip>
                <ip>::1</ip>
                <ip>172.16.0.0/12</ip>
            </networks>
            <quota>default</quota>
            <access_management>1</access_management>
        </clickstack>

        <worker>
            <password_sha256_hex>${WORKER_HASH}</password_sha256_hex>
            <profile>default</profile>
            <networks>
                <ip>127.0.0.1</ip>
                <ip>::1</ip>
                <ip>172.16.0.0/12</ip>
            </networks>
            <quota>default</quota>
        </worker>
    </users>

    <quotas>
        <default>
            <interval>
                <duration>3600</duration>
                <queries>0</queries>
                <errors>0</errors>
                <result_rows>0</result_rows>
                <read_rows>0</read_rows>
                <execution_time>0</execution_time>
            </interval>
        </default>
    </quotas>
</clickhouse>
EOF

# Create data directories
mkdir -p ~/.clickstack-prod/{mongo,clickhouse/data,clickhouse/logs}
chmod 700 ~/.clickstack-prod

echo ""
echo "Setup complete. Start with:"
echo "  docker compose -f docker-compose.prod.yml --env-file .env.prod up -d"
