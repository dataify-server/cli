import { DEFAULT_SERVER } from "./config.js";

const JSON_RPC_VERSION = "2.0";
const DEFAULT_PROTOCOL_VERSION = "2025-11-25";

export class McpHttpClient {
  constructor(options = {}) {
    this.endpoint = normalizeEndpoint(options.server || DEFAULT_SERVER);
    this.token = options.token || "";
    this.tools = options.tools || "";
    this.timeoutMs = options.timeoutMs || 120000;
    this.headers = options.headers || {};
    this.debug = Boolean(options.debug);
    this.sessionId = "";
    this.protocolVersion = "";
    this.nextId = 1;
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) {
      return;
    }

    const response = await this.sendRequest("initialize", {
      protocolVersion: DEFAULT_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: {
        name: "dataify-mcp-cli",
        version: "0.1.9"
      }
    });

    this.protocolVersion = response.result?.protocolVersion || DEFAULT_PROTOCOL_VERSION;
    await this.sendNotification("notifications/initialized");
    this.initialized = true;
  }

  async listTools() {
    await this.initialize();

    const tools = [];
    let cursor;
    do {
      const params = cursor ? { cursor } : {};
      const response = await this.sendRequest("tools/list", params);
      const result = response.result || {};
      if (Array.isArray(result.tools)) {
        tools.push(...result.tools);
      }
      cursor = result.nextCursor;
    } while (cursor);

    return tools;
  }

  async callTool(name, args = {}) {
    await this.initialize();
    const response = await this.sendRequest("tools/call", {
      name,
      arguments: args
    });
    return response.result;
  }

  async close() {
    if (!this.sessionId) {
      return;
    }

    const headers = this.buildHeaders("text/plain");
    try {
      await fetch(this.endpointWithAuth(), {
        method: "DELETE",
        headers,
        signal: AbortSignal.timeout(Math.min(this.timeoutMs, 5000))
      });
    } catch {
      // Closing is best-effort; command results should not be hidden by it.
    } finally {
      this.sessionId = "";
    }
  }

  async sendRequest(method, params = {}) {
    const id = this.nextId++;
    const payload = {
      jsonrpc: JSON_RPC_VERSION,
      id,
      method,
      params
    };
    const response = await this.postJson(payload);

    if (!response || response.id === undefined || response.id === null) {
      throw new Error(`MCP response for ${method} did not include an id`);
    }
    if (response.error) {
      const details = response.error.message || JSON.stringify(response.error);
      throw new Error(`MCP ${method} failed: ${details}`);
    }
    return response;
  }

  async sendNotification(method, params = {}) {
    const payload = {
      jsonrpc: JSON_RPC_VERSION,
      method
    };
    if (params && Object.keys(params).length > 0) {
      payload.params = params;
    }
    await this.postJson(payload, { notification: true });
  }

  async postJson(payload, options = {}) {
    const headers = this.buildHeaders("application/json, text/event-stream");
    const body = JSON.stringify(payload);
    if (this.debug) {
      process.stderr.write(`POST ${this.endpointWithAuth()}\n${body}\n`);
    }

    const response = await fetch(this.endpointWithAuth(), {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(this.timeoutMs)
    });

    const sessionId = response.headers.get("Mcp-Session-Id");
    if (sessionId) {
      this.sessionId = sessionId;
    }

    if (response.status === 202 && options.notification) {
      return null;
    }

    if (!response.ok && response.status !== 202) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.trim()}`);
    }

    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    if (contentType.includes("text/event-stream")) {
      const text = await response.text();
      return parseSseJsonRpc(text, payload.id);
    }
    if (response.status === 202) {
      return null;
    }

    const text = await response.text();
    throw new Error(`Unexpected MCP response content type "${contentType}": ${text.trim()}`);
  }

  buildHeaders(accept) {
    const headers = {
      ...this.headers,
      "Content-Type": "application/json",
      Accept: accept
    };
    if (this.sessionId) {
      headers["Mcp-Session-Id"] = this.sessionId;
    }
    if (this.protocolVersion) {
      headers["Mcp-Protocol-Version"] = this.protocolVersion;
    }
    return headers;
  }

  endpointWithAuth() {
    const url = new URL(this.endpoint);
    if (this.token) {
      url.searchParams.set("token", this.token);
    }
    if (this.tools) {
      url.searchParams.set("tools", this.tools);
    }
    return url.toString();
  }
}

export function normalizeEndpoint(value) {
  const url = new URL(value);
  if (!url.pathname || url.pathname === "/") {
    url.pathname = "/mcp";
  }
  return url.toString();
}

export function parseSseJsonRpc(text, requestId) {
  const messages = [];
  const events = text.split(/\r?\n\r?\n/);

  for (const event of events) {
    const data = [];
    for (const line of event.split(/\r?\n/)) {
      if (line.startsWith("data:")) {
        data.push(line.slice(5).trimStart());
      }
    }
    if (data.length === 0) {
      continue;
    }
    const raw = data.join("\n");
    try {
      messages.push(JSON.parse(raw));
    } catch {
      // Ignore non-JSON SSE events; MCP JSON-RPC messages are JSON objects.
    }
  }

  const matching = messages.find((message) => message && message.id === requestId);
  if (matching) {
    return matching;
  }
  const response = messages.find((message) => message && Object.prototype.hasOwnProperty.call(message, "id"));
  if (response) {
    return response;
  }
  throw new Error("SSE response did not include a JSON-RPC response message");
}
