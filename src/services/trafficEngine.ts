import { TrafficRequest, TelemetryMetrics, RateLimiterConfig, Tunnel, RateLimitDecision } from '../types';

const USER_AGENTS = [
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148',
  'curl/8.7.1',
  'EdgeMesh-Agent/2.4.1 (linux-amd64)',
  'Go-http-client/2.0',
  'Python-requests/2.31.0',
];

const PATHS_BY_SUBDOMAIN: Record<string, { paths: string[]; methods: Array<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'> }> = {
  cloud: {
    paths: ['/remote.php/webdav/Documents/report.pdf', '/apps/files/', '/index.php/avatar/user', '/ocs/v2.php/apps/notifications/api/v2/notifications', '/status.php'],
    methods: ['GET', 'POST', 'PUT', 'GET', 'GET'],
  },
  'dev-vite': {
    paths: ['/src/main.tsx', '/@vite/client', '/src/App.tsx', '/assets/index.css', '/api/user/session'],
    methods: ['GET', 'GET', 'GET', 'GET', 'POST'],
  },
  'api-mesh': {
    paths: ['/v1/telemetry/push', '/v1/inference/models', '/v1/tasks/queue', '/v1/healthz', '/v1/metrics/export'],
    methods: ['POST', 'GET', 'POST', 'GET', 'GET'],
  },
  'mc-smp': {
    paths: ['/tcp/handshake', '/tcp/ping', '/tcp/player_sync', '/tcp/chunk_stream'],
    methods: ['GET', 'GET', 'GET', 'GET'],
  },
};

const COUNTRIES = ['UA', 'DE', 'PL', 'US', 'GB', 'FR', 'NL', 'JP'];
const CIPHERS = ['TLS_AES_256_GCM_SHA384 (TLSv1.3)', 'TLS_CHACHA20_POLY1305_SHA256 (QUIC)', 'ECDHE-ECDSA-AES128-GCM-SHA256'];

export class TrafficEngine {
  private config: RateLimiterConfig;
  private tunnels: Tunnel[];
  private requestsHistory: TrafficRequest[] = [];
  private lastRefillTime: number = Date.now();
  private requestCounter: number = 0;
  private droppedCount: number = 0;
  private latenciesBuffer: number[] = [12, 14, 15, 18, 22, 16, 14, 19, 25, 30];
  private currentRpsHistory: number[] = [18, 24, 22, 29, 31, 26, 35];
  private isAttackActive: boolean = false;
  private attackInterval: any = null;

  constructor(initialConfig: RateLimiterConfig, initialTunnels: Tunnel[]) {
    this.config = { ...initialConfig };
    this.tunnels = [...initialTunnels];
    this.seedInitialRequests();
  }

  public getConfig(): RateLimiterConfig {
    return { ...this.config };
  }

  public updateConfig(newConfig: Partial<RateLimiterConfig>): RateLimiterConfig {
    this.config = { ...this.config, ...newConfig };
    return this.getConfig();
  }

  public setTunnels(tunnels: Tunnel[]) {
    this.tunnels = [...tunnels];
  }

  public refillTokens() {
    const now = Date.now();
    const elapsedSec = (now - this.lastRefillTime) / 1000;
    if (elapsedSec > 0.1) {
      const addedTokens = elapsedSec * this.config.refillRate;
      this.config.currentTokens = Math.min(this.config.capacity, this.config.currentTokens + addedTokens);
      this.lastRefillTime = now;
    }

    // Clean up expired IP jail records
    this.config.blockedIpRecords = this.config.blockedIpRecords.filter((rec) => rec.blockedUntil > now);
  }

