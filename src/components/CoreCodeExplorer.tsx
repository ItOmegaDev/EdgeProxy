import React, { useState, useEffect } from 'react';
import { 
  Code2, 
  Copy, 
  Check, 
  Terminal, 
  Folder, 
  FileCode, 
  Database, 
  Cpu, 
  Server, 
  Download,
  ExternalLink,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import { REFERENCE_CODE_ARCHIVE } from '../data/codeArchive';

interface CoreCodeExplorerProps {
  language: 'ua' | 'en';
}

export const CoreCodeExplorer: React.FC<CoreCodeExplorerProps> = ({ language }) => {
  const [files, setFiles] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string>('gateway/main.go');
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const t = {
    ua: {
      title: 'Ядро EdgeProxy: Go Gateway, CLI Agent та База Даних',
      subtitle: 'Повноцінна реалізація високонавантаженого проксі на Go та реляційної схеми PostgreSQL 16',
      copyCode: 'Копіювати код',
      copied: 'Скопійовано!',
      downloadAll: 'Завантажити файли',
      filesTree: 'Файлова система ядра',
      fileDetails: 'Специфікація модуля:',
      modulesGo: 'Модулі Go (Edge Gateway & Local Agent)',
      modulesDb: 'База Даних (PostgreSQL DDL & Міграції)',
      refresh: 'Оновити',
    },
    en: {
      title: 'EdgeProxy Core Engine: Go Gateway, CLI Agent & Database',
      subtitle: 'Production-ready Go High-Load Proxy and PostgreSQL 16 relational data architecture',
      copyCode: 'Copy Source',
      copied: 'Copied!',
      downloadAll: 'Download Archive',
      filesTree: 'Core File System',
      fileDetails: 'Module Specification:',
      modulesGo: 'Go Modules (Edge Gateway & Local Agent)',
      modulesDb: 'Database (PostgreSQL DDL & Migrations)',
      refresh: 'Refresh',
    },
  }[language];

  const loadFiles = () => {
    setLoading(true);
    setFiles(REFERENCE_CODE_ARCHIVE);
    setLoading(false);
  };

  useEffect(() => {
    loadFiles();
  }, []);

  const copyCode = () => {
    if (files[selectedFile]) {
      navigator.clipboard.writeText(files[selectedFile]);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const fileDescriptions: Record<string, { ua: string; en: string; badge: string }> = {
    'gateway/main.go': {
      ua: 'Головна точка входу Edge Gateway. Слухає порти 80/443 та TCP 4242 для підключення агентів.',
      en: 'Primary Edge Gateway entry point. Binds ports 80/443 & TCP 4242 control plane listener.',
      badge: 'Go Gateway Ingress',
    },
    'gateway/proxy/router.go': {
      ua: 'HTTP/TCP маршрутизатор: стандартизована серіалізація через req.Write(&buf), парсинг Host-заголовка та мультиплексування в бінарний тунель.',
      en: 'HTTP/TCP router: RFC-compliant serialization via req.Write(&buf), Host header inspection, and multiplexed binary tunneling.',
      badge: 'RFC req.Write Router',
    },
    'gateway/acme/cert.go': {
      ua: 'ACME & TLS Termination менеджер: генерація криптографічних ECDSA P-256 ключів, dynamic SNI GetCertificate та TLS-ALPN-01 автооновлення.',
      en: 'ACME & TLS Termination: cryptographic ECDSA P-256 X.509 cert generator with SNI GetCertificate handler and auto-renewal.',
      badge: 'TLS Termination / ACME',
    },
    'gateway/protocol/framing.go': {
      ua: '9-байтний бінарний протокол: [StreamID: 4B, Type: 1B, Len: 4B]. Підтримує FrameAck для flow control та FrameMetrics для телеметрії.',
      en: '9-byte binary wire protocol with FrameAck sliding-window flow control and FrameMetrics telemetry streaming.',
      badge: 'Binary Wire Protocol',
    },
    'gateway/limiter/bucket.go': {
      ua: 'Token Bucket rate limiter із ковзним вікном поповнення та автоматичним джейлом ботнетів після 5 порушень.',
      en: 'Atomic Token Bucket rate limiter with sliding window replenishment and auto-jail protection.',
      badge: 'DDoS Shield',
    },
    'agent/main.go': {
      ua: 'CLI клієнт для локального розробника. Обов\'язковий прапорець -token, --port, --subdomain та перевірка аутентифікації.',
      en: 'Standalone CLI agent with mandatory token authentication, port auto-discovery and graceful termination.',
      badge: 'Go CLI Agent',
    },
    'agent/client/tunnel.go': {
      ua: 'Клієнтський транспорт тунелю: Backpressure flow control через FrameAck, періодична відправка FrameMetrics телеметрії.',
      en: 'Tunnel client transport with sliding-window FrameAck backpressure and periodic FrameMetrics telemetry dispatch.',
      badge: 'Flow-Controlled Transport',
    },
    'agent/metrics/collector.go': {
      ua: 'Local Metrics Collector: агрегатор затримки (P50/P95/P99), кількості запитів, переданих байтів та відліку RTT локального сервісу.',
      en: 'Local Metrics Collector aggregating P50/P95/P99 latency, byte counts, active streams, and local service RTT.',
      badge: 'Metrics Collector',
    },
    'agent/demux/demuxer.go': {
      ua: 'Локальний реверс-проксі: приймає запити з віртуальних потоків і перенаправляє на localhost:3000.',
      en: 'Local demuxer forwarding virtual stream requests directly to localhost target port.',
      badge: 'Local Port Proxy',
    },
    'db/01_schema.sql': {
      ua: 'DDL створення таблиць users, tunnels, traffic_logs та rate_limit_rules у PostgreSQL 16.',
      en: 'PostgreSQL 16 relational DDL: users, tunnels, partitioned traffic_logs and rate limits.',
      badge: 'PostgreSQL DDL',
    },
    'db/02_indexes.sql': {
      ua: 'Складені та часткові індекси для швидкого пошуку субдоменів (<0.05ms) та тайм-серійних логів.',
      en: 'Composite & partial performance indexes optimized for sub-millisecond subdomain queries.',
      badge: 'SQL Indexes',
    },
    'db/03_seed.sql': {
      ua: 'Початкові дані тестового середовища з готовими тунелями cloud, api, grafana, staging.',
      en: 'Staging seed data initializing developer account and initial tunnel configurations.',
      badge: 'Seed Migration',
    },
  };

  const fileList = Object.keys(files).length > 0 ? Object.keys(files) : [
    'gateway/main.go',
    'gateway/proxy/router.go',
    'gateway/acme/cert.go',
    'gateway/protocol/framing.go',
    'gateway/limiter/bucket.go',
    'agent/main.go',
    'agent/client/tunnel.go',
    'agent/metrics/collector.go',
    'agent/demux/demuxer.go',
    'db/01_schema.sql',
    'db/02_indexes.sql',
    'db/03_seed.sql',
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 shadow-lg">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Code2 className="w-5 h-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold text-white font-mono">{t.title}</h1>
              <p className="text-sm text-zinc-400 mt-0.5">{t.subtitle}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadFiles}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-mono transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>{t.refresh}</span>
            </button>
            <button
              onClick={copyCode}
              className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-mono font-bold transition-colors shadow-sm"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-white" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t.copied : t.copyCode}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Explorer Split Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left Sidebar: File Tree */}
        <div className="lg:col-span-4 bg-zinc-900/90 border border-zinc-800 rounded-xl p-4 space-y-4 font-mono">
          <div className="text-xs font-bold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
            <Folder className="w-4 h-4 text-emerald-400" />
            <span>{t.filesTree}</span>
          </div>

          <div className="space-y-1">
            <div className="text-[11px] text-zinc-500 font-bold px-2 py-1 flex items-center gap-1.5">
              <Server className="w-3 h-3 text-emerald-400" />
              <span>/gateway (Go High-Load Edge)</span>
            </div>
            {fileList
              .filter((f) => f.startsWith('gateway/'))
              .map((file) => {
                const isSel = selectedFile === file;
                return (
                  <button
                    key={file}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${
                      isSel
                        ? 'bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-bold'
                        : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className={`w-3.5 h-3.5 ${isSel ? 'text-emerald-400' : 'text-zinc-500'}`} />
                      <span className="truncate">{file.replace('gateway/', '')}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">
                      Go
                    </span>
                  </button>
                );
              })}

            <div className="text-[11px] text-zinc-500 font-bold px-2 pt-3 py-1 flex items-center gap-1.5">
              <Terminal className="w-3 h-3 text-amber-400" />
              <span>/agent (Go CLI Agent)</span>
            </div>
            {fileList
              .filter((f) => f.startsWith('agent/'))
              .map((file) => {
                const isSel = selectedFile === file;
                return (
                  <button
                    key={file}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${
                      isSel
                        ? 'bg-amber-950/80 border border-amber-500/50 text-amber-300 font-bold'
                        : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className={`w-3.5 h-3.5 ${isSel ? 'text-amber-400' : 'text-zinc-500'}`} />
                      <span className="truncate">{file.replace('agent/', '')}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">
                      CLI
                    </span>
                  </button>
                );
              })}

            <div className="text-[11px] text-zinc-500 font-bold px-2 pt-3 py-1 flex items-center gap-1.5">
              <Database className="w-3 h-3 text-cyan-400" />
              <span>/db (PostgreSQL 16 Schema)</span>
            </div>
            {fileList
              .filter((f) => f.startsWith('db/'))
              .map((file) => {
                const isSel = selectedFile === file;
                return (
                  <button
                    key={file}
                    onClick={() => setSelectedFile(file)}
                    className={`w-full text-left px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-all ${
                      isSel
                        ? 'bg-cyan-950/80 border border-cyan-500/50 text-cyan-300 font-bold'
                        : 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-200'
                    }`}
                  >
                    <div className="flex items-center gap-2 truncate">
                      <FileCode className={`w-3.5 h-3.5 ${isSel ? 'text-cyan-400' : 'text-zinc-500'}`} />
                      <span className="truncate">{file.replace('db/', '')}</span>
                    </div>
                    <span className="text-[10px] text-zinc-500 bg-zinc-950 px-1.5 py-0.5 rounded border border-zinc-800">
                      SQL
                    </span>
                  </button>
                );
              })}
          </div>
        </div>

        {/* Right Editor View: Code & Details */}
        <div className="lg:col-span-8 bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 space-y-4 font-mono">
          {/* File Header & Badge */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-zinc-800 pb-3">
            <div className="flex items-center gap-2">
              <FileCode className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white">{selectedFile}</span>
              {fileDescriptions[selectedFile] && (
                <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  {fileDescriptions[selectedFile].badge}
                </span>
              )}
            </div>

            <button
              onClick={copyCode}
              className="text-zinc-400 hover:text-white text-xs flex items-center gap-1.5 self-start sm:self-auto"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>{copied ? t.copied : t.copyCode}</span>
            </button>
          </div>

          {/* Description */}
          {fileDescriptions[selectedFile] && (
            <p className="text-xs text-zinc-300 bg-zinc-950/80 p-3 rounded-lg border border-zinc-800/80 leading-relaxed">
              {language === 'ua' ? fileDescriptions[selectedFile].ua : fileDescriptions[selectedFile].en}
            </p>
          )}

          {/* Code Viewer */}
          <div className="bg-zinc-950 border border-zinc-800/90 rounded-lg p-4 overflow-x-auto max-h-[540px]">
            <pre className="text-xs text-emerald-300/90 font-mono leading-relaxed whitespace-pre">
              {files[selectedFile] || '// Loading source file from Go core...'}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
};
