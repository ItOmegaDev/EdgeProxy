// API and WebSocket Client Service for EdgeProxy Full-Stack Architecture

export interface BackendTunnel {
  id: string;
  name: string;
  subdomain: string;
  localPort: number;
  protocol: 'quic' | 'http2' | 'websocket' | 'tcp';
  status: 'online' | 'reconnecting' | 'offline';
  tlsStatus: 'active' | 'renewing' | 'failed';
  authEnabled: boolean;
  authUser?: string;
  totalRequests: number;
  bytesTransferred: number;
  avgLatency: number;
  publicUrl: string;
  createdAt: string;
}

export interface BackendLog {
  id: string;
  timestamp: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  clientIp: string;
  subdomain: string;
  bytesIn: number;
  bytesOut: number;
  blockedByShield: boolean;
}

export interface SqlResult {
  columns: string[];
  rows: any[];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

export interface AiDiagnosticResult {
  success: boolean;
  modelUsed: string;
  analysis: string;
  error?: string;
}

export const api = {
  async getStatus() {
    const res = await fetch('/api/status');
    if (!res.ok) throw new Error('Failed to fetch gateway status');
    return res.json();
  },

  async getTunnels(): Promise<BackendTunnel[]> {
    const res = await fetch('/api/tunnels');
    if (!res.ok) throw new Error('Failed to fetch tunnels');
    return res.json();
  },

  async createTunnel(payload: {
    name?: string;
    subdomain: string;
    localPort: number;
    protocol?: string;
    authEnabled?: boolean;
    authUser?: string;
  }): Promise<BackendTunnel> {
    const res = await fetch('/api/tunnels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to create tunnel');
    }
    return res.json();
  },

  async deleteTunnel(id: string): Promise<void> {
    const res = await fetch(`/api/tunnels/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to delete tunnel');
  },

  async toggleTunnel(id: string): Promise<BackendTunnel> {
    const res = await fetch(`/api/tunnels/${id}/toggle`, { method: 'PATCH' });
    if (!res.ok) throw new Error('Failed to toggle tunnel state');
    return res.json();
  },

  async getLogs(): Promise<BackendLog[]> {
    const res = await fetch('/api/traffic/logs');
    if (!res.ok) throw new Error('Failed to fetch traffic logs');
    return res.json();
  },

  async clearLogs(): Promise<void> {
    const res = await fetch('/api/traffic/logs', { method: 'DELETE' });
    if (!res.ok) throw new Error('Failed to clear traffic logs');
  },

  async getCerts(): Promise<any[]> {
    const res = await fetch('/api/certs');
    if (!res.ok) throw new Error('Failed to fetch certificates');
    return res.json();
  },

  async issueCert(payload: { domain: string; wildcard?: boolean; challengeType?: string }): Promise<any> {
    const res = await fetch('/api/certs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Failed to issue certificate');
    }
    return res.json();
  },

  async renewCert(id: string): Promise<any> {
    const res = await fetch(`/api/certs/${id}/renew`, { method: 'POST' });
    if (!res.ok) throw new Error('Failed to renew certificate');
    return res.json();
  },

  async discoverPorts(): Promise<any[]> {
    const res = await fetch('/api/discover');
    if (!res.ok) throw new Error('Failed to scan local ports');
    return res.json();
  },

  async getRateLimiter(): Promise<any> {
    const res = await fetch('/api/ratelimit');
    if (!res.ok) throw new Error('Failed to fetch rate limiter config');
    return res.json();
  },

  async updateRateLimiter(payload: any): Promise<any> {
    const res = await fetch('/api/ratelimit/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error('Failed to update rate limiter config');
    return res.json();
  },

  async unbanIp(ip: string): Promise<void> {
    const res = await fetch('/api/ratelimit/unban', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
    });
    if (!res.ok) throw new Error('Failed to unban IP');
  },

  async simulateRequest(params: {
    subdomain: string;
    method?: string;
    path?: string;
    clientIp?: string;
    isAttack?: boolean;
  }): Promise<{ success: boolean; log: BackendLog }> {
    const res = await fetch('/api/traffic/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('Failed to simulate traffic request');
    return res.json();
  },

  async executeSql(query: string): Promise<SqlResult> {
    const res = await fetch('/api/sql/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'SQL execution failed');
    }
    return res.json();
  },

  async diagnoseWithAi(topic: string = 'traffic_anomalies', contextData?: any): Promise<AiDiagnosticResult> {
    const res = await fetch('/api/ai/diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ topic, contextData }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'AI Diagnostic failed');
    }
    return res.json();
  },

  async getCoreFiles(): Promise<Record<string, string>> {
    const res = await fetch('/api/core/files');
    if (!res.ok) throw new Error('Failed to fetch Go and SQL core files');
    return res.json();
  },

  connectWebSocket(
    onMessage: (event: { type: string; data: any; timestamp: string }) => void,
    onStatusChange?: (connected: boolean) => void
  ): () => void {
    let ws: WebSocket | null = null;
    let reconnectTimeout: any = null;
    let isCleanedUp = false;

    function connect() {
      if (isCleanedUp) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}/ws`;

      try {
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
          if (onStatusChange) onStatusChange(true);
        };

        ws.onmessage = (event) => {
          try {
            const parsed = JSON.parse(event.data);
            onMessage(parsed);
          } catch (e) {
            console.error('Error parsing WebSocket frame', e);
          }
        };

        ws.onclose = () => {
          if (onStatusChange) onStatusChange(false);
          if (!isCleanedUp) {
            reconnectTimeout = setTimeout(connect, 2500);
          }
        };

        ws.onerror = () => {
          if (ws) ws.close();
        };
      } catch (err) {
        if (!isCleanedUp) {
          reconnectTimeout = setTimeout(connect, 3000);
        }
      }
    }

    connect();

    return () => {
      isCleanedUp = true;
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
      if (ws) ws.close();
    };
  },
};
