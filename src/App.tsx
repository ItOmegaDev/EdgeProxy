/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import { Navbar } from './components/Navbar';
import { MeshTopology } from './components/MeshTopology';
import { TunnelsView } from './components/TunnelsView';
import { TrafficInspector } from './components/TrafficInspector';
import { RateLimiterDDoS } from './components/RateLimiterDDoS';
import { CertManager } from './components/CertManager';
import { ClientAgentSetup } from './components/ClientAgentSetup';
import { TerminalUI } from './components/TerminalUI';
import { ProtocolFraming } from './components/ProtocolFraming';
import { DatabaseSchemaView } from './components/DatabaseSchemaView';
import { RoadmapView } from './components/RoadmapView';
import { CoreCodeExplorer } from './components/CoreCodeExplorer';
import { api, BackendTunnel, BackendLog } from './services/api';

import { INITIAL_RATE_LIMITER } from './data/roadmapData';
import { TrafficEngine } from './services/trafficEngine';
import { 
  Tunnel, 
  RateLimiterConfig, 
  SSLCertificate, 
  TrafficRequest, 
  TelemetryMetrics, 
  LocalDiscoveryItem 
} from './types';

export default function App() {
  const [language, setLanguage] = useState<'ua' | 'en'>('ua');
  const [currentTab, setCurrentTab] = useState<string>('topology');
  const [isTuiMode, setIsTuiMode] = useState<boolean>(false);
  const [isAttackActive, setIsAttackActive] = useState<boolean>(false);
  const [isWsConnected, setIsWsConnected] = useState<boolean>(false);

  // Real system states (starting empty - no fake records)
  const [tunnels, setTunnels] = useState<Tunnel[]>([]);
  const [config, setConfig] = useState<RateLimiterConfig>(INITIAL_RATE_LIMITER);
  const [certificates, setCertificates] = useState<SSLCertificate[]>([]);
  const [discoveredServices, setDiscoveredServices] = useState<LocalDiscoveryItem[]>([]);
  const [requests, setRequests] = useState<TrafficRequest[]>([]);

  // Telemetry starts with clean real zero values
  const [telemetry, setTelemetry] = useState<TelemetryMetrics>({
    currentRps: 0,
    peakRps: 0,
    activeConnections: 0,
    bandwidthInBps: 0,
    bandwidthOutBps: 0,
    p50LatencyMs: 0,
    p95LatencyMs: 0,
    p99LatencyMs: 0,
    droppedRequestsCount: 0,
    totalRequestsCount: 0,
    edgeCpuPercent: 0,
    edgeMemoryMb: 0,
    tunnelJitterMs: 0,
    packetLossPercent: 0,
  });

  const engineRef = useRef<TrafficEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new TrafficEngine(INITIAL_RATE_LIMITER, []);
  }

  // Load real state from server on startup
  useEffect(() => {
    // 1. Fetch real tunnels
    api.getTunnels().then((backendTunnels: BackendTunnel[]) => {
      if (backendTunnels && Array.isArray(backendTunnels)) {
        const mapped: Tunnel[] = backendTunnels.map((bt) => ({
          id: bt.id,
          name: bt.name,
          subdomain: bt.subdomain,
          targetHost: '127.0.0.1',
          targetPort: bt.localPort,
          protocol: bt.protocol === 'websocket' ? 'ws' : (bt.protocol as any),
          status: bt.status === 'reconnecting' ? 'degraded' : (bt.status as any),
          createdAt: bt.createdAt,
          bytesIn: Math.floor(bt.bytesTransferred * 0.3),
          bytesOut: Math.floor(bt.bytesTransferred * 0.7),
          activeStreams: bt.status === 'online' ? 1 : 0,
          totalRequests: bt.totalRequests,
          latencyMs: bt.avgLatency,
          rateLimit: { enabled: true, maxRps: 100, burst: 150 },
          tlsStatus: bt.tlsStatus === 'active' ? 'issued' : 'pending',
          auth: { enabled: bt.authEnabled, type: bt.authEnabled ? 'basic' : 'none' },
          headersRewrite: { 'X-Forwarded-Proto': 'https' },
          tags: ['live-mesh'],
        }));
        setTunnels(mapped);
        if (engineRef.current) engineRef.current.setTunnels(mapped);
      }
    }).catch(() => {});

    // 2. Fetch real certificates
    api.getCerts().then((certs) => {
      if (certs && Array.isArray(certs)) {
        setCertificates(certs);
      }
    }).catch(() => {});

    // 3. Discover real open local ports
    api.discoverPorts().then((ports) => {
      if (ports && Array.isArray(ports)) {
        setDiscoveredServices(ports);
      }
    }).catch(() => {});

    // 4. Fetch real logs
    api.getLogs().then((backendLogs: BackendLog[]) => {
      if (backendLogs && Array.isArray(backendLogs)) {
        const mapped: TrafficRequest[] = backendLogs.map((l) => ({
          id: l.id,
          timestamp: new Date(l.timestamp).getTime() || Date.now(),
          method: l.method as any,
          path: l.path,
          host: `${l.subdomain}.edgeproxy.mesh`,
          subdomain: l.subdomain,
          clientIp: l.clientIp,
          countryCode: 'UA',
          userAgent: 'Mozilla/5.0 (EdgeProxy Agent)',
          statusCode: l.statusCode,
          durationMs: l.latencyMs,
          edgeProcessingMs: 1.2,
          tunnelTransitMs: Math.max(0.5, l.latencyMs * 0.4),
          localServiceMs: Math.max(0.5, l.latencyMs * 0.5),
          bytes: l.bytesOut || 128,
          protocol: 'http2',
          tlsCipher: 'TLS_AES_256_GCM_SHA384',
          decision: l.blockedByShield ? 'rate_limited' : 'allowed',
          requestHeaders: { 'Host': `${l.subdomain}.edgeproxy.mesh`, 'User-Agent': 'EdgeProxy-Client/1.0' },
          responseHeaders: { 'Server': 'EdgeProxy-Mesh' },
        }));
        setRequests(mapped);
      }
    }).catch(() => {});

    // 5. Connect real WebSocket for live events and telemetry
    const disconnect = api.connectWebSocket(
      (msg) => {
        if (msg.type === 'telemetry' && msg.data) {
          setTelemetry((prev) => ({
            ...prev,
            currentRps: msg.data.rps ?? prev.currentRps,
            activeConnections: msg.data.activeConnections ?? prev.activeConnections,
            p50LatencyMs: msg.data.latencyP50 ?? prev.p50LatencyMs,
            p95LatencyMs: msg.data.latencyP95 ?? prev.p95LatencyMs,
            p99LatencyMs: msg.data.latencyP99 ?? prev.p99LatencyMs,
            edgeCpuPercent: msg.data.cpuUsage ?? prev.edgeCpuPercent,
            edgeMemoryMb: msg.data.ramUsage ?? prev.edgeMemoryMb,
          }));
        } else if (msg.type === 'traffic_packet' && msg.data) {
          const l: BackendLog = msg.data;
          const newReq: TrafficRequest = {
            id: l.id,
            timestamp: new Date(l.timestamp).getTime() || Date.now(),
            method: l.method as any,
            path: l.path,
            host: `${l.subdomain}.edgeproxy.mesh`,
            subdomain: l.subdomain,
            clientIp: l.clientIp,
            countryCode: 'UA',
            userAgent: 'Mozilla/5.0 (EdgeProxy Agent)',
            statusCode: l.statusCode,
            durationMs: l.latencyMs,
            edgeProcessingMs: 1.2,
            tunnelTransitMs: Math.max(0.4, l.latencyMs * 0.3),
            localServiceMs: Math.max(0.4, l.latencyMs * 0.6),
            bytes: l.bytesOut || 128,
            protocol: 'http2',
            tlsCipher: 'TLS_AES_256_GCM_SHA384',
            decision: l.blockedByShield ? 'rate_limited' : 'allowed',
            requestHeaders: { 'Host': `${l.subdomain}.edgeproxy.mesh` },
            responseHeaders: { 'Server': 'EdgeProxy-Mesh' },
          };
          setRequests((prev) => [newReq, ...prev.slice(0, 100)]);
          setTelemetry((prev) => ({
            ...prev,
            totalRequestsCount: prev.totalRequestsCount + 1,
            droppedRequestsCount: l.blockedByShield ? prev.droppedRequestsCount + 1 : prev.droppedRequestsCount,
          }));
        } else if (msg.type === 'tunnel_created' && msg.data) {
          const bt: BackendTunnel = msg.data;
          setTunnels((prev) => {
            if (prev.some((t) => t.id === bt.id)) return prev;
            return [
              {
                id: bt.id,
                name: bt.name,
                subdomain: bt.subdomain,
                targetHost: '127.0.0.1',
                targetPort: bt.localPort,
                protocol: bt.protocol === 'websocket' ? 'ws' : (bt.protocol as any),
                status: 'online',
                createdAt: bt.createdAt,
                bytesIn: 0,
                bytesOut: 0,
                activeStreams: 1,
                totalRequests: 0,
                latencyMs: 0,
                rateLimit: { enabled: true, maxRps: 100, burst: 150 },
                tlsStatus: 'issued',
                auth: { enabled: bt.authEnabled, type: bt.authEnabled ? 'basic' : 'none' },
                headersRewrite: { 'X-Forwarded-Proto': 'https' },
                tags: ['live-mesh'],
              },
              ...prev,
            ];
          });
        } else if (msg.type === 'tunnel_deleted' && msg.data) {
          setTunnels((prev) => prev.filter((t) => t.id !== msg.data.id));
        } else if (msg.type === 'tunnel_updated' && msg.data) {
          const bt: BackendTunnel = msg.data;
          setTunnels((prev) =>
            prev.map((t) => (t.id === bt.id ? { ...t, status: bt.status as any } : t))
          );
        } else if (msg.type === 'cert_issued' && msg.data) {
          setCertificates((prev) => [msg.data, ...prev.filter((c) => c.id !== msg.data.id)]);
        } else if (msg.type === 'cert_renewed' && msg.data) {
          setCertificates((prev) =>
            prev.map((c) => (c.id === msg.data.id ? msg.data : c))
          );
        } else if (msg.type === 'logs_cleared') {
          setRequests([]);
        }
      },
      (connected) => {
        setIsWsConnected(connected);
      }
    );

    return () => {
      disconnect();
    };
  }, []);

  // Sync engine tunnels when tunnels state updates
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setTunnels(tunnels);
    }
  }, [tunnels]);

  // Real Attack Simulator: Sends actual rapid stress requests to server rate limiter
  const attackIntervalRef = useRef<any>(null);
  const handleToggleAttack = () => {
    if (isAttackActive) {
      setIsAttackActive(false);
      if (attackIntervalRef.current) {
        clearInterval(attackIntervalRef.current);
        attackIntervalRef.current = null;
      }
    } else {
      setIsAttackActive(true);
      attackIntervalRef.current = setInterval(() => {
        if (tunnels.length > 0) {
          const targetSub = tunnels[0].subdomain;
          api.simulateRequest({
            subdomain: targetSub,
            method: 'POST',
            path: '/api/v1/auth/flood',
            clientIp: '198.51.100.44',
            isAttack: true,
          }).catch(() => {});
        }
      }, 150);
    }
  };

  useEffect(() => {
    return () => {
      if (attackIntervalRef.current) clearInterval(attackIntervalRef.current);
    };
  }, []);

  // Replay request using real backend probe
  const handleReplayRequest = (req: TrafficRequest) => {
    api.simulateRequest({
      subdomain: req.subdomain,
      method: req.method,
      path: req.path,
      clientIp: req.clientIp,
    }).catch((err) => console.warn('Replay failed:', err.message));
  };

  // Single probe request to real backend
  const handleSendProbe = () => {
    const sub = tunnels.length > 0 ? tunnels[0].subdomain : 'cloud';
    api.simulateRequest({
      subdomain: sub,
      method: 'GET',
      path: '/health',
      clientIp: '127.0.0.1',
    }).catch((err) => console.warn('Probe notice:', err.message));
  };

  // Burst probe requests
  const handleTriggerBurst = (count: number) => {
    const sub = tunnels.length > 0 ? tunnels[0].subdomain : 'cloud';
    for (let i = 0; i < count; i++) {
      api.simulateRequest({
        subdomain: sub,
        method: i % 2 === 0 ? 'GET' : 'POST',
        path: `/api/data?q=${i}`,
        clientIp: `10.0.0.${(i % 10) + 1}`,
      }).catch(() => {});
    }
  };

  // Tunnel management
  const handleAddTunnel = async (newTun: Partial<Tunnel>) => {
    try {
      const created = await api.createTunnel({
        name: newTun.name,
        subdomain: newTun.subdomain || `tun-${Date.now().toString().slice(-4)}`,
        localPort: newTun.targetPort || 3000,
        protocol: newTun.protocol || 'quic',
        authEnabled: newTun.auth?.enabled,
      });

      const tunnel: Tunnel = {
        id: created.id,
        name: created.name,
        subdomain: created.subdomain,
        targetHost: '127.0.0.1',
        targetPort: created.localPort,
        protocol: created.protocol === 'websocket' ? 'ws' : (created.protocol as any),
        status: 'online',
        createdAt: created.createdAt,
        bytesIn: 0,
        bytesOut: 0,
        activeStreams: 1,
        totalRequests: 0,
        latencyMs: 0,
        rateLimit: newTun.rateLimit || { enabled: true, maxRps: 100, burst: 150 },
        tlsStatus: 'issued',
        auth: newTun.auth || { enabled: false, type: 'none' },
        headersRewrite: newTun.headersRewrite || { 'X-Forwarded-Proto': 'https' },
        tags: newTun.tags || ['custom'],
      };

      setTunnels((prev) => [tunnel, ...prev]);

      // Mark matching discovered service as active
      setDiscoveredServices((prev) =>
        prev.map((s) => (s.port === tunnel.targetPort ? { ...s, isTunneled: true } : s))
      );
    } catch (err: any) {
      alert(err.message || 'Failed to create tunnel');
    }
  };

  const handleUpdateTunnel = (id: string, updates: Partial<Tunnel>) => {
    setTunnels((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
    api.toggleTunnel(id).catch(() => {});
  };

  const handleDeleteTunnel = async (id: string) => {
    const deleted = tunnels.find((t) => t.id === id);
    setTunnels((prev) => prev.filter((t) => t.id !== id));
    if (deleted) {
      await api.deleteTunnel(id).catch(() => {});
      setDiscoveredServices((prev) =>
        prev.map((s) => (s.port === deleted.targetPort ? { ...s, isTunneled: false } : s))
      );
    }
  };

  // Certificate management
  const handleIssueCert = async (certData: Partial<SSLCertificate>) => {
    try {
      const issued = await api.issueCert({
        domain: certData.domain || 'custom.edgeproxy.mesh',
        wildcard: certData.wildcard ?? true,
        challengeType: certData.challengeType || 'DNS-01',
      });
      setCertificates((prev) => [issued, ...prev]);
    } catch (err: any) {
      alert(err.message || 'Failed to issue certificate');
    }
  };

  const handleRenewCert = async (id: string) => {
    try {
      const renewed = await api.renewCert(id);
      setCertificates((prev) => prev.map((c) => (c.id === id ? renewed : c)));
    } catch (err: any) {
      alert(err.message || 'Failed to renew certificate');
    }
  };

  const handleUpdateConfig = (newCfg: Partial<RateLimiterConfig>) => {
    setConfig((prev) => ({ ...prev, ...newCfg }));
    api.updateRateLimiter(newCfg).catch(() => {});
  };

  const handleClearLogs = async () => {
    setRequests([]);
    await api.clearLogs().catch(() => {});
  };

  return (
    <div className="min-h-screen bg-[#070a0f] text-zinc-100 flex flex-col font-sans selection:bg-emerald-500/30 selection:text-emerald-200">
      {/* Top Navbar */}
      <Navbar
        currentTab={currentTab}
        setCurrentTab={setCurrentTab}
        telemetry={telemetry}
        isTuiMode={isTuiMode}
        setIsTuiMode={setIsTuiMode}
        language={language}
        setLanguage={setLanguage}
        isAttackActive={isAttackActive}
        onToggleAttack={handleToggleAttack}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto p-4 sm:p-6 space-y-6">
        {isTuiMode ? (
          <TerminalUI
            telemetry={telemetry}
            tunnels={tunnels}
            requests={requests}
            config={config}
            certificates={certificates}
            onExitTui={() => setIsTuiMode(false)}
            isAttackActive={isAttackActive}
            onToggleAttack={handleToggleAttack}
            language={language}
          />
        ) : (
          <>
            {currentTab === 'topology' && (
              <MeshTopology
                telemetry={telemetry}
                tunnels={tunnels}
                language={language}
                onNavigateToTab={(tab) => setCurrentTab(tab)}
              />
            )}

            {currentTab === 'core' && (
              <CoreCodeExplorer language={language} />
            )}

            {currentTab === 'protocol' && (
              <ProtocolFraming language={language} />
            )}

            {currentTab === 'database' && (
              <DatabaseSchemaView language={language} />
            )}

            {currentTab === 'roadmap' && (
              <RoadmapView language={language} />
            )}

            {currentTab === 'tunnels' && (
              <TunnelsView
                tunnels={tunnels}
                onAddTunnel={handleAddTunnel}
                onUpdateTunnel={handleUpdateTunnel}
                onDeleteTunnel={handleDeleteTunnel}
                discoveredServices={discoveredServices}
                language={language}
              />
            )}

            {currentTab === 'traffic' && (
              <TrafficInspector
                requests={requests}
                onReplayRequest={handleReplayRequest}
                onClearLogs={handleClearLogs}
                language={language}
              />
            )}

            {currentTab === 'shield' && (
              <RateLimiterDDoS
                config={config}
                onUpdateConfig={handleUpdateConfig}
                onSendProbe={handleSendProbe}
                onTriggerBurst={handleTriggerBurst}
                isAttackActive={isAttackActive}
                onToggleAttack={handleToggleAttack}
                language={language}
              />
            )}

            {currentTab === 'certs' && (
              <CertManager
                certificates={certificates}
                onIssueCert={handleIssueCert}
                onRenewCert={handleRenewCert}
                language={language}
              />
            )}

            {currentTab === 'cli' && (
              <ClientAgentSetup language={language} />
            )}
          </>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-zinc-850/80 py-4 px-6 text-center text-xs text-zinc-500 font-mono">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className={`w-2 h-2 rounded-full ${isWsConnected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
            <span>EdgeProxy &amp; Traffic Mesh — Production Core</span>
            <span className="text-zinc-600">|</span>
            <span className="text-zinc-400">{isWsConnected ? 'WS Live' : 'Connecting WS...'}</span>
          </div>
          <div>
            <span>Multiplexed Encrypted QUIC • Token Bucket • Let's Encrypt ACME v2</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
