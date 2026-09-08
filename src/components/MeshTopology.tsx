import React, { useState } from 'react';
import { 
  Globe, 
  ShieldCheck, 
  Lock, 
  Cpu, 
  HardDrive, 
  ArrowDown, 
  Wifi, 
  Activity, 
  CheckCircle2, 
  Layers, 
  Zap, 
  ExternalLink,
  ChevronRight,
  Sparkles
} from 'lucide-react';
import { TelemetryMetrics, Tunnel, ProtocolType } from '../types';

interface MeshTopologyProps {
  telemetry: TelemetryMetrics;
  tunnels: Tunnel[];
  language: 'ua' | 'en';
  onNavigateToTab: (tab: string) => void;
}

export const MeshTopology: React.FC<MeshTopologyProps> = ({
  telemetry,
  tunnels,
  language,
  onNavigateToTab,
}) => {
  const [selectedProtocol, setSelectedProtocol] = useState<ProtocolType>('quic');
  const [natTestStatus, setNatTestStatus] = useState<'idle' | 'testing' | 'success'>('idle');
  const [activeTraceStep, setActiveTraceStep] = useState<number | null>(null);
  const [isTracing, setIsTracing] = useState<boolean>(false);

  const t = {
    ua: {
      title: 'Архітектура Traffic Mesh та Маршрутизація',
      subtitle: 'Розподілений Edge Router на базі Go/Rust з тунелюванням крізь NAT для локальних сервісів',
      clientTitle: 'Клієнти в глобальному інтернеті',
      clientDesc: 'HTTP/1.1, HTTP/2, HTTP/3 (QUIC) запити з усього світу, браузери, мобільні додатки та API споживачі',
      edgeTitle: 'VPS / Cloud Gateway (Edge Node)',
      edgeLocation: 'Frankfurt, Німеччина (IP: 159.65.120.48)',
      edgeFeature1: 'Traffic Router: Rust/Go Core (Epoll / async I/O, C10K concurrency)',
      edgeFeature2: 'TLS Termination: Автоматичний випуск Let\'s Encrypt Wildcard (*.edgeproxy.mesh)',
      edgeFeature3: 'DDoS Shield & Rate Limiter: Алгоритм Token Bucket на базі In-Memory/Redis',
      tunnelTitle: 'Зашифрований Мультиплексований Тунель',
      natTraversal: 'NAT Traversal: Пробиття сірого IP (UDP Hole Punching / STUN)',
      streamMultiplexing: 'Мультиплексування 1000+ віртуальних потоків через одне з\'єднання',
      localTitle: 'Локальна машина розробника (Client Agent)',
      localDesc: 'Домашній сервер, ноутбук або Raspberry Pi без білої публічної IP-адреси',
      localFeature1: 'Local Proxy Agent (CLI бінарник без зайвих залежностей)',
      localFeature2: 'Dynamic Port Mapping & Auto Discovery (автовиявлення портів 8080, 5173, 8000)',
      localFeature3: 'Локальний REST API та моніторинг стану з\'єднання',
      runNatTest: 'Діагностика NAT Traversal',
      natSuccess: 'NAT Traversal: Успішно! Direct UDP Socket встановлено (14.2ms)',
      metricsHeader: 'Телеметрія Edge Мережі в реальному часі',
      activeTunnels: 'Активні тунелі',
      rps: 'RPS (Запитів/сек)',
      latencyP50: 'Затримка p50 / p95 / p99',
      bandwidth: 'Пропускна здатність',
      cpuRam: 'Ресурси Edge Gateway',
      tracerTitle: 'Інтерактивний Трасувальник Пакета (6 Етапів Обробки)',
      tracerSubtitle: 'Покрокова візуалізація проходження запиту від клієнта через Edge Gateway та тунель до localhost:3000',
      runTraceBtn: 'Запустити Трасування Запиту',
      tracing: 'Трасування...',
    },
    en: {
      title: 'Traffic Mesh Architecture & Edge Routing',
      subtitle: 'Distributed Go/Rust-powered Edge Router with encrypted NAT-bypassing tunnels for local servers',
      clientTitle: 'Clients in the Global Internet',
      clientDesc: 'HTTP/1.1, HTTP/2, HTTP/3 (QUIC) incoming traffic, browsers, mobile clients & API consumers',
      edgeTitle: 'VPS / Cloud Gateway (Edge Node)',
      edgeLocation: 'Frankfurt, Germany (IP: 159.65.120.48)',
      edgeFeature1: 'Traffic Router: Rust/Go Core (Epoll / async I/O, C10K concurrency)',
      edgeFeature2: 'TLS Termination: Automated Let\'s Encrypt Wildcard (*.edgeproxy.mesh)',
      edgeFeature3: 'DDoS Shield & Rate Limiter: Token Bucket algorithm with In-Memory/Redis',
      tunnelTitle: 'Encrypted Multiplexed Tunnel',
      natTraversal: 'NAT Traversal: CGNAT Bypass (UDP Hole Punching / STUN)',
      streamMultiplexing: 'Multiplexing 1000+ virtual streams through a single connection',
      localTitle: 'Developer Local Machine (Client Agent)',
      localDesc: 'Homelab server, workstation, or Raspberry Pi behind ISP CGNAT with no public IP',
      localFeature1: 'Local Proxy Agent (Standalone lightweight CLI binary)',
      localFeature2: 'Dynamic Port Mapping & Auto Discovery (auto-detecting 8080, 5173, 8000)',
      localFeature3: 'Local REST API & connection health watchdog',
      runNatTest: 'Run NAT Traversal Diagnostic',
      natSuccess: 'NAT Traversal: Verified! Direct UDP Socket established (14.2ms)',
      metricsHeader: 'Real-time Edge Mesh Telemetry',
      activeTunnels: 'Active Tunnels',
      rps: 'RPS (Req/Sec)',
      latencyP50: 'Latency p50 / p95 / p99',
      bandwidth: 'Bandwidth (In / Out)',
      cpuRam: 'Edge Gateway Resources',
      tracerTitle: 'Interactive 6-Stage Packet Tracer',
      tracerSubtitle: 'Step-by-step inspection from internet client through Edge Gateway & tunnel to localhost:3000',
      runTraceBtn: 'Trace Sample Request',
      tracing: 'Tracing...',
    },
  }[language];

  const handleStartTrace = () => {
    if (isTracing) return;
    setIsTracing(true);
    setActiveTraceStep(1);

    const stepInterval = setInterval(() => {
      setActiveTraceStep((prev) => {
        if (prev === null || prev >= 6) {
          clearInterval(stepInterval);
          setIsTracing(false);
          return 6;
        }
        return prev + 1;
      });
    }, 600);
  };

  const handleRunNat = () => {
    setNatTestStatus('testing');
    setTimeout(() => {
      setNatTestStatus('success');
      setTimeout(() => setNatTestStatus('idle'), 5000);
    }, 900);
  };

  const formatBandwidth = (bps: number) => {
    if (bps > 1024 * 1024) return `${(bps / (1024 * 1024)).toFixed(2)} MB/s`;
    return `${(bps / 1024).toFixed(1)} KB/s`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Quick Metrics Bar */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <Layers className="w-5 h-5" />
              </span>
              <h1 className="text-xl font-bold text-white tracking-tight font-mono">{t.title}</h1>
            </div>
            <p className="text-sm text-zinc-400 mt-1 max-w-2xl">{t.subtitle}</p>
          </div>

          {/* Quick NAT test & protocol badge */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRunNat}
              disabled={natTestStatus === 'testing'}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-950/60 hover:bg-emerald-900/60 border border-emerald-500/40 text-emerald-300 text-xs font-mono transition-colors"
            >
              <Zap className={`w-3.5 h-3.5 ${natTestStatus === 'testing' ? 'animate-spin' : 'text-emerald-400'}`} />
              <span>{natTestStatus === 'testing' ? 'Testing STUN/NAT...' : t.runNatTest}</span>
            </button>
          </div>
        </div>

        {natTestStatus === 'success' && (
          <div className="mt-3 py-2 px-3 rounded-lg bg-emerald-950/70 border border-emerald-500/50 text-emerald-300 text-xs font-mono flex items-center gap-2 animate-fadeIn">
            <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span>{t.natSuccess}</span>
          </div>
        )}

        {/* Real-time quick telemetry stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4 pt-4 border-t border-zinc-800/80">
          <div className="bg-zinc-950/60 border border-zinc-800/60 p-3 rounded-lg">
            <span className="text-[11px] text-zinc-400 uppercase tracking-wider font-mono block">{t.rps}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono text-emerald-400">{telemetry.currentRps}</span>
              <span className="text-xs text-zinc-500 font-mono">peak: {telemetry.peakRps}</span>
            </div>
          </div>

          <div className="bg-zinc-950/60 border border-zinc-800/60 p-3 rounded-lg">
            <span className="text-[11px] text-zinc-400 uppercase tracking-wider font-mono block">{t.latencyP50}</span>
            <div className="flex items-baseline gap-1.5 mt-1 font-mono">
              <span className="text-xl font-bold text-white">{telemetry.p50LatencyMs}ms</span>
              <span className="text-xs text-zinc-400">/</span>
              <span className="text-xs text-amber-300">{telemetry.p95LatencyMs}ms</span>
              <span className="text-xs text-zinc-400">/</span>
              <span className="text-xs text-rose-400">{telemetry.p99LatencyMs}ms</span>
            </div>
          </div>

          <div className="bg-zinc-950/60 border border-zinc-800/60 p-3 rounded-lg">
            <span className="text-[11px] text-zinc-400 uppercase tracking-wider font-mono block">{t.bandwidth}</span>
            <div className="text-sm font-bold font-mono text-white mt-1">
              ↓ {formatBandwidth(telemetry.bandwidthInBps)}
              <span className="text-zinc-500 font-normal ml-1">/ ↑ {formatBandwidth(telemetry.bandwidthOutBps)}</span>
            </div>
          </div>

          <div className="bg-zinc-950/60 border border-zinc-800/60 p-3 rounded-lg">
            <span className="text-[11px] text-zinc-400 uppercase tracking-wider font-mono block">C10K Concurrency</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-bold font-mono text-white">{telemetry.activeConnections}</span>
              <span className="text-xs text-emerald-400 font-mono">epoll streams</span>
            </div>
          </div>

          <div className="bg-zinc-950/60 border border-zinc-800/60 p-3 rounded-lg col-span-2 sm:col-span-1">
            <span className="text-[11px] text-zinc-400 uppercase tracking-wider font-mono block">{t.cpuRam}</span>
            <div className="flex items-baseline gap-2 mt-1 font-mono text-xs">
              <span className="text-emerald-400 font-bold">{telemetry.edgeCpuPercent}% CPU</span>
              <span className="text-zinc-600">•</span>
              <span className="text-zinc-300">{telemetry.edgeMemoryMb} MB</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Architecture Diagram (2 Blocks Connected by Encrypted Tunnel) */}
      <div className="relative bg-zinc-950/90 border border-zinc-800 rounded-xl p-6 overflow-hidden">
        {/* Decorative subtle background grid */}
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none bg-[radial-gradient(#10b981_1px,transparent_1px)] [background-size:16px_16px]"></div>

        <div className="relative max-w-3xl mx-auto space-y-6">
          {/* Block 1: Internet Clients */}
          <div className="bg-zinc-900/90 border border-zinc-700/80 rounded-xl p-4 shadow-sm text-center relative hover:border-zinc-500 transition-colors">
            <div className="flex items-center justify-center gap-2 mb-1">
              <Globe className="w-5 h-5 text-sky-400" />
              <h3 className="font-bold text-white font-mono text-base">{t.clientTitle}</h3>
            </div>
            <p className="text-xs text-zinc-400 max-w-xl mx-auto">{t.clientDesc}</p>
            <div className="flex items-center justify-center gap-2 mt-2 font-mono text-[11px]">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-sky-300 border border-zinc-700">HTTPS 443</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-purple-300 border border-zinc-700">HTTP/3 QUIC (UDP 443)</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-emerald-300 border border-zinc-700">WSS (WebSockets)</span>
            </div>
          </div>

          {/* Animated Flow Arrow 1 */}
          <div className="flex flex-col items-center justify-center">
            <div className="h-6 w-0.5 bg-gradient-to-b from-sky-500 via-emerald-500 to-emerald-500 animate-pulse"></div>
            <ArrowDown className="w-5 h-5 text-emerald-400 -mt-1" />
          </div>

          {/* Block 2: VPS / Cloud Gateway (Edge Node) */}
          <div className="bg-emerald-950/20 border-2 border-emerald-500/50 rounded-xl p-5 shadow-[0_0_25px_rgba(16,185,129,0.08)] relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/20 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/40 text-emerald-400">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-white font-mono text-base flex items-center gap-2">
                    <span>{t.edgeTitle}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 font-semibold">
                      EDGE CORE
                    </span>
                  </h3>
                  <div className="text-xs text-zinc-400 font-mono flex items-center gap-1.5 mt-0.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                    <span>{t.edgeLocation}</span>
                  </div>
                </div>
              </div>

              {/* Edge Node Specs */}
              <div className="flex items-center gap-2 font-mono text-xs text-zinc-300">
                <span className="bg-zinc-900/80 px-2 py-1 rounded border border-zinc-800">
                  Epoll / Async I/O
                </span>
                <span className="bg-zinc-900/80 px-2 py-1 rounded border border-zinc-800 text-emerald-400">
                  Zero-Copy Sockets
                </span>
              </div>
            </div>

            {/* Edge Node Capabilities */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div 
                onClick={() => onNavigateToTab('traffic')} 
                className="bg-zinc-900/70 border border-zinc-800 p-3 rounded-lg hover:border-emerald-500/50 cursor-pointer transition-all group"
              >
                <div className="text-xs font-bold text-white font-mono flex items-center justify-between mb-1">
                  <span>1. Traffic Router</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{t.edgeFeature1}</p>
              </div>

              <div 
                onClick={() => onNavigateToTab('certs')} 
                className="bg-zinc-900/70 border border-zinc-800 p-3 rounded-lg hover:border-emerald-500/50 cursor-pointer transition-all group"
              >
                <div className="text-xs font-bold text-white font-mono flex items-center justify-between mb-1">
                  <span>2. TLS & Let's Encrypt</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{t.edgeFeature2}</p>
              </div>

              <div 
                onClick={() => onNavigateToTab('shield')} 
                className="bg-zinc-900/70 border border-zinc-800 p-3 rounded-lg hover:border-emerald-500/50 cursor-pointer transition-all group"
              >
                <div className="text-xs font-bold text-white font-mono flex items-center justify-between mb-1">
                  <span>3. Rate Limiting & Shield</span>
                  <ChevronRight className="w-3.5 h-3.5 text-zinc-500 group-hover:text-emerald-400 transition-colors" />
                </div>
                <p className="text-[11px] text-zinc-400 leading-relaxed">{t.edgeFeature3}</p>
              </div>
            </div>
          </div>

          {/* Encrypted Tunnel Connector */}
          <div className="bg-gradient-to-r from-emerald-950/40 via-emerald-900/30 to-emerald-950/40 border border-emerald-500/40 rounded-xl p-3.5 text-center relative shadow-md">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white text-xs font-mono">{t.tunnelTitle}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300">
                  TLS 1.3 / ChaCha20-Poly1305
                </span>
              </div>

              {/* Protocol selector for the tunnel */}
              <div className="flex items-center gap-1 bg-zinc-900/80 p-0.5 rounded border border-zinc-800 text-[11px] font-mono">
                {(['quic', 'http2', 'ws', 'tcp'] as ProtocolType[]).map((proto) => (
                  <button
                    key={proto}
                    onClick={() => setSelectedProtocol(proto)}
                    className={`px-2 py-0.5 rounded uppercase font-semibold transition-colors ${
                      selectedProtocol === proto
                        ? 'bg-emerald-600 text-white'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {proto}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-2 pt-2 border-t border-emerald-500/20 text-[11px] font-mono text-zinc-300">
              <div className="flex items-center gap-1.5 justify-center sm:justify-start">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{t.natTraversal}</span>
              </div>
              <div className="flex items-center gap-1.5 justify-center sm:justify-end text-emerald-300">
                <Activity className="w-3.5 h-3.5" />
                <span>RTT: 14.2ms • Jitter: {telemetry.tunnelJitterMs}ms • Loss: {telemetry.packetLossPercent}%</span>
              </div>
            </div>
          </div>

          {/* Animated Flow Arrow 2 */}
          <div className="flex flex-col items-center justify-center">
            <div className="h-6 w-0.5 bg-gradient-to-b from-emerald-500 via-teal-500 to-teal-400 animate-pulse"></div>
            <ArrowDown className="w-5 h-5 text-teal-400 -mt-1" />
          </div>

          {/* Block 3: Local Developer Machine (Client Agent) */}
          <div className="bg-zinc-900/90 border-2 border-teal-500/40 rounded-xl p-5 shadow-sm relative">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-teal-500/10 border border-teal-500/40 text-teal-400">
                  <HardDrive className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-white font-mono text-base flex items-center gap-2">
                    <span>{t.localTitle}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-teal-500/20 text-teal-300 border border-teal-500/30 font-semibold">
                      CLIENT AGENT
                    </span>
                  </h3>
                  <div className="text-xs text-zinc-400 font-mono mt-0.5">{t.localDesc}</div>
                </div>
              </div>

              <button
                onClick={() => onNavigateToTab('cli')}
                className="flex items-center gap-1.5 px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-xs font-mono transition-colors"
              >
                <span>CLI Specs</span>
                <ExternalLink className="w-3 h-3 text-zinc-400" />
              </button>
            </div>

            {/* Local Features */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <div className="bg-zinc-950/70 border border-zinc-800/80 p-3 rounded-lg">
                <span className="text-xs font-bold text-teal-300 font-mono block mb-1">Local Proxy CLI</span>
                <p className="text-[11px] text-zinc-400">{t.localFeature1}</p>
              </div>
              <div className="bg-zinc-950/70 border border-zinc-800/80 p-3 rounded-lg">
                <span className="text-xs font-bold text-teal-300 font-mono block mb-1">Auto Port Discovery</span>
                <p className="text-[11px] text-zinc-400">{t.localFeature2}</p>
              </div>
              <div className="bg-zinc-950/70 border border-zinc-800/80 p-3 rounded-lg">
                <span className="text-xs font-bold text-teal-300 font-mono block mb-1">Local REST API</span>
                <p className="text-[11px] text-zinc-400">{t.localFeature3}</p>
              </div>
            </div>

            {/* Currently Active Local Mappings */}
            <div className="bg-zinc-950/80 border border-zinc-800 rounded-lg p-3">
              <div className="text-xs font-bold text-zinc-300 font-mono mb-2 flex items-center justify-between">
                <span>Active Local Port Mappings ({tunnels.length})</span>
                <button
                  onClick={() => onNavigateToTab('tunnels')}
                  className="text-xs text-emerald-400 hover:underline"
                >
                  Manage All →
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 font-mono text-xs">
                {tunnels.length === 0 ? (
                  <div className="col-span-2 text-zinc-500 py-3 text-center">
                    {language === 'ua' ? 'Немає активних тунелів. Створіть перший тунель у вкладці Tunnels.' : 'No active tunnels. Create one in the Tunnels tab.'}
                  </div>
                ) : (
                  tunnels.map((tun) => (
                    <div key={tun.id} className="flex items-center justify-between p-2 rounded bg-zinc-900 border border-zinc-800">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0"></span>
                        <span className="text-emerald-300 font-medium truncate">{tun.subdomain}.edgeproxy.mesh</span>
                      </div>
                      <div className="text-zinc-400 flex items-center gap-1 flex-shrink-0">
                        <span>→</span>
                        <span className="text-white bg-zinc-800 px-1.5 py-0.5 rounded text-[11px]">
                          :{tun.targetPort}
                        </span>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive 6-Stage Packet Journey Visualizer */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                <Zap className="w-4 h-4" />
              </span>
              <h2 className="text-base font-bold text-white font-mono">{t.tracerTitle}</h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">{t.tracerSubtitle}</p>
          </div>

          <button
            onClick={handleStartTrace}
            disabled={isTracing}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-all shadow-md disabled:opacity-50"
          >
            <Zap className={`w-3.5 h-3.5 ${isTracing ? 'animate-bounce text-amber-300' : ''}`} />
            <span>{isTracing ? t.tracing : t.runTraceBtn}</span>
          </button>
        </div>

        {/* 6 Stage Horizontal / Grid Flow */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 font-mono text-xs">
          {/* Stage 1: Ingress Listener */}
          <div
            className={`p-3.5 rounded-xl border transition-all ${
              activeTraceStep === 1
                ? 'bg-emerald-950/80 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] scale-[1.02]'
                : activeTraceStep && activeTraceStep > 1
                ? 'bg-zinc-900 border-zinc-700 opacity-90'
                : 'bg-zinc-950/60 border-zinc-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400">Stage 1: Ingress</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                0.22 ms
              </span>
            </div>
            <h4 className="font-bold text-white text-xs">Ingress Listener (Netty / Tokio)</h4>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              Accepts client socket on :443. Peeks first packet chunk to parse SNI / Host: <span className="text-emerald-300">cloud.edgeproxy.mesh</span>
            </p>
          </div>

          {/* Stage 2: TLS Termination */}
          <div
            className={`p-3.5 rounded-xl border transition-all ${
              activeTraceStep === 2
                ? 'bg-emerald-950/80 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] scale-[1.02]'
                : activeTraceStep && activeTraceStep > 2
                ? 'bg-zinc-900 border-zinc-700 opacity-90'
                : 'bg-zinc-950/60 border-zinc-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400">Stage 2: Security</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                0.35 ms
              </span>
            </div>
            <h4 className="font-bold text-white text-xs">TLS Termination & ACME</h4>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              Matches wildcard certificate (*.edgeproxy.mesh). Decrypts TLS 1.3 payload using ChaCha20-Poly1305.
            </p>
          </div>

          {/* Stage 3: Rate Limiting & Shield */}
          <div
            className={`p-3.5 rounded-xl border transition-all ${
              activeTraceStep === 3
                ? 'bg-emerald-950/80 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] scale-[1.02]'
                : activeTraceStep && activeTraceStep > 3
                ? 'bg-zinc-900 border-zinc-700 opacity-90'
                : 'bg-zinc-950/60 border-zinc-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400">Stage 3: Protection</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                0.04 ms
              </span>
            </div>
            <h4 className="font-bold text-white text-xs">Rate Limiter & DDoS Shield</h4>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              Token Bucket check (in-memory/Redis). IP not jailed. Remaining tokens: 91/100. Status: <span className="text-emerald-400 font-bold">ALLOWED</span>
            </p>
          </div>

          {/* Stage 4: Multiplexing Router */}
          <div
            className={`p-3.5 rounded-xl border transition-all ${
              activeTraceStep === 4
                ? 'bg-emerald-950/80 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] scale-[1.02]'
                : activeTraceStep && activeTraceStep > 4
                ? 'bg-zinc-900 border-zinc-700 opacity-90'
                : 'bg-zinc-950/60 border-zinc-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400">Stage 4: Router</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                0.12 ms
              </span>
            </div>
            <h4 className="font-bold text-white text-xs">Multiplexing Session Router</h4>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              Lookups active session for subdomain 'cloud'. Allocates virtual <span className="text-emerald-300 font-bold">Stream ID #101</span>.
            </p>
          </div>

          {/* Stage 5: Encrypted Tunnel */}
          <div
            className={`p-3.5 rounded-xl border transition-all ${
              activeTraceStep === 5
                ? 'bg-emerald-950/80 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] scale-[1.02]'
                : activeTraceStep && activeTraceStep > 5
                ? 'bg-zinc-900 border-zinc-700 opacity-90'
                : 'bg-zinc-950/60 border-zinc-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400">Stage 5: Tunnel Wire</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                14.2 ms
              </span>
            </div>
            <h4 className="font-bold text-white text-xs">QUIC/HTTP2 Tunnel (Framed)</h4>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              Packs binary frame: [0x00000065][0x02 DATA][Len: 124B]. Transits NAT-bypassed socket over WAN.
            </p>
          </div>

          {/* Stage 6: Local Demux & Reverse Proxy */}
          <div
            className={`p-3.5 rounded-xl border transition-all ${
              activeTraceStep === 6
                ? 'bg-emerald-950/80 border-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.3)] scale-[1.02]'
                : 'bg-zinc-950/60 border-zinc-800'
            }`}
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[10px] uppercase font-bold text-zinc-400">Stage 6: Target</span>
              <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-500/30">
                3.8 ms
              </span>
            </div>
            <h4 className="font-bold text-white text-xs">Local Demux & Localhost Proxy</h4>
            <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
              Local Agent demuxes Stream #101. Direct forward to <span className="text-white font-bold">127.0.0.1:8080</span>. HTTP 200 OK returned!
            </p>
          </div>
        </div>

        {/* Real-time Stage Log */}
        {activeTraceStep !== null && (
          <div className="bg-zinc-950 border border-zinc-800 rounded-lg p-3 font-mono text-xs text-zinc-300 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>
                {activeTraceStep === 1 && 'Ingress Listener: Packet received from 93.175.204.12. SNI parsed.'}
                {activeTraceStep === 2 && 'TLS Engine: TLS 1.3 handshake terminated. Decrypted HTTP request payload.'}
                {activeTraceStep === 3 && 'Token Bucket: 1 token deducted. No DDoS pattern detected. Request passed.'}
                {activeTraceStep === 4 && 'Session Multiplexer: Stream #101 mapped to Agent connection #sock_42.'}
                {activeTraceStep === 5 && 'Encrypted Tunnel: Binary frame transmitted over UDP QUIC socket (14.2ms).'}
                {activeTraceStep === 6 && 'Local Agent: Stream #101 delivered to 127.0.0.1:8080. Total trip: 18.7ms (p95).'}
              </span>
            </div>
            <span className="text-[11px] text-emerald-400 font-bold">
              {activeTraceStep === 6 ? 'SUCCESS (200 OK)' : `STEP ${activeTraceStep} OF 6`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};
