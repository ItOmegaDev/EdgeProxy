import { Tunnel, SSLCertificate, RateLimiterConfig, LocalDiscoveryItem } from './types';

export const INITIAL_TUNNELS: Tunnel[] = [
  {
    id: 'tun-cloud-01',
    name: 'Nextcloud Storage & Photos',
    subdomain: 'cloud',
    customDomain: 'cloud.homelab.internal',
    targetHost: '127.0.0.1',
    targetPort: 8080,
    protocol: 'quic',
    status: 'online',
    createdAt: '2026-08-14T10:20:00Z',
    bytesIn: 482910400, // ~482 MB
    bytesOut: 1892049100, // ~1.89 GB
    activeStreams: 14,
    totalRequests: 42190,
    latencyMs: 16.4,
    rateLimit: {
      enabled: true,
      maxRps: 80,
      burst: 120,
    },
    tlsStatus: 'issued',
    auth: {
      enabled: false,
      type: 'none',
    },
    headersRewrite: {
      'X-Forwarded-Proto': 'https',
      'X-Real-IP': '$client_ip',
      'X-Edge-Proxy': 'EdgeProxy/v2.4-mesh',
    },
    tags: ['storage', 'homelab', 'nextcloud'],
  },
  {
    id: 'tun-vite-02',
    name: 'Vite React Web Application',
    subdomain: 'dev-vite',
    targetHost: '127.0.0.1',
    targetPort: 5173,
    protocol: 'http2',
    status: 'online',
    createdAt: '2026-09-01T09:00:00Z',
    bytesIn: 32049100,
    bytesOut: 149200840,
    activeStreams: 8,
    totalRequests: 18450,
    latencyMs: 12.1,
    rateLimit: {
      enabled: true,
      maxRps: 150,
      burst: 200,
    },
    tlsStatus: 'issued',
    auth: {
      enabled: false,
      type: 'none',
    },
    headersRewrite: {
      'X-Forwarded-Proto': 'https',
      'X-Forwarded-Host': '$host',
    },
    tags: ['frontend', 'react', 'vite'],
  },
  {
    id: 'tun-api-03',
    name: 'FastAPI Analytics Backend',
    subdomain: 'api-mesh',
    targetHost: '127.0.0.1',
    targetPort: 8000,
    protocol: 'quic',
    status: 'online',
    createdAt: '2026-09-02T14:30:00Z',
    bytesIn: 189400200,
    bytesOut: 432091000,
    activeStreams: 22,
    totalRequests: 95400,
    latencyMs: 19.8,
    rateLimit: {
      enabled: true,
      maxRps: 60,
      burst: 90,
    },
    tlsStatus: 'issued',
    auth: {
      enabled: true,
      type: 'token',
      token: 'mesh_sec_9941a87b',
    },
    headersRewrite: {
      'X-Edge-Cluster': 'edge-eu-central-1',
    },
    tags: ['api', 'python', 'analytics'],
  },
  {
    id: 'tun-mc-04',
    name: 'Minecraft SMP Dedicated Game Server',
    subdomain: 'mc-smp',
    targetHost: '127.0.0.1',
    targetPort: 25565,
    protocol: 'tcp',
    status: 'online',
    createdAt: '2026-09-04T18:00:00Z',
    bytesIn: 94030040,
    bytesOut: 810290000,
    activeStreams: 18,
    totalRequests: 12040,
    latencyMs: 24.2,
    rateLimit: {
      enabled: true,
      maxRps: 100,
      burst: 150,
    },
    tlsStatus: 'issued',
    auth: {
      enabled: false,
      type: 'none',
    },
    headersRewrite: {},
    tags: ['game', 'tcp', 'minecraft'],
  },
];