  public generateRequest(options?: {
    forceSubdomain?: string;
    clientIp?: string;
    isAttack?: boolean;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
    customPath?: string;
  }): TrafficRequest {
    this.refillTokens();
    this.requestCounter++;

    const activeTunnels = this.tunnels.filter((t) => t.status === 'online');
    const selectedTunnel = options?.forceSubdomain
      ? this.tunnels.find((t) => t.subdomain === options.forceSubdomain) || activeTunnels[0]
      : activeTunnels[Math.floor(Math.random() * activeTunnels.length)] || this.tunnels[0];

    const sub = selectedTunnel ? selectedTunnel.subdomain : 'cloud';
    const pathConfig = PATHS_BY_SUBDOMAIN[sub] || {
      paths: ['/api/resource', '/health', '/data'],
      methods: ['GET', 'POST', 'GET'],
    };

    const pathIndex = Math.floor(Math.random() * pathConfig.paths.length);
    const path = options?.customPath || pathConfig.paths[pathIndex];
    const method = options?.method || pathConfig.methods[pathIndex];

    const isAttack = options?.isAttack || false;
    const ip =
      options?.clientIp ||
      (isAttack
        ? `198.51.100.${Math.floor(Math.random() * 15) + 1}`
        : `${Math.floor(Math.random() * 180) + 20}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`);

    // Check IP Blacklist or Jail
    const isJailed = this.config.blockedIpRecords.some((rec) => rec.ip === ip && rec.blockedUntil > Date.now());
    const isBlacklisted = this.config.blacklistedIps.includes(ip);
    const isWhitelisted = this.config.whitelistedIps.includes(ip);

    let decision: RateLimitDecision = 'allowed';
    let statusCode = 200;

    if (isBlacklisted || isJailed) {
      decision = 'blocked_ddos';
      statusCode = 403;
      this.droppedCount++;
    } else if (!isWhitelisted) {
      // Check Token Bucket
      if (this.config.currentTokens >= 1) {
        this.config.currentTokens -= 1;
        decision = 'allowed';
        statusCode = method === 'POST' ? 201 : 200;
      } else {
        decision = 'rate_limited';
        statusCode = 429;
        this.droppedCount++;

        // If attack detection is on and repeated rate limits occur, jail the IP
        if (this.config.enableL7FloodShield && isAttack) {
          const alreadyJailed = this.config.blockedIpRecords.some((r) => r.ip === ip);
          if (!alreadyJailed) {
            this.config.blockedIpRecords.push({
              ip,
              reason: `L7 flood threshold exceeded (> ${this.config.anomalyThresholdRps} RPS burst)`,
              timestamp: Date.now(),
              blockedUntil: Date.now() + this.config.ipJailDurationSec * 1000,
            });
          }
        }
      }
    }

    // Tunnel and timing calculations
    const edgeProcessingMs = parseFloat((Math.random() * 0.8 + 0.2).toFixed(2));
    const tunnelTransitMs = parseFloat((selectedTunnel.latencyMs * (0.8 + Math.random() * 0.4)).toFixed(1));
    const localServiceMs = decision === 'allowed' ? parseFloat((Math.random() * 12 + 3).toFixed(1)) : 0;
    const durationMs = parseFloat((edgeProcessingMs + tunnelTransitMs + localServiceMs).toFixed(1));

    this.latenciesBuffer.push(durationMs);
    if (this.latenciesBuffer.length > 200) {
      this.latenciesBuffer.shift();
    }

    const bytes = decision === 'allowed' ? Math.floor(Math.random() * 15000) + 850 : 280;

    // Update tunnel stats
    if (selectedTunnel && decision === 'allowed') {
      selectedTunnel.totalRequests++;
      selectedTunnel.bytesIn += Math.floor(bytes * 0.35);
      selectedTunnel.bytesOut += Math.floor(bytes * 0.65);
    }

    const req: TrafficRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      timestamp: Date.now(),
      method,
      path,
      host: `${sub}.edgeproxy.mesh`,
      subdomain: sub,
      clientIp: ip,
      countryCode: isAttack ? 'RU' : COUNTRIES[Math.floor(Math.random() * COUNTRIES.length)],
      userAgent: isAttack ? 'AttackBot/1.0 (Flooder)' : USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)],
      statusCode,
      durationMs,
      edgeProcessingMs,
      tunnelTransitMs,
      localServiceMs,
      bytes,
      protocol: selectedTunnel?.protocol || 'quic',
      tlsCipher: CIPHERS[Math.floor(Math.random() * CIPHERS.length)],
      decision,
      bucketRemainingTokens: Math.floor(this.config.currentTokens),
      bucketCapacity: this.config.capacity,
      requestHeaders: {
        Host: `${sub}.edgeproxy.mesh`,
        'User-Agent': isAttack ? 'AttackBot/1.0' : 'Mozilla/5.0 (Compatible; EdgeMesh)',
        Accept: 'application/json, text/html, */*',
        'X-Forwarded-For': ip,
        'X-Forwarded-Proto': 'https',
        'CF-Visitor': '{"scheme":"https"}',
        'X-Real-IP': ip,
        'Sec-CH-UA': '"Chromium";v="128"',
      },
      responseHeaders: {
        'Content-Type': path.endsWith('.css') ? 'text/css' : path.endsWith('.js') ? 'application/javascript' : 'application/json',
        'X-Edge-Router': 'EdgeProxy/v2.4-mesh',
        'X-RateLimit-Limit': String(this.config.capacity),
        'X-RateLimit-Remaining': String(Math.floor(this.config.currentTokens)),
        'X-RateLimit-Reset': '1',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
        'Server-Timing': `edge;dur=${edgeProcessingMs}, tunnel;dur=${tunnelTransitMs}, app;dur=${localServiceMs}`,
      },
      payloadPreview:
        method === 'POST'
          ? JSON.stringify({ action: 'sync_chunk', clientTime: new Date().toISOString(), sizeBytes: bytes })
          : undefined,
    };

    this.requestsHistory.unshift(req);
    if (this.requestsHistory.length > 150) {
      this.requestsHistory.pop();
    }

    return req;
  }

  public getRecentRequests(limit: number = 50): TrafficRequest[] {
    return this.requestsHistory.slice(0, limit);
  }

  public getTelemetry(): TelemetryMetrics {
    this.refillTokens();
    const recent = this.requestsHistory.slice(0, 30);
    const validDurations = [...this.latenciesBuffer].sort((a, b) => a - b);

    const p50 = validDurations[Math.floor(validDurations.length * 0.5)] || 15;
    const p95 = validDurations[Math.floor(validDurations.length * 0.95)] || 32;
    const p99 = validDurations[Math.floor(validDurations.length * 0.99)] || 64;

    const totalActiveStreams = this.tunnels.reduce((acc, t) => acc + (t.status === 'online' ? t.activeStreams : 0), 0);

    const calcRps = this.isAttackActive
      ? Math.floor(Math.random() * 250) + 380
      : Math.floor(Math.random() * 15) + 24;

    this.currentRpsHistory.push(calcRps);
    if (this.currentRpsHistory.length > 20) {
      this.currentRpsHistory.shift();
    }

    const peakRps = Math.max(...this.currentRpsHistory, 120);

    return {
      currentRps: calcRps,
      peakRps,
      activeConnections: totalActiveStreams * 3 + Math.floor(Math.random() * 8),
      bandwidthInBps: calcRps * 1280,
      bandwidthOutBps: calcRps * 5800,
      p50LatencyMs: parseFloat(p50.toFixed(1)),
      p95LatencyMs: parseFloat(p95.toFixed(1)),
      p99LatencyMs: parseFloat(p99.toFixed(1)),
      droppedRequestsCount: this.droppedCount,
      totalRequestsCount: this.requestCounter,
      edgeCpuPercent: parseFloat((this.isAttackActive ? Math.random() * 12 + 18 : Math.random() * 3 + 4.2).toFixed(1)),
      edgeMemoryMb: parseFloat((48.4 + Math.random() * 3.2).toFixed(1)),
      tunnelJitterMs: parseFloat((Math.random() * 1.5 + 0.4).toFixed(2)),
      packetLossPercent: parseFloat((this.isAttackActive ? 0.08 : 0.01).toFixed(2)),
    };
  }

  public startAttackSimulation(onTick: (req: TrafficRequest) => void) {
    if (this.isAttackActive) return;
    this.isAttackActive = true;

    this.attackInterval = setInterval(() => {
      // Fire 5 rapid attack packets per tick
      for (let i = 0; i < 4; i++) {
        const req = this.generateRequest({
          isAttack: true,
          method: Math.random() > 0.4 ? 'POST' : 'GET',
          customPath: Math.random() > 0.5 ? '/login' : '/api/v1/search?q=' + Math.random(),
        });
        onTick(req);
      }
    }, 100);
  }

  public stopAttackSimulation() {
    this.isAttackActive = false;
    if (this.attackInterval) {
      clearInterval(this.attackInterval);
      this.attackInterval = null;
    }
  }

  public isAttackRunning(): boolean {
    return this.isAttackActive;
  }

  private seedInitialRequests() {
    for (let i = 0; i < 25; i++) {
      this.generateRequest();
    }
  }
}
