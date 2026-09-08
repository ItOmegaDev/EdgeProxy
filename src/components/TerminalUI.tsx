import React, { useState, useEffect } from 'react';
import { TelemetryMetrics, Tunnel, TrafficRequest, RateLimiterConfig, SSLCertificate } from '../types';
import { Terminal as TerminalIcon, X, Play, Pause, Flame } from 'lucide-react';

interface TerminalUIProps {
  telemetry: TelemetryMetrics;
  tunnels: Tunnel[];
  requests: TrafficRequest[];
  config: RateLimiterConfig;
  certificates: SSLCertificate[];
  onExitTui: () => void;
  isAttackActive: boolean;
  onToggleAttack: () => void;
  language: 'ua' | 'en';
}

export const TerminalUI: React.FC<TerminalUIProps> = ({
  telemetry,
  tunnels,
  requests,
  config,
  certificates,
  onExitTui,
  isAttackActive,
  onToggleAttack,
  language,
}) => {
  const [activePane, setActivePane] = useState<'overview' | 'tunnels' | 'logs' | 'shield' | 'certs'>('overview');
  const [isPaused, setIsPaused] = useState(false);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '1') setActivePane('overview');
      if (e.key === '2') setActivePane('tunnels');
      if (e.key === '3') setActivePane('logs');
      if (e.key === '4') setActivePane('shield');
      if (e.key === '5') setActivePane('certs');
      if (e.key === 'q' || e.key === 'Q' || e.key === 'Escape') onExitTui();
      if (e.key === 'a' || e.key === 'A') onToggleAttack();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onExitTui, onToggleAttack]);

  const renderProgressBar = (value: number, max: number, length: number = 18) => {
    const filled = Math.min(length, Math.max(0, Math.round((value / max) * length)));
    const empty = length - filled;
    return `[${'|'.repeat(filled)}${' '.repeat(empty)}]`;
  };

  return (
    <div className="bg-[#05080c] text-emerald-400 font-mono text-xs rounded-xl border border-emerald-500/50 shadow-2xl p-4 sm:p-6 overflow-hidden select-none">
      {/* Top Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-emerald-500/40 pb-3 mb-4">
        <div className="flex items-center gap-2 text-white">
          <TerminalIcon className="w-4 h-4 text-emerald-400" />
          <span className="font-bold tracking-wider">EDGEPROXY TERMINAL UI (TUI)</span>
          <span className="text-zinc-500 text-[10px]">v2.4-mesh</span>
          {isAttackActive && (
            <span className="bg-rose-950 text-rose-300 border border-rose-600 px-1.5 py-0.2 rounded text-[10px] animate-pulse">
              [ATTACK IN PROGRESS]
            </span>
          )}
        </div>

        {/* Hotkey nav tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none text-[11px]">
          <button
            onClick={() => setActivePane('overview')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activePane === 'overview' ? 'bg-emerald-500 text-black font-bold' : 'hover:bg-emerald-950/60'
            }`}
          >
            [1] OVERVIEW
          </button>
          <button
            onClick={() => setActivePane('tunnels')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activePane === 'tunnels' ? 'bg-emerald-500 text-black font-bold' : 'hover:bg-emerald-950/60'
            }`}
          >
            [2] TUNNELS
          </button>
          <button
            onClick={() => setActivePane('logs')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activePane === 'logs' ? 'bg-emerald-500 text-black font-bold' : 'hover:bg-emerald-950/60'
            }`}
          >
            [3] LOGS
          </button>
          <button
            onClick={() => setActivePane('shield')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activePane === 'shield' ? 'bg-emerald-500 text-black font-bold' : 'hover:bg-emerald-950/60'
            }`}
          >
            [4] SHIELD
          </button>
          <button
            onClick={() => setActivePane('certs')}
            className={`px-2 py-0.5 rounded transition-colors ${
              activePane === 'certs' ? 'bg-emerald-500 text-black font-bold' : 'hover:bg-emerald-950/60'
            }`}
          >
            [5] CERTS
          </button>

          <button
            onClick={onToggleAttack}
            className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-rose-900/50 text-rose-300 border border-zinc-750 transition-colors ml-1"
            title="Press 'A' key"
          >
            [A] ATTACK
          </button>

          <button
            onClick={onExitTui}
            className="px-2 py-0.5 rounded bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-750 transition-colors ml-1"
            title="Press 'Q' key"
          >
            [Q] EXIT
          </button>
        </div>
      </div>

      {/* System Gauges Box */}
      <div className="bg-[#080d14] border border-emerald-900/80 rounded p-3 mb-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-[11px]">
        <div>
          <div className="text-zinc-400">EDGE CPU USAGE</div>
          <div className="text-white font-bold">
            {renderProgressBar(telemetry.edgeCpuPercent, 100)} {telemetry.edgeCpuPercent}%
          </div>
        </div>

        <div>
          <div className="text-zinc-400">EDGE RAM MEMORY</div>
          <div className="text-white font-bold">
            {renderProgressBar(telemetry.edgeMemoryMb, 256)} {telemetry.edgeMemoryMb}MB
          </div>
        </div>

        <div>
          <div className="text-zinc-400">THROUGHPUT RPS</div>
          <div className="text-white font-bold">
            {renderProgressBar(telemetry.currentRps, telemetry.peakRps || 100)} {telemetry.currentRps} r/s
          </div>
        </div>

        <div>
          <div className="text-zinc-400">TOKEN BUCKET FILL</div>
          <div className={`font-bold ${config.currentTokens < 15 ? 'text-rose-400' : 'text-emerald-400'}`}>
            {renderProgressBar(config.currentTokens, config.capacity)}{' '}
            {Math.floor(config.currentTokens)}/{config.capacity}
          </div>
        </div>
      </div>

      {/* Pane Content */}
      {activePane === 'overview' && (
        <div className="space-y-4">
          <div className="border border-emerald-900 rounded p-4 bg-[#080d14]">
            <div className="text-emerald-300 font-bold mb-2">┌── TOPOLOGY & MESH STATUS ──────────────────────────┐</div>
            <pre className="text-[11px] text-zinc-300 leading-relaxed overflow-x-auto">
{`[ Global Internet Clients ] 
      │ 
      ▼ HTTPS:443 / QUIC:443
┌────────────────────────────────────────────────────────┐
│ VPS Gateway: Frankfurt VPS-01 (159.65.120.48)           │
│ • State: In-Memory Token Bucket + Redis Sync           │
│ • Epoll Concurrency: ${telemetry.activeConnections} active socket streams         │
│ • Latencies: p50=${telemetry.p50LatencyMs}ms / p95=${telemetry.p95LatencyMs}ms / p99=${telemetry.p99LatencyMs}ms     │
└───────────────────────┬────────────────────────────────┘
                        │ Encrypted QUIC Multiplexed Stream
                        ▼ (RTT: 14.2ms • Jitter: ${telemetry.tunnelJitterMs}ms • Loss: ${telemetry.packetLossPercent}%)
┌────────────────────────────────────────────────────────┐
│ Local Client Machine (Client Agent Daemon)             │
│ • Active Mappings: ${tunnels.length} local services tunneled          │
│ • NAT Traversal: UDP Hole Punching (Direct P2P socket) │
└────────────────────────────────────────────────────────┘`}
            </pre>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="border border-emerald-900 rounded p-3 bg-[#080d14]">
              <div className="text-emerald-300 font-bold mb-2">ACTIVE TUNNEL ROUTES</div>
              <div className="space-y-1 text-[11px]">
                {tunnels.map((t) => (
                  <div key={t.id} className="flex justify-between text-zinc-300">
                    <span className="text-emerald-400">{t.subdomain}.edgeproxy.mesh</span>
                    <span className="text-zinc-500">→ 127.0.0.1:{t.targetPort} ({t.protocol.toUpperCase()})</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="border border-emerald-900 rounded p-3 bg-[#080d14]">
              <div className="text-emerald-300 font-bold mb-2">SECURITY SHIELD TELEMETRY</div>
              <div className="space-y-1 text-[11px] text-zinc-300">
                <div className="flex justify-between">
                  <span>DDoS Algorithm:</span>
                  <span className="text-white uppercase font-bold">{config.algorithm}</span>
                </div>
                <div className="flex justify-between">
                  <span>Jailed Botnet IPs:</span>
                  <span className="text-rose-400 font-bold">{config.blockedIpRecords.length} active bans</span>
                </div>
                <div className="flex justify-between">
                  <span>Dropped Requests:</span>
                  <span className="text-amber-400 font-bold">{telemetry.droppedRequestsCount} packets</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activePane === 'tunnels' && (
        <div className="border border-emerald-900 rounded p-3 bg-[#080d14] overflow-x-auto">
          <div className="text-emerald-300 font-bold mb-2">TUNNELS INVENTORY TABLE</div>
          <table className="w-full text-left text-[11px]">
            <thead className="text-zinc-500 border-b border-emerald-900/60 pb-1">
              <tr>
                <th className="py-1">SUBDOMAIN</th>
                <th className="py-1">LOCAL TARGET</th>
                <th className="py-1">PROTO</th>
                <th className="py-1">STREAMS</th>
                <th className="py-1">RPS LIMIT</th>
                <th className="py-1">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-900">
              {tunnels.map((t) => (
                <tr key={t.id} className="text-zinc-300">
                  <td className="py-1 text-emerald-400 font-bold">{t.subdomain}.edgeproxy.mesh</td>
                  <td className="py-1">{t.targetHost}:{t.targetPort}</td>
                  <td className="py-1 uppercase text-zinc-400">{t.protocol}</td>
                  <td className="py-1 text-white">{t.activeStreams}</td>
                  <td className="py-1 text-amber-400">{t.rateLimit.maxRps} r/s</td>
                  <td className="py-1 text-emerald-400 uppercase font-semibold">{t.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {activePane === 'logs' && (
        <div className="border border-emerald-900 rounded p-3 bg-[#080d14] space-y-2">
          <div className="flex items-center justify-between text-emerald-300 font-bold">
            <span>LIVE TRAFFIC LOG STREAM</span>
            <span className="text-zinc-500 text-[10px]">Showing last {requests.length} records</span>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1 text-[10px]">
            {requests.slice(0, 25).map((req) => (
              <div key={req.id} className="flex items-center gap-2 hover:bg-zinc-900/60 p-0.5 rounded">
                <span className="text-zinc-500">{new Date(req.timestamp).toLocaleTimeString()}</span>
                <span
                  className={`font-bold px-1 rounded ${
                    req.statusCode === 200
                      ? 'text-emerald-400 bg-emerald-950'
                      : req.statusCode === 429
                      ? 'text-amber-400 bg-amber-950'
                      : 'text-rose-400 bg-rose-950'
                  }`}
                >
                  [{req.statusCode}]
                </span>
                <span className="text-zinc-400 uppercase font-bold">{req.method}</span>
                <span className="text-zinc-200 truncate max-w-xs">{req.host}{req.path}</span>
                <span className="text-zinc-500 ml-auto">({req.durationMs}ms)</span>
                <span className="text-zinc-400">{req.clientIp}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {activePane === 'shield' && (
        <div className="border border-emerald-900 rounded p-3 bg-[#080d14] space-y-3">
          <div className="text-emerald-300 font-bold">RATE LIMITER & JAILED IP RECORDS</div>
          <div className="text-zinc-400 text-[11px]">
            Algorithm: {config.algorithm.toUpperCase()} | Capacity: {config.capacity} | Refill: {config.refillRate} tokens/sec
          </div>

          <table className="w-full text-left text-[11px]">
            <thead className="text-zinc-500 border-b border-emerald-900 pb-1">
              <tr>
                <th className="py-1">JAILED IP</th>
                <th className="py-1">REASON</th>
                <th className="py-1">EXPIRES IN</th>
              </tr>
            </thead>
            <tbody>
              {config.blockedIpRecords.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-2 text-zinc-500">No IPs currently jailed.</td>
                </tr>
              ) : (
                config.blockedIpRecords.map((r) => (
                  <tr key={r.ip} className="text-rose-400">
                    <td className="py-1 font-bold">{r.ip}</td>
                    <td className="py-1 text-zinc-300">{r.reason}</td>
                    <td className="py-1 text-amber-400">
                      {Math.max(0, Math.round((r.blockedUntil - Date.now()) / 1000))}s
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      {activePane === 'certs' && (
        <div className="border border-emerald-900 rounded p-3 bg-[#080d14] space-y-2">
          <div className="text-emerald-300 font-bold">ACME V2 SSL CERTIFICATES</div>
          <div className="space-y-2 text-[11px]">
            {certificates.map((c) => (
              <div key={c.id} className="p-2 border border-zinc-800 rounded bg-zinc-950">
                <div className="flex justify-between font-bold text-white">
                  <span>{c.domain}</span>
                  <span className="text-emerald-400">VALID ({c.daysRemaining} days left)</span>
                </div>
                <div className="text-zinc-400 text-[10px]">
                  Issuer: {c.issuer} • Challenge: {c.challengeType} • OCSP: {c.ocspStapled ? 'ENABLED' : 'DISABLED'}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Terminal Footer */}
      <div className="mt-4 pt-3 border-t border-emerald-950 text-zinc-500 text-[10px] flex flex-col sm:flex-row items-center justify-between gap-2">
        <div>Shortcuts: [1] Overview [2] Tunnels [3] Logs [4] Shield [5] Certs [A] Attack [Q] Exit</div>
        <div>EdgeProxy/v2.4 (built with Go/Rust async runtime)</div>
      </div>
    </div>
  );
};
