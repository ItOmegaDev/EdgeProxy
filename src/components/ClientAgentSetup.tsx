import React, { useState } from 'react';
import { 
  DownloadCloud, 
  Terminal, 
  Copy, 
  Check, 
  FileCode, 
  Server, 
  Layers, 
  ExternalLink,
  Code2,
  HardDrive,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';
import { ProtocolType } from '../types';

interface ClientAgentSetupProps {
  language: 'ua' | 'en';
}

export const ClientAgentSetup: React.FC<ClientAgentSetupProps> = ({ language }) => {
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [selectedTab, setSelectedTab] = useState<'cli' | 'yaml' | 'docker' | 'systemd'>('cli');

  // Interactive CLI builder state
  const [cliPort, setCliPort] = useState(8080);
  const [cliSubdomain, setCliSubdomain] = useState('cloud');
  const [cliProtocol, setCliProtocol] = useState<ProtocolType>('quic');

  const t = {
    ua: {
      title: 'Встановлення CLI Агента та Розгортання Edge Node',
      subtitle: 'Готові до виконання команди, конфігураційні файли та Docker Compose для вашого VPS і локальної машини',
      tabCli: 'CLI Команди (Локально)',
      tabYaml: 'Конфіг edgeproxy.yaml',
      tabDocker: 'Docker Compose (Edge Gateway)',
      tabSystemd: 'Linux Systemd Daemon',
      quickInstall: 'Швидке встановлення CLI агента (Linux / macOS / Windows):',
      builderTitle: 'Інтерактивний Генератор Команд:',
      portLabel: 'Локальний порт:',
      subdomainLabel: 'Бажаний піддомен:',
      protocolLabel: 'Протокол тунелю:',
      generatedCommand: 'Згенерована команда для запуску тунелю:',
      copyBtn: 'Скопіювати',
      copied: 'Скопійовано!',
      localApiTitle: 'Вбудований локальний REST API агента (127.0.0.1:4040):',
      localApiDesc: 'Агент автоматично піднімає локальний ендпоінт для перевірки стану та інтеграції з локальними скриптами',
      dockerDesc: 'Розгортання VPS Gateway: Запускає високопродуктивний Edge Router на Go/Rust, Redis для рейт-лімітів та ACME CertBot',
    },
    en: {
      title: 'Client Agent Setup & Edge Node Deployment',
      subtitle: 'Ready-to-run commands, configuration manifests, and Docker Compose for VPS Gateway and local dev machine',
      tabCli: 'CLI Commands (Local)',
      tabYaml: 'Config edgeproxy.yaml',
      tabDocker: 'Docker Compose (VPS Gateway)',
      tabSystemd: 'Linux Systemd Daemon',
      quickInstall: 'Quick Install CLI Agent (Linux / macOS / Windows):',
      builderTitle: 'Interactive CLI Command Builder:',
      portLabel: 'Local Port:',
      subdomainLabel: 'Subdomain:',
      protocolLabel: 'Tunnel Protocol:',
      generatedCommand: 'Generated Command to Expose Local Port:',
      copyBtn: 'Copy',
      copied: 'Copied!',
      localApiTitle: 'Built-in Local REST API (127.0.0.1:4040):',
      localApiDesc: 'Local daemon exposes lightweight endpoints to inspect tunnel state, latency and active streams',
      dockerDesc: 'VPS Gateway Deploy: Runs the Go/Rust High-Performance Edge Router, Redis for Token Bucket state, and ACME CertBot',
    },
  }[language];

  const handleCopy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const cliCommand = `edgeproxy tunnel ${cliPort} --subdomain ${cliSubdomain} --protocol ${cliProtocol} --edge-server vps.edgeproxy.mesh:443`;

  const yamlConfig = `# edgeproxy.yaml - Client Agent Configuration
version: "2.4"

edge_gateway:
  host: "vps.edgeproxy.mesh"
  port: 443
  tls: true
  protocol: "${cliProtocol}"
  auth_token: "mesh_sec_9941a87b4012f"
  keepalive_interval: 15s

auto_discovery:
  enabled: true
  scan_ports: [3000, 5173, 8000, 8080, 8123, 25565]
  scan_interval: 30s

tunnels:
  - name: "Nextcloud Storage"
    subdomain: "cloud"
    local_target: "127.0.0.1:8080"
    protocol: "quic"
    rate_limit:
      max_rps: 80
      burst: 120

  - name: "Vite Dev Server"
    subdomain: "dev-vite"
    local_target: "127.0.0.1:5173"
    protocol: "http2"

  - name: "FastAPI Analytics"
    subdomain: "api-mesh"
    local_target: "127.0.0.1:8000"
    protocol: "quic"
    auth:
      type: "bearer"
      token: "secret_token_123"

telemetry:
  local_dashboard_port: 4040
  log_level: "info"
`;

  const dockerCompose = `# docker-compose.yml - VPS / Cloud Edge Gateway Deployment
# Run on any $4/mo Linux VPS (Hetzner, DigitalOcean, OVH)
version: '3.8'

services:
  edgeproxy-gateway:
    image: ghcr.io/edgeproxy/gateway:latest
    container_name: edgeproxy_edge_node
    restart: unless-stopped
    ports:
      - "80:80"       # HTTP-01 ACME Challenge
      - "443:443/tcp" # HTTPS TLS Termination & HTTP/2
      - "443:443/udp" # HTTP/3 QUIC Ingress
    environment:
      - EDGE_DOMAIN=edgeproxy.mesh
      - ACME_EMAIL=admin@edgeproxy.mesh
      - REDIS_URL=redis://redis:6379
      - TOKEN_BUCKET_CAPACITY=100
      - TOKEN_BUCKET_REFILL_RATE=35
      - ENABLE_L7_FLOOD_SHIELD=true
    volumes:
      - ./certs:/etc/edgeproxy/certs
      - ./config:/etc/edgeproxy/config
    depends_on:
      - redis
    ulimits:
      nofile:
        soft: 65536
        hard: 65536

  redis:
    image: redis:7-alpine
    container_name: edgeproxy_redis
    restart: unless-stopped
    command: redis-server --appendonly yes --maxmemory 128mb --maxmemory-policy allkeys-lru
    volumes:
      - redis-data:/data

volumes:
  redis-data:
`;

  const systemdService = `# /etc/systemd/system/edgeproxy.service
[Unit]
Description=EdgeProxy Client Agent Tunnel Daemon
After=network.target network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
ExecStart=/usr/local/bin/edgeproxy daemon --config /etc/edgeproxy/edgeproxy.yaml
Restart=always
RestartSec=5s
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
`;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/80 border border-zinc-800 p-5 rounded-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <DownloadCloud className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight font-mono">{t.title}</h1>
          </div>
          <p className="text-sm text-zinc-400 mt-1">{t.subtitle}</p>
        </div>
      </div>

      {/* 1-Click Install Script Bar */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5 space-y-3 font-mono text-xs">
        <div className="flex items-center justify-between">
          <span className="text-zinc-300 font-bold">{t.quickInstall}</span>
          <span className="text-[10px] text-zinc-500">Go / Rust Standalone Binary (No dependencies)</span>
        </div>

        <div className="flex items-center justify-between bg-zinc-900 border border-zinc-800 rounded-lg p-3">
          <code className="text-emerald-400 select-all">
            curl -sSL https://get.edgeproxy.mesh | bash
          </code>
          <button
            onClick={() => handleCopy('install', 'curl -sSL https://get.edgeproxy.mesh | bash')}
            className="flex items-center gap-1 px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
          >
            {copiedKey === 'install' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span>{copiedKey === 'install' ? t.copied : t.copyBtn}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1 text-[11px] text-zinc-400">
          <div>• macOS: <code className="text-zinc-300">brew install edgeproxy/tap/mesh</code></div>
          <div>• Windows: <code className="text-zinc-300">winget install EdgeProxy.MeshAgent</code></div>
        </div>
      </div>

      {/* Tab Switcher: CLI vs YAML vs Docker vs Systemd */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-2 font-mono text-xs overflow-x-auto scrollbar-none">
        <button
          onClick={() => setSelectedTab('cli')}
          className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
            selectedTab === 'cli'
              ? 'bg-emerald-600 text-white font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-850'
          }`}
        >
          {t.tabCli}
        </button>

        <button
          onClick={() => setSelectedTab('yaml')}
          className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
            selectedTab === 'yaml'
              ? 'bg-emerald-600 text-white font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-850'
          }`}
        >
          {t.tabYaml}
        </button>

        <button
          onClick={() => setSelectedTab('docker')}
          className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
            selectedTab === 'docker'
              ? 'bg-emerald-600 text-white font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-850'
          }`}
        >
          {t.tabDocker}
        </button>

        <button
          onClick={() => setSelectedTab('systemd')}
          className={`px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap ${
            selectedTab === 'systemd'
              ? 'bg-emerald-600 text-white font-bold'
              : 'text-zinc-400 hover:text-white hover:bg-zinc-850'
          }`}
        >
          {t.tabSystemd}
        </button>
      </div>

      {/* Tab Content */}
      {selectedTab === 'cli' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 space-y-4 font-mono text-xs">
          <h3 className="font-bold text-white text-sm">{t.builderTitle}</h3>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-zinc-400 mb-1">{t.portLabel}</label>
              <input
                type="number"
                value={cliPort}
                onChange={(e) => setCliPort(Number(e.target.value))}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">{t.subdomainLabel}</label>
              <input
                type="text"
                value={cliSubdomain}
                onChange={(e) => setCliSubdomain(e.target.value)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div>
              <label className="block text-zinc-400 mb-1">{t.protocolLabel}</label>
              <select
                value={cliProtocol}
                onChange={(e) => setCliProtocol(e.target.value as ProtocolType)}
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white uppercase focus:outline-none focus:border-emerald-500"
              >
                <option value="quic">QUIC (HTTP/3)</option>
                <option value="http2">HTTP/2</option>
                <option value="ws">WebSocket</option>
                <option value="tcp">Raw TCP</option>
              </select>
            </div>
          </div>

          <div>
            <span className="block text-zinc-400 mb-1">{t.generatedCommand}</span>
            <div className="flex items-center justify-between bg-zinc-950 border border-zinc-800 rounded-lg p-3">
              <code className="text-emerald-400 break-all">{cliCommand}</code>
              <button
                onClick={() => handleCopy('cmd', cliCommand)}
                className="flex items-center gap-1 px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 ml-2 flex-shrink-0 transition-colors"
              >
                {copiedKey === 'cmd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiedKey === 'cmd' ? t.copied : t.copyBtn}</span>
              </button>
            </div>
          </div>

          {/* Local REST API Box */}
          <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800/80 space-y-2 text-[11px]">
            <span className="font-bold text-teal-300 block">{t.localApiTitle}</span>
            <p className="text-zinc-400">{t.localApiDesc}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-zinc-300">
              <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                <span className="text-emerald-400 font-bold">GET</span> /api/tunnels
              </div>
              <div className="bg-zinc-900 p-2 rounded border border-zinc-800">
                <span className="text-emerald-400 font-bold">GET</span> /api/healthz (latency & streams)
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedTab === 'yaml' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white">/etc/edgeproxy/edgeproxy.yaml</span>
            <button
              onClick={() => handleCopy('yaml', yamlConfig)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              {copiedKey === 'yaml' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey === 'yaml' ? t.copied : t.copyBtn}</span>
            </button>
          </div>
          <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg overflow-x-auto text-emerald-300 leading-relaxed max-h-96">
            {yamlConfig}
          </pre>
        </div>
      )}

      {selectedTab === 'docker' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white">VPS Gateway Docker Deployment</span>
            <button
              onClick={() => handleCopy('docker', dockerCompose)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              {copiedKey === 'docker' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey === 'docker' ? t.copied : t.copyBtn}</span>
            </button>
          </div>
          <p className="text-zinc-400 text-[11px]">{t.dockerDesc}</p>
          <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg overflow-x-auto text-sky-300 leading-relaxed max-h-96">
            {dockerCompose}
          </pre>
        </div>
      )}

      {selectedTab === 'systemd' && (
        <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 space-y-3 font-mono text-xs">
          <div className="flex items-center justify-between">
            <span className="font-bold text-white">/etc/systemd/system/edgeproxy.service</span>
            <button
              onClick={() => handleCopy('systemd', systemdService)}
              className="flex items-center gap-1 px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
            >
              {copiedKey === 'systemd' ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copiedKey === 'systemd' ? t.copied : t.copyBtn}</span>
            </button>
          </div>
          <pre className="bg-zinc-950 border border-zinc-800 p-4 rounded-lg overflow-x-auto text-amber-300 leading-relaxed max-h-96">
            {systemdService}
          </pre>
        </div>
      )}
    </div>
  );
};
