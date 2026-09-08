import { RoadmapStage, RateLimiterConfig } from '../types';

export const INITIAL_RATE_LIMITER: RateLimiterConfig = {
  algorithm: 'token_bucket',
  capacity: 100,
  refillRate: 50,
  currentTokens: 100,
  ipJailDurationSec: 60,
  anomalyThresholdRps: 200,
  enableSynFloodShield: true,
  enableL7FloodShield: true,
  enableGeoBlocking: false,
  whitelistedIps: ['127.0.0.1', '::1'],
  blacklistedIps: [],
  blockedIpRecords: [],
};

export const ROADMAP_STAGES: RoadmapStage[] = [
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
    subtitleUa: 'Зручний CLI-клієнт (\`edgeproxy tunnel 3000 --subdomain myapp\`) та веб-панель з графіками latency, RPS та логами',
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

    fmt.Printf("🚀 Connecting localhost:%d -> https://%s.edgeproxy.mesh\\n", *port, *subdomain)
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