export const INITIAL_RATE_LIMITER: RateLimiterConfig = {
  algorithm: 'token_bucket',
  capacity: 100,
  refillRate: 35,
  currentTokens: 92,
  ipJailDurationSec: 60,
  anomalyThresholdRps: 200,
  enableSynFloodShield: true,
  enableL7FloodShield: true,
  enableGeoBlocking: false,
  whitelistedIps: ['127.0.0.1', '192.168.1.0/24', '10.8.0.0/16'],
  blacklistedIps: ['185.220.101.5', '194.26.29.112'],
  blockedIpRecords: [
    {
      ip: '185.220.101.5',
      reason: 'Layer 7 HTTP Flood anomaly (> 280 RPS on /login)',
      timestamp: Date.now() - 142000,
      blockedUntil: Date.now() + 180000,
    },
    {
      ip: '194.26.29.112',
      reason: 'SYN flood pattern & rapid connection reset abuse',
      timestamp: Date.now() - 95000,
      blockedUntil: Date.now() + 240000,
    },
  ],
};

export const INITIAL_CERTS: SSLCertificate[] = [
  {
    id: 'cert-wildcard-mesh',
    domain: '*.edgeproxy.mesh',
    wildcard: true,
    issuer: "Let's Encrypt Authority X3 / E1",
    status: 'valid',
    validFrom: '2026-08-01',
    validTo: '2026-10-30',
    daysRemaining: 52,
    challengeType: 'DNS-01',
    sanList: ['*.edgeproxy.mesh', 'edgeproxy.mesh', '*.localmesh.link'],
    ocspStapled: true,
    fingerprint: 'SHA256: 7B:3F:A9:11:04:E2:9B:6C:84:12:DE:59:71:2A:9C:E4',
    autoRenew: true,
  },
  {
    id: 'cert-homelab-custom',
    domain: 'cloud.homelab.internal',
    wildcard: false,
    issuer: "Let's Encrypt Authority E1",
    status: 'valid',
    validFrom: '2026-08-15',
    validTo: '2026-11-13',
    daysRemaining: 66,
    challengeType: 'HTTP-01',
    sanList: ['cloud.homelab.internal'],
    ocspStapled: true,
    fingerprint: 'SHA256: 41:E8:C2:55:99:A0:D3:B1:77:24:F0:1A:89:D2:C3:FF',
    autoRenew: true,
  },
];

export const DISCOVERED_LOCAL_SERVICES: LocalDiscoveryItem[] = [
  {
    id: 'disc-1',
    port: 8080,
    name: 'Nextcloud Docker Container',
    process: 'docker-proxy [php-fpm]',
    serviceType: 'Nextcloud',
    isTunneled: true,
    suggestedSubdomain: 'cloud',
  },
  {
    id: 'disc-2',
    port: 5173,
    name: 'Vite Dev Server (HMR)',
    process: 'node node_modules/vite/bin/vite.js',
    serviceType: 'Vite Dev',
    isTunneled: true,
    suggestedSubdomain: 'dev-vite',
  },
  {
    id: 'disc-3',
    port: 8000,
    name: 'FastAPI Backend Worker',
    process: 'uvicorn main:app --reload',
    serviceType: 'FastAPI',
    isTunneled: true,
    suggestedSubdomain: 'api-mesh',
  },
  {
    id: 'disc-4',
    port: 8123,
    name: 'Home Assistant Core',
    process: 'hass -c /config',
    serviceType: 'Home Assistant',
    isTunneled: false,
    suggestedSubdomain: 'home-assistant',
  },
  {
    id: 'disc-5',
    port: 11434,
    name: 'Ollama Local LLM Inference Engine',
    process: 'ollama serve',
    serviceType: 'Node API',
    isTunneled: false,
    suggestedSubdomain: 'ollama-ai',
  },
  {
    id: 'disc-6',
    port: 25565,
    name: 'PaperMC Minecraft Server',
    process: 'java -Xms4G -jar paper.jar',
    serviceType: 'Minecraft',
    isTunneled: true,
    suggestedSubdomain: 'mc-smp',
  },
];

export const INITIAL_DB_USERS = [
  {
    id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    email: 'developer@homelab.dev',
    api_key_hash: '$2b$12$e9X6jIe0L4VzD1KzNPpM9OQeF9wT1.9H7zO3wF1Z8A1b2c3d4e5f6',
    created_at: '2026-08-01T10:00:00Z',
  },
  {
    id: 'b1ffcd00-8d1a-4fe7-aa5c-7cc8ae491b22',
    email: 'team-ops@edgeproxy.mesh',
    api_key_hash: '$2b$12$r7Y8kJf1M5WzE2LzOQqN0PReG0xU2.0I8zP4xG2A9B2c3d4e5f6g7',
    created_at: '2026-08-10T14:30:00Z',
  },
];

