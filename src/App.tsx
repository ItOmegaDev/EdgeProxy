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

import { 
  INITIAL_TUNNELS, 
  INITIAL_RATE_LIMITER, 
  INITIAL_CERTS, 
  DISCOVERED_LOCAL_SERVICES 
} from './mockData';
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

  // Core system states
  const [tunnels, setTunnels] = useState<Tunnel[]>(INITIAL_TUNNELS);
  const [config, setConfig] = useState<RateLimiterConfig>(INITIAL_RATE_LIMITER);
  const [certificates, setCertificates] = useState<SSLCertificate[]>(INITIAL_CERTS);
  const [discoveredServices, setDiscoveredServices] = useState<LocalDiscoveryItem[]>(DISCOVERED_LOCAL_SERVICES);

  // Traffic Engine instance
  const engineRef = useRef<TrafficEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new TrafficEngine(INITIAL_RATE_LIMITER, INITIAL_TUNNELS);
  }

  const [requests, setRequests] = useState<TrafficRequest[]>(() =>
    engineRef.current ? engineRef.current.getRecentRequests() : []
  );

  const [telemetry, setTelemetry] = useState<TelemetryMetrics>(() =>
    engineRef.current ? engineRef.current.getTelemetry() : {
      currentRps: 24,
      peakRps: 80,
      activeConnections: 140,
      bandwidthInBps: 28400,
      bandwidthOutBps: 92000,
      p50LatencyMs: 14.2,
      p95LatencyMs: 28.5,
      p99LatencyMs: 54.1,
      droppedRequestsCount: 2,
      totalRequestsCount: 1420,
      edgeCpuPercent: 4.8,
      edgeMemoryMb: 48.4,
      tunnelJitterMs: 0.65,
      packetLossPercent: 0.01,
    }
  );

  // Sync engine when tunnels or config update
  useEffect(() => {
    if (engineRef.current) {
      engineRef.current.setTunnels(tunnels);
    }
  }, [tunnels]);

  // Periodic real-time heartbeat: generates gentle traffic and refreshes telemetry
  useEffect(() => {
    const interval = setInterval(() => {
      if (engineRef.current) {
        // Generate 1-2 random requests to keep telemetry active
        const count = Math.random() > 0.4 ? 2 : 1;
        for (let i = 0; i < count; i++) {
          engineRef.current.generateRequest();
        }

        setRequests(engineRef.current.getRecentRequests(60));
        setTelemetry(engineRef.current.getTelemetry());
        setConfig(engineRef.current.getConfig());
      }
    }, 1200);

    return () => clearInterval(interval);
  }, []);

  // Attack simulator toggle
  const handleToggleAttack = () => {
    if (!engineRef.current) return;

    if (isAttackActive) {
      engineRef.current.stopAttackSimulation();
      setIsAttackActive(false);
    } else {
      setIsAttackActive(true);
      engineRef.current.startAttackSimulation((req) => {
        if (engineRef.current) {
          setRequests(engineRef.current.getRecentRequests(60));
          setTelemetry(engineRef.current.getTelemetry());
          setConfig(engineRef.current.getConfig());
        }
      });
    }
  };

  // Replay request
  const handleReplayRequest = (req: TrafficRequest) => {
    if (!engineRef.current) return;
    engineRef.current.generateRequest({
      forceSubdomain: req.subdomain,
      clientIp: req.clientIp,
      method: req.method,
      customPath: req.path,
    });
    setRequests(engineRef.current.getRecentRequests(60));
    setTelemetry(engineRef.current.getTelemetry());
  };

  // Single probe request
  const handleSendProbe = () => {
    if (!engineRef.current) return;
    engineRef.current.generateRequest({
      method: 'GET',
      customPath: '/api/v1/healthz',
    });
    setRequests(engineRef.current.getRecentRequests(60));
    setTelemetry(engineRef.current.getTelemetry());
  };

  // Burst requests
  const handleTriggerBurst = (count: number) => {
    if (!engineRef.current) return;
    for (let i = 0; i < count; i++) {
      engineRef.current.generateRequest();
    }
    setRequests(engineRef.current.getRecentRequests(60));
    setTelemetry(engineRef.current.getTelemetry());
    setConfig(engineRef.current.getConfig());
  };

  // Tunnel actions
  const handleAddTunnel = (newTun: Partial<Tunnel>) => {
    const tunnel: Tunnel = {
      id: `tun-${Date.now()}`,
      name: newTun.name || 'New Tunnel',
      subdomain: newTun.subdomain || `tun-${Math.floor(Math.random() * 1000)}`,
      targetHost: newTun.targetHost || '127.0.0.1',
      targetPort: newTun.targetPort || 3000,
      protocol: newTun.protocol || 'quic',
      status: 'online',
      createdAt: new Date().toISOString(),
      bytesIn: 1024,
      bytesOut: 4096,
      activeStreams: 2,
      totalRequests: 1,
      latencyMs: 14.5,
      rateLimit: newTun.rateLimit || { enabled: true, maxRps: 100, burst: 150 },
      tlsStatus: 'issued',
      auth: newTun.auth || { enabled: false, type: 'none' },
      headersRewrite: newTun.headersRewrite || { 'X-Forwarded-Proto': 'https' },
      tags: newTun.tags || ['custom'],
    };

    setTunnels((prev) => [tunnel, ...prev]);

    // Mark discovered service as tunneled if port matches
    setDiscoveredServices((prev) =>
      prev.map((s) => (s.port === tunnel.targetPort ? { ...s, isTunneled: true } : s))
    );
  };

  const handleUpdateTunnel = (id: string, updates: Partial<Tunnel>) => {
    setTunnels((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const handleDeleteTunnel = (id: string) => {
    const deleted = tunnels.find((t) => t.id === id);
    setTunnels((prev) => prev.filter((t) => t.id !== id));
    if (deleted) {
      setDiscoveredServices((prev) =>
        prev.map((s) => (s.port === deleted.targetPort ? { ...s, isTunneled: false } : s))
      );
    }
  };

  // Certificate actions
  const handleIssueCert = (certData: Partial<SSLCertificate>) => {
    const cert: SSLCertificate = {
      id: `cert-${Date.now()}`,
      domain: certData.domain || '*.custom.mesh',
      wildcard: certData.wildcard ?? true,
      issuer: "Let's Encrypt Authority E1",
      status: 'valid',
      validFrom: certData.validFrom || new Date().toISOString().split('T')[0],
      validTo: certData.validTo || new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
      daysRemaining: 90,
      challengeType: certData.challengeType || 'DNS-01',
      sanList: certData.sanList || [certData.domain || ''],
      ocspStapled: true,
      fingerprint: certData.fingerprint || 'SHA256: 8F:90:BA:11:42:00',
      autoRenew: true,
    };
    setCertificates((prev) => [cert, ...prev]);
  };

  const handleRenewCert = (id: string) => {
    setCertificates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, status: 'renewing' } : c))
    );
    setTimeout(() => {
      setCertificates((prev) =>
        prev.map((c) => (c.id === id ? { ...c, status: 'valid', daysRemaining: 90 } : c))
      );
    }, 1500);
  };

  const handleUpdateConfig = (newCfg: Partial<RateLimiterConfig>) => {
    if (engineRef.current) {
      const updated = engineRef.current.updateConfig(newCfg);
      setConfig(updated);
    }
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
                onClearLogs={() => setRequests([])}
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
            <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
            <span>EdgeProxy &amp; Traffic Mesh — High-Performance Reverse Proxy Core</span>
          </div>
          <div>
            <span>Multiplexed Encrypted QUIC • Token Bucket • Let's Encrypt ACME v2</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
