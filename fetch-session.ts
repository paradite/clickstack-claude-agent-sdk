#!/usr/bin/env npx tsx
/**
 * Fetch logs for a session from ClickHouse and save to a text file
 *
 * Usage:
 *   npx tsx fetch-session.ts <session-id>
 *   npx tsx fetch-session.ts <session-id-prefix>
 *
 * Examples:
 *   npx tsx fetch-session.ts 54d5f26c-2621-4dcf-aa23-1f7cf8a9f627
 *   npx tsx fetch-session.ts 54d5f26c
 */

import { writeFileSync } from "fs";
import { execSync } from "child_process";

const CONTAINER_NAME =
  process.env.CLICKHOUSE_CONTAINER || "clickstack-all-in-one";

interface LogRow {
  Timestamp: string;
  role: string;
  content: string;
  session_id: string;
  tool_name: string;
  tool_input: string;
  tool_result: string;
}

function findContainer(): string {
  // Try to find the ClickStack container by image name
  const result = execSync(
    'docker ps --filter "ancestor=clickhouse/clickstack-all-in-one" --format "{{.ID}}"',
    { encoding: "utf-8" }
  ).trim();

  if (result) {
    return result.split("\n")[0];
  }

  // Fallback: try by container name pattern
  const byName = execSync(
    'docker ps --format "{{.ID}} {{.Names}}" | grep -i clickstack || true',
    { encoding: "utf-8" }
  ).trim();

  if (byName) {
    return byName.split(" ")[0];
  }

  throw new Error(
    "Could not find ClickStack container. Is it running? Try: docker ps"
  );
}

function queryClickHouse(containerId: string, query: string): LogRow[] {
  const escapedQuery = query.replace(/"/g, '\\"');
  const cmd = `docker exec ${containerId} clickhouse-client --query "${escapedQuery}" --format=JSONEachRow`;

  try {
    const result = execSync(cmd, { encoding: "utf-8", maxBuffer: 50 * 1024 * 1024 });
    if (!result.trim()) {
      return [];
    }
    return result
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } catch (error: unknown) {
    if (error instanceof Error && "stderr" in error) {
      throw new Error(`ClickHouse query failed: ${(error as { stderr: string }).stderr}`);
    }
    throw error;
  }
}

function formatMessage(row: LogRow): string {
  const timestamp = new Date(row.Timestamp).toISOString();
  const lines: string[] = [];

  lines.push(`${"=".repeat(80)}`);
  lines.push(`[${timestamp}] ${row.role.toUpperCase()}`);
  lines.push(`${"=".repeat(80)}`);

  if (row.role === "tool" && row.tool_name) {
    lines.push(`Tool: ${row.tool_name}`);
    lines.push("");
    lines.push("Input:");
    try {
      const input = JSON.parse(row.tool_input);
      lines.push(JSON.stringify(input, null, 2));
    } catch {
      lines.push(row.tool_input);
    }
    lines.push("");
    lines.push("Result:");
  }

  lines.push(row.content);
  lines.push("");

  return lines.join("\n");
}

async function fetchSession(sessionIdOrPrefix: string): Promise<void> {
  console.log(`Fetching logs for session: ${sessionIdOrPrefix}`);

  // Find the ClickStack container
  const containerId = findContainer();
  console.log(`Using container: ${containerId}`);

  // Query ClickHouse for logs matching the session ID prefix
  const query = `
    SELECT
      Timestamp,
      LogAttributes['role'] as role,
      LogAttributes['content'] as content,
      LogAttributes['session.id'] as session_id,
      LogAttributes['tool.name'] as tool_name,
      LogAttributes['tool.input'] as tool_input,
      LogAttributes['tool.result'] as tool_result
    FROM otel_logs
    WHERE LogAttributes['session.id'] LIKE '${sessionIdOrPrefix}%'
    ORDER BY Timestamp ASC
  `;

  const allRows = queryClickHouse(containerId, query);

  // Filter out messages without a role (empty/incomplete messages)
  const rows = allRows.filter((row) => row.role && row.role.trim() !== "");

  if (rows.length === 0) {
    console.error(`No logs found for session: ${sessionIdOrPrefix}`);
    process.exit(1);
  }

  // Get the full session ID from the first row
  const fullSessionId = rows[0].session_id;
  console.log(`Found ${rows.length} messages in session: ${fullSessionId}`);

  // Format the output
  const output: string[] = [];
  output.push(`Session: ${fullSessionId}`);
  output.push(`Messages: ${rows.length}`);
  output.push(`Fetched at: ${new Date().toISOString()}`);
  output.push("");

  for (const row of rows) {
    output.push(formatMessage(row));
  }

  // Save to file
  const filename = `session-${fullSessionId.slice(0, 8)}.txt`;
  writeFileSync(filename, output.join("\n"));
  console.log(`Saved to: ${filename}`);
}

// Main
const sessionId = process.argv[2];

if (!sessionId) {
  console.log("Usage: npx tsx fetch-session.ts <session-id>");
  console.log("");
  console.log("Examples:");
  console.log("  npx tsx fetch-session.ts 54d5f26c-2621-4dcf-aa23-1f7cf8a9f627");
  console.log("  npx tsx fetch-session.ts 54d5f26c");
  process.exit(1);
}

fetchSession(sessionId).catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