export const INITIAL_DB_TUNNELS = [
  {
    id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    subdomain: 'cloud',
    auth_token_hash: '$argon2id$v=19$m=65536,t=3,p=4$dGVzdF9zYWx0$9xK...',
    is_active: true,
    max_rate_limit: 80,
    created_at: '2026-08-14T10:20:00Z',
  },
  {
    id: 'e36ab09a-47bb-4261-9456-1d01a1b2c368',
    user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    subdomain: 'dev-vite',
    auth_token_hash: '$argon2id$v=19$m=65536,t=3,p=4$dGVzdF9zYWx0$8wJ...',
    is_active: true,
    max_rate_limit: 150,
    created_at: '2026-09-01T09:00:00Z',
  },
  {
    id: 'd259a989-36aa-4150-8345-0c9090a1b257',
    user_id: 'b1ffcd00-8d1a-4fe7-aa5c-7cc8ae491b22',
    subdomain: 'api-mesh',
    auth_token_hash: '$argon2id$v=19$m=65536,t=3,p=4$dGVzdF9zYWx0$7vI...',
    is_active: true,
    max_rate_limit: 60,
    created_at: '2026-09-02T14:30:00Z',
  },
  {
    id: 'c1489878-2599-4049-7234-9b8f8f90a146',
    user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    subdomain: 'mc-smp',
    auth_token_hash: '$argon2id$v=19$m=65536,t=3,p=4$dGVzdF9zYWx0$6uH...',
    is_active: true,
    max_rate_limit: 100,
    created_at: '2026-09-04T18:00:00Z',
  },
];

export const INITIAL_DB_LOGS = [
  {
    id: 1001,
    tunnel_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    subdomain: 'cloud',
    client_ip: '93.175.204.12',
    http_method: 'GET',
    path: '/remote.php/webdav/Photos/DSC_0921.jpg',
    status_code: 200,
    latency_ms: 18,
    bytes_sent: 491200,
    timestamp: '2026-09-08T07:58:20Z',
  },
  {
    id: 1002,
    tunnel_id: 'e36ab09a-47bb-4261-9456-1d01a1b2c368',
    subdomain: 'dev-vite',
    client_ip: '178.62.199.45',
    http_method: 'GET',
    path: '/src/main.tsx',
    status_code: 200,
    latency_ms: 11,
    bytes_sent: 2450,
    timestamp: '2026-09-08T07:58:35Z',
  },
  {
    id: 1003,
    tunnel_id: 'd259a989-36aa-4150-8345-0c9090a1b257',
    subdomain: 'api-mesh',
    client_ip: '185.220.101.5',
    http_method: 'POST',
    path: '/v1/inference/models',
    status_code: 429,
    latency_ms: 1,
    bytes_sent: 280,
    timestamp: '2026-09-08T07:59:01Z',
  },
  {
    id: 1004,
    tunnel_id: 'c1489878-2599-4049-7234-9b8f8f90a146',
    subdomain: 'mc-smp',
    client_ip: '194.44.20.89',
    http_method: 'GET',
    path: '/tcp/ping',
    status_code: 200,
    latency_ms: 22,
    bytes_sent: 1024,
    timestamp: '2026-09-08T07:59:15Z',
  },
  {
    id: 1005,
    tunnel_id: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
    subdomain: 'cloud',
    client_ip: '93.175.204.12',
    http_method: 'PUT',
    path: '/remote.php/webdav/Documents/report.pdf',
    status_code: 201,
    latency_ms: 29,
    bytes_sent: 184500,
    timestamp: '2026-09-08T07:59:40Z',
  },
];

