import React, { useState } from 'react';
import { 
  CheckCircle2, 
  Clock, 
  Terminal, 
  Play, 
  Copy, 
  Check, 
  Cpu, 
  Layers, 
  ShieldCheck, 
  Zap, 
  Server, 
  ExternalLink,
  ChevronRight
} from 'lucide-react';
import { ROADMAP_STAGES } from '../mockData';
import { RoadmapStage } from '../types';

interface RoadmapViewProps {
  language: 'ua' | 'en';
}

export const RoadmapView: React.FC<RoadmapViewProps> = ({ language }) => {
  const [selectedStage, setSelectedStage] = useState<RoadmapStage>(ROADMAP_STAGES[0]);
  const [copiedCode, setCopiedCode] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);

  const t = {
    ua: {
      title: 'Покроковий План Розробки та Технологічний Стек',
      subtitle: '5 інженерних етапів реалізації EdgeProxy з бенчмарками, перевірочними тестами та специфікацією коду',
      stagesTitle: 'Етапи Реалізації (Roadmap 1 - 5)',
      techStackTitle: 'Рекомендований Технологічний Стек (Розділ 6)',
      keyComponents: 'Ключові архітектурні компоненти:',
      runTestBtn: 'Запустити верифікаційний тест етапу',
      runningTest: 'Виконання тест-сьюту...',
      codeTitle: 'Еталонна реалізація ядра:',
      benchmarksTitle: 'Результати бенчмарків продуктивності:',
      copyCode: 'Копіювати код',
      copied: 'Скопійовано!',
      stackEdgeGateway: 'Edge Gateway (VPS-нода): Rust (Tokio/Hyper) або Go (net/http)',
      stackEdgeDesc: 'Забезпечує надвисоку пропускну здатність (150,000+ RPS), epoll / kqueue пул потоків та мінімальне споживання RAM (< 30 MB).',
      stackStorage: 'Сховище: Redis (Кеш, Сесії, Token Bucket) + PostgreSQL (Схема даних)',
      stackStorageDesc: 'Redis гарантує перевірку лімітів за < 0.1ms. PostgreSQL надійно зберігає облікові записи користувачів, субдомени та історію запитів.',
      stackAgent: 'Local Agent: Go або Rust (Single Static Binary)',
      stackAgentDesc: 'Крос-платформний бінарник (Linux, macOS, Windows) без додаткових залежностей. Автовиявлення локальних портів.',
      stackDashboard: 'Веб-панель: React / Next.js, Tailwind CSS, Lucide Icons, Recharts',
      stackDashboardDesc: 'Швидкий та адаптивний інтерфейс моніторингу трафіку, сертифікатів та налаштування лімітерів.',
    },
    en: {
      title: 'Engineering Implementation Roadmap & Tech Stack',
      subtitle: '5 core developmental milestones for EdgeProxy with runnable benchmarks, verification suites & code samples',
      stagesTitle: 'Development Roadmap (Stages 1 - 5)',
      techStackTitle: 'Recommended Technology Stack (Section 6)',
      keyComponents: 'Core Architectural Components:',
      runTestBtn: 'Run Stage Verification Test',
      runningTest: 'Executing test suite...',
      codeTitle: 'Core Implementation Blueprint:',
      benchmarksTitle: 'Performance Benchmark Metrics:',
      copyCode: 'Copy Code',
      copied: 'Copied!',
      stackEdgeGateway: 'Edge Gateway (Cloud Node): Rust (Tokio/Hyper) or Go (net/http)',
      stackEdgeDesc: 'Delivers ultra-high throughput (150,000+ RPS), epoll/kqueue async loops and lean memory footprint (< 30 MB).',
      stackStorage: 'Storage: Redis (Session Cache, Token Bucket) + PostgreSQL (Database Schema)',
      stackStorageDesc: 'Redis enables microsecond rate-limiting checks (< 0.1ms). PostgreSQL persists user identities and audit logs.',
      stackAgent: 'Local Agent: Go or Rust (Single Static Binary)',
      stackAgentDesc: 'Zero-dependency standalone binary for Linux, macOS, and Windows with local port auto-discovery.',
      stackDashboard: 'Dashboard: React / Next.js, Tailwind CSS, Lucide Icons, Recharts',
      stackDashboardDesc: 'Responsive control plane for real-time telemetry, SSL certificate tracking, and traffic inspection.',
    },
  }[language];

  const handleRunTest = (stage: RoadmapStage) => {
    setIsRunningTest(true);
    setTestOutput(null);

    setTimeout(() => {
      setIsRunningTest(false);
      const stageTests: Record<number, string> = {
        1: `=== Running Stage 1 Test: TCP Ingress & Host Routing ===\n[OK] Bind socket 0.0.0.0:80 (epoll async listener)\n[OK] Host header peek parser validated on 10,000 mock packets\n[OK] Zero-copy socket splice achieved (0 mem-copies)\n[PASS] Throughput verified: 185,200 req/sec | p99: 0.45ms`,
        2: `=== Running Stage 2 Test: Framed Binary Protocol & Demux ===\n[OK] Binary frame header packing: [StreamID: 4B, Type: 1B, Len: 4B]\n[OK] Multiplexing 2,500 virtual streams over 1 TCP socket\n[OK] Head-of-line blocking eliminated (async demux queues)\n[PASS] Protocol framing overhead: 9 bytes/pkt | Demux latency: 0.08ms`,
        3: `=== Running Stage 3 Test: ACME v2 & TLS Termination ===\n[OK] Let's Encrypt TLS-ALPN-01 challenge handshake verified\n[OK] In-memory cert cache hit rate: 99.8%\n[OK] Zero-downtime certificate hot-reloading: 0 dropped conns\n[PASS] TLS 1.3 handshake: 1 RTT | ChaCha20-Poly1305 active`,
        4: `=== Running Stage 4 Test: Token Bucket Rate Limiter & Shield ===\n[OK] Atomic CAS Token Bucket evaluated under 50,000 RPS burst\n[OK] Redis sliding window counter synchronized in 0.11ms\n[OK] Botnet IP auto-jailed after 3 threshold violations (HTTP 429)\n[PASS] Attack mitigation capacity: 500,000 RPS`,
        5: `=== Running Stage 5 Test: CLI Agent & Live Dashboard ===\n[OK] CLI port scanner identified open services (:8080, :5173, :8000)\n[OK] WebSocket telemetry feed streaming at 60 FPS\n[OK] Request inspection waterfall rendered with sub-millisecond precision\n[PASS] End-to-end tunnel journey verified in 14.2ms RTT`,
      };

      setTestOutput(stageTests[stage.step] || '[PASS] All unit tests completed.');
    }, 850);
  };

  const copyCodeSample = () => {
    navigator.clipboard.writeText(selectedStage.codeSample);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-lg">
        <div className="flex items-center gap-2.5">
          <span className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
            <Layers className="w-5 h-5" />
          </span>
          <div>
            <h1 className="text-xl font-bold text-white font-mono">{t.title}</h1>
            <p className="text-sm text-zinc-400 mt-0.5">{t.subtitle}</p>
          </div>
        </div>
      </div>

      {/* 5 Stages Navigation Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {ROADMAP_STAGES.map((stage) => {
          const isSelected = selectedStage.step === stage.step;
          return (
            <div
              key={stage.step}
              onClick={() => {
                setSelectedStage(stage);
                setTestOutput(null);
              }}
              className={`p-3.5 rounded-xl border cursor-pointer font-mono transition-all relative ${
                isSelected
                  ? 'bg-zinc-800 border-emerald-500 shadow-[0_0_15px_rgba(16,185,129,0.15)]'
                  : 'bg-zinc-900/70 border-zinc-800 hover:border-zinc-700'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="px-2 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-500/40 text-xs font-bold">
                  Етап {stage.step}
                </span>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              </div>
              <h3 className="text-xs font-bold text-white leading-tight">
                {language === 'ua' ? stage.nameUa : stage.nameEn}
              </h3>
            </div>
          );
        })}
      </div>

      {/* Selected Stage Deep-Dive */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 shadow-sm space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-zinc-800 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 font-mono text-xs font-bold">
                STAGE {selectedStage.step} OF 5
              </span>
              <h2 className="text-lg font-bold text-white font-mono">
                {language === 'ua' ? selectedStage.nameUa : selectedStage.nameEn}
              </h2>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              {language === 'ua' ? selectedStage.subtitleUa : selectedStage.subtitleEn}
            </p>
          </div>

          <button
            onClick={() => handleRunTest(selectedStage)}
            disabled={isRunningTest}
            className="flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-colors shadow-sm disabled:opacity-50"
          >
            <Play className={`w-3.5 h-3.5 ${isRunningTest ? 'animate-spin' : ''}`} />
            <span>{isRunningTest ? t.runningTest : t.runTestBtn}</span>
          </button>
        </div>

        {/* Test Console Output */}
        {testOutput && (
          <div className="bg-zinc-950 border border-emerald-500/50 rounded-lg p-3.5 font-mono text-xs text-emerald-300 whitespace-pre-wrap leading-relaxed animate-fadeIn">
            {testOutput}
          </div>
        )}

        {/* Key Components Checklist */}
        <div>
          <h3 className="text-xs font-bold text-zinc-300 font-mono uppercase tracking-wider mb-2">
            {t.keyComponents}
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
            {selectedStage.keyComponents.map((comp, idx) => (
              <div key={idx} className="bg-zinc-950/70 border border-zinc-800 rounded-lg p-2.5 font-mono text-xs flex items-start gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 mt-1.5 flex-shrink-0"></span>
                <span className="text-zinc-300">{comp}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Benchmarks Metrics */}
        <div>
          <h3 className="text-xs font-bold text-zinc-300 font-mono uppercase tracking-wider mb-2">
            {t.benchmarksTitle}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {selectedStage.benchmarks.map((bench, idx) => (
              <div key={idx} className="bg-zinc-950/80 border border-zinc-800 p-3 rounded-lg font-mono">
                <span className="text-[11px] text-zinc-500 uppercase block">{bench.label}</span>
                <span className="text-base font-bold text-emerald-400 mt-0.5 block">{bench.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Code Sample */}
        <div className="space-y-2 font-mono">
          <div className="flex items-center justify-between text-xs">
            <span className="text-zinc-400 font-bold">{selectedStage.codeSampleTitle}</span>
            <button
              onClick={copyCodeSample}
              className="text-zinc-400 hover:text-white flex items-center gap-1 text-[11px]"
            >
              {copiedCode ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              <span>{copiedCode ? t.copied : t.copyCode}</span>
            </button>
          </div>
          <div className="bg-zinc-950 p-4 rounded-lg border border-zinc-800 overflow-x-auto text-xs text-emerald-300 leading-relaxed">
            <pre>{selectedStage.codeSample}</pre>
          </div>
        </div>
      </div>

      {/* Section 6: Recommended Tech Stack Matrix */}
      <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-6 shadow-sm space-y-4">
        <h2 className="text-base font-bold text-white font-mono flex items-center gap-2">
          <Cpu className="w-5 h-5 text-emerald-400" />
          <span>{t.techStackTitle}</span>
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 font-mono text-xs">
          <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
              <Server className="w-4 h-4" />
              <span>1. {t.stackEdgeGateway}</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{t.stackEdgeDesc}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Tokio Async I/O</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Zero-Copy Sockets</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Hyper HTTP/2</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Quinn (QUIC)</span>
            </div>
          </div>

          <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
              <Zap className="w-4 h-4" />
              <span>2. {t.stackStorage}</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{t.stackStorageDesc}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Redis Token Bucket</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">PostgreSQL 16</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Composite Indices</span>
            </div>
          </div>

          <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
              <Terminal className="w-4 h-4" />
              <span>3. {t.stackAgent}</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{t.stackAgentDesc}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Static Binary (8MB)</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Local Demux Proxy</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Systemd & Docker</span>
            </div>
          </div>

          <div className="bg-zinc-950/70 border border-zinc-800 rounded-xl p-4 space-y-2">
            <div className="flex items-center gap-2 font-bold text-emerald-400 text-sm">
              <Layers className="w-4 h-4" />
              <span>4. {t.stackDashboard}</span>
            </div>
            <p className="text-zinc-400 leading-relaxed">{t.stackDashboardDesc}</p>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Next.js / React</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">Tailwind CSS</span>
              <span className="px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 text-[11px]">WebSocket Stream</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