export const INITIAL_BINARY_FRAMES = [
  {
    id: 'frame-1',
    timestamp: Date.now() - 4500,
    streamId: 101,
    frameType: 'SYN' as const,
    frameTypeCode: 0x01,
    payloadLength: 58,
    payloadData: 'CONNECT cloud.edgeproxy.mesh:443 HTTP/2\r\nX-Stream-ID: 101\r\n',
    hexDump: '00 00 00 65  01  00 00 00 3A  43 4F 4E 4E 45 43 54 20 63 6C 6F 75 64',
    source: 'edge_gateway' as const,
  },
  {
    id: 'frame-2',
    timestamp: Date.now() - 3800,
    streamId: 101,
    frameType: 'DATA' as const,
    frameTypeCode: 0x02,
    payloadLength: 124,
    payloadData: 'GET /status.php HTTP/1.1\r\nHost: cloud.edgeproxy.mesh\r\nUser-Agent: Mozilla/5.0\r\n\r\n',
    hexDump: '00 00 00 65  02  00 00 00 7C  47 45 54 20 2F 73 74 61 74 75 73 2E 70',
    source: 'edge_gateway' as const,
  },
  {
    id: 'frame-3',
    timestamp: Date.now() - 3100,
    streamId: 102,
    frameType: 'SYN' as const,
    frameTypeCode: 0x01,
    payloadLength: 55,
    payloadData: 'CONNECT dev-vite.edgeproxy.mesh:443 HTTP/2\r\n',
    hexDump: '00 00 00 66  01  00 00 00 37  43 4F 4E 4E 45 43 54 20 64 65 76 2D 76',
    source: 'edge_gateway' as const,
  },
  {
    id: 'frame-4',
    timestamp: Date.now() - 2500,
    streamId: 101,
    frameType: 'DATA' as const,
    frameTypeCode: 0x02,
    payloadLength: 86,
    payloadData: 'HTTP/1.1 200 OK\r\nContent-Type: application/json\r\n\r\n{"installed":true,"version":"29.0.4"}',
    hexDump: '00 00 00 65  02  00 00 00 56  48 54 54 50 2F 31 2E 31 20 32 30 30 20',
    source: 'local_agent' as const,
  },
  {
    id: 'frame-5',
    timestamp: Date.now() - 1900,
    streamId: 101,
    frameType: 'FIN' as const,
    frameTypeCode: 0x03,
    payloadLength: 0,
    payloadData: '[Stream Terminated Normally / EOF]',
    hexDump: '00 00 00 65  03  00 00 00 00',
    source: 'edge_gateway' as const,
  },
  {
    id: 'frame-6',
    timestamp: Date.now() - 900,
    streamId: 0,
    frameType: 'PING' as const,
    frameTypeCode: 0x04,
    payloadLength: 16,
    payloadData: 'HEARTBEAT_14_2MS',
    hexDump: '00 00 00 00  04  00 00 00 10  48 45 41 52 54 42 45 41 54 5F 31 34 5F',
    source: 'local_agent' as const,
  },
];

export const ROADMAP_STAGES = [
  {
    step: 1,
    nameUa: 'Мережеве ядро (Базовий TCP/HTTP Проксі)',
    nameEn: 'Network Core (Basic TCP/HTTP Proxy)',
    subtitleUa: 'Створення базового сервера на порту 80/443, читання заголовка Host та перенаправлення сирих байтів (Raw TCP)',
    subtitleEn: 'High-throughput async listener, Host header inspection & zero-copy socket forwarding',
    status: 'completed' as const,
    keyComponents: [
      'Async IO Loop (epoll/kqueue) з підтримкою 10,000+ відкритих сокетів',
      'Парсер першого HTTP чанку для вилучення заголовка "Host: subdomain.domain.com"',
      'Маршрутизація сирих байтів (splice / zero-copy syscalls)',
    ],
    codeSampleTitle: 'Rust Tokio / Go Core - Ingress Host Listener',
    codeSampleLanguage: 'rust',
    codeSample: `// Edge Gateway: Ingress Listener (Tokio Async TCP)
use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind("0.0.0.0:80").await?;
    println!("Edge Ingress listening on :80");

    loop {
        let (mut client_socket, _) = listener.accept().await?;
        tokio::spawn(async move {
            let mut buf = [0u8; 1024];
            let n = client_socket.peek(&mut buf).await.unwrap_or(0);
            
            // Extract Host: header without consuming stream
            let req_str = String::from_utf8_lossy(&buf[..n]);
            if let Some(host) = extract_host(&req_str) {
                // Route stream to target agent session
                route_to_session(&host, client_socket).await;
            }
        });
    }
}`,
    benchmarks: [
      { label: 'Throughput', value: '185,000 RPS' },
      { label: 'p99 Latency', value: '0.45 ms' },
      { label: 'Memory Footprint', value: '14.2 MB' },
    ],
  },
  {
    step: 2,
    nameUa: 'Протокол зв\'язку (Тунелювання та Мультиплексування)',
    nameEn: 'Communication Protocol (Tunneling & Multiplexing)',
    subtitleUa: 'Кадрований (framed) бінарний протокол поверх одного з\'єднання (1 TCP/UDP = N віртуальних потоків)',
    subtitleEn: 'Framed binary protocol over single socket, eliminating handshake latency for every request',
    status: 'completed' as const,
    keyComponents: [
      'Binary Framing: Stream ID (4B) | Type (1B) | Length (4B) | Payload (N Bytes)',
      'Frame types: 0x01 (SYN), 0x02 (DATA), 0x03 (FIN), 0x04 (PING)',
      'Demux Engine на боці Local Agent для прокидання в localhost:3000',
    ],
    codeSampleTitle: 'Binary Frame Encoder & Multiplexer Parser',
    codeSampleLanguage: 'typescript',
    codeSample: `// Frame Structure (9 Bytes Header + N Bytes Payload)
// [Stream ID: 4B u32] [Frame Type: 1B u8] [Length: 4B u32] [Payload: N Bytes]

export function packFrame(streamId: number, type: number, payload: Uint8Array): Uint8Array {
  const frame = new Uint8Array(9 + payload.length);
  const view = new DataView(frame.buffer);
  
  view.setUint32(0, streamId, false); // Big Endian u32
  view.setUint8(4, type);              // 0x01 SYN, 0x02 DATA, 0x03 FIN, 0x04 PING
  view.setUint32(5, payload.length, false);
  frame.set(payload, 9);
  
  return frame;
}

export function unpackFrame(buffer: Uint8Array) {
  const view = new DataView(buffer.buffer);
  return {
    streamId: view.getUint32(0, false),
    frameType: view.getUint8(4),
    payloadLength: view.getUint32(5, false),
    payload: buffer.slice(9, 9 + view.getUint32(5, false))
  };
}`,
    benchmarks: [
      { label: 'Multiplex Ratio', value: '1 Socket : 2,500 Streams' },
      { label: 'Framing Overhead', value: '< 9 bytes/pkt' },
      { label: 'Demux Latency', value: '0.08 ms' },
    ],
  },
  {
    step: 3,
    nameUa: 'Безпека (SSL/TLS та ACME Інтеграція)',
    nameEn: 'Security (SSL/TLS & ACME Integration)',
    subtitleUa: 'Автоматичний випуск Let\'s Encrypt (TLS-ALPN-01 / HTTP-01), Hot-Reloading без простою та mTLS клієнта',
    subtitleEn: 'Seamless certificate issuance via Let\'s Encrypt ACME v2, in-memory vault, and mTLS tunnel authentication',
    status: 'completed' as const,
    keyComponents: [
      'ACME v2 Engine: підтримка TLS-ALPN-01 та HTTP-01 челенджів',
      'In-memory кешування сертифікатів із шифрованим дисковим сховищем',
      'mTLS (Mutual TLS) або JWT token handshake для автентифікації клієнта',
    ],
    codeSampleTitle: 'Auto ACME v2 TLS-ALPN-01 Certificate Handler',
    codeSampleLanguage: 'go',
    codeSample: `// Edge Gateway: Automated ACME Let's Encrypt Provider
package main

import (
    "crypto/tls"
    "golang.org/x/crypto/acme/autocert"
    "net/http"
)

func createSecureTLSConfig(domain string) *tls.Config {
    certManager := autocert.Manager{
        Prompt:     autocert.AcceptTOS,
        HostPolicy: autocert.HostWhitelist(domain, "*." + domain),
        Cache:      autocert.DirCache("/var/edgeproxy/certs"),
    }

    return &tls.Config{
        GetCertificate: certManager.GetCertificate,
        NextProtos:     []string{"h2", "http/1.1", "acme-tls/1"},
        MinVersion:     tls.VersionTLS13,
    }
}`,
    benchmarks: [
      { label: 'TLS Handshake', value: '1 RTT (TLS 1.3)' },
      { label: 'Cert Hot-Reload', value: '0.00 ms (Zero Downtime)' },
      { label: 'Cipher Suite', value: 'ChaCha20-Poly1305' },
    ],
  },
  {
    step: 4,
    nameUa: 'Стабільність (Rate Limiting та захист від сплесків)',
    nameEn: 'Stability (Rate Limiting & DDoS Shield)',
    subtitleUa: 'Алгоритм Token Bucket у пам\'яті та Redis, виявлення аномальних спайків і авто-карантин ботнетів',
    subtitleEn: 'High-speed Token Bucket / Sliding Window rate limiting, Redis replication & automatic IP jail',
    status: 'completed' as const,
    keyComponents: [
      'Token Bucket / Sliding Window лічильники на lock-free структурах даних',
      'Redis Distributed State для масштабування на кластер Edge-нод',
      'Автоматичне повернення 429 Too Many Requests без навантаження на тунель',
      'IP Jail / Blacklist з таймером блокування при перевищенні порогу',
    ],
    codeSampleTitle: 'Atomic Token Bucket Filter (Redis / Local Memory)',
    codeSampleLanguage: 'rust',
    codeSample: `// Lock-free In-Memory Token Bucket in Rust
pub struct TokenBucket {
    capacity: f64,
    refill_rate: f64,
    tokens: AtomicU64, // fixed-point scaled
    last_update: AtomicU64,
}

impl TokenBucket {
    pub fn try_acquire(&self, cost: f64) -> bool {
        let now = current_timestamp_micros();
        // Atomic refill calculation & CAS loop
        if current_tokens >= cost {
            self.consume(cost);
            true // Allow packet
        } else {
            false // Drop or return 429 Too Many Requests
        }
    }
}`,
    benchmarks: [
      { label: 'Check Rate Limit', value: '< 15 nanoseconds' },
      { label: 'Redis Atomic Eval', value: '0.12 ms' },
      { label: 'Mitigated Attack', value: 'Up to 500,000 RPS' },
    ],
  },
  {
    step: 5,
    nameUa: 'UI/UX (CLI та Веб-панель Аналітики)',
    nameEn: 'UI/UX (CLI & Real-time Analytics Dashboard)',
    subtitleUa: 'Зручний CLI-клієнт (`edgeproxy tunnel 3000 --subdomain myapp`) та веб-панель з графіками latency, RPS та логами',
    subtitleEn: 'Ergonomic zero-dependency CLI agent and real-time dashboard with latency waterfall and packet inspection',
    status: 'completed' as const,
    keyComponents: [
      'CLI агент з автовиявленням відкритих локальних портів',
      'Веб-панель на базі React / Next.js, Tailwind CSS, графіків та телеметрії',
      'Terminal UI (TUI) режим для моніторингу прямо з сервера через SSH',
      'Інспектор трафіку з можливістю Replay Request для розробників',
    ],
    codeSampleTitle: 'Local Agent CLI Runner (Go / TypeScript)',
    codeSampleLanguage: 'go',
    codeSample: `// Local CLI Agent: Expose local port to Edge Mesh
package main

import (
    "flag"
    "fmt"
    "github.com/edgeproxy/mesh-agent/tunnel"
)

func main() {
    port := flag.Int("port", 3000, "Local port to expose")
    subdomain := flag.String("subdomain", "myapp", "Subdomain on edgeproxy.mesh")
    flag.Parse()

    fmt.Printf("🚀 Connecting localhost:%d -> https://%s.edgeproxy.mesh\n", *port, *subdomain)
    client := tunnel.NewClient("vps.edgeproxy.mesh:443", *subdomain, *port)
    client.RunMultiplexLoop()
}`,
    benchmarks: [
      { label: 'CLI Binary Size', value: '8.4 MB (Statically linked)' },
      { label: 'Dashboard Latency', value: '< 16ms refresh' },
      { label: 'CLI Startup Time', value: '< 25 ms' },
    ],
  },
];
