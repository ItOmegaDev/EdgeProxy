import React from 'react';
import { 
  ShieldCheck, 
  Terminal, 
  Globe, 
  Radio, 
  Layers, 
  Server, 
  Flame, 
  KeyRound, 
  DownloadCloud, 
  Zap,
  Activity,
  Binary,
  Database,
  GitBranch
} from 'lucide-react';
import { TelemetryMetrics } from '../types';

interface NavbarProps {
  currentTab: string;
  setCurrentTab: (tab: string) => void;
  telemetry: TelemetryMetrics;
  isTuiMode: boolean;
  setIsTuiMode: (val: boolean) => void;
  language: 'ua' | 'en';
  setLanguage: (lang: 'ua' | 'en') => void;
  isAttackActive: boolean;
  onToggleAttack: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentTab,
  setCurrentTab,
  telemetry,
  isTuiMode,
  setIsTuiMode,
  language,
  setLanguage,
  isAttackActive,
  onToggleAttack,
}) => {
  const t = {
    ua: {
      appName: 'EdgeProxy',
      badge: 'Traffic Mesh',
      edgeStatus: 'Edge Node: Frankfurt (VPS-01)',
      tunnelQuic: 'QUIC Тунель: Активний',
      rtt: 'RTT',
      navMesh: 'Архітектура',
      navProtocol: 'Бінарний Протокол',
      navDb: 'База SQL',
      navRoadmap: 'План Розробки',
      navTunnels: 'Тунелі',
      navTraffic: 'Live Трафік',
      navShield: 'DDoS & Ліміти',
      navCerts: 'SSL / ACME',
      navCLI: 'CLI Агент',
      terminalMode: 'TUI Режим',
      attackRunning: 'Атака триває...',
      testAttack: 'DDoS Тест',
    },
    en: {
      appName: 'EdgeProxy',
      badge: 'Traffic Mesh',
      edgeStatus: 'Edge Node: Frankfurt (VPS-01)',
      tunnelQuic: 'QUIC Tunnel: Active',
      rtt: 'RTT',
      navMesh: 'Architecture',
      navProtocol: 'Binary Protocol',
      navDb: 'Database SQL',
      navRoadmap: 'Dev Roadmap',
      navTunnels: 'Tunnels',
      navTraffic: 'Live Traffic',
      navShield: 'DDoS & Shield',
      navCerts: 'SSL / ACME',
      navCLI: 'CLI & Deploy',
      terminalMode: 'TUI Mode',
      attackRunning: 'Attack Active...',
      testAttack: 'DDoS Test',
    },
  }[language];

  const navItems = [
    { id: 'topology', label: t.navMesh, icon: Layers },
    { id: 'protocol', label: t.navProtocol, icon: Binary },
    { id: 'database', label: t.navDb, icon: Database },
    { id: 'roadmap', label: t.navRoadmap, icon: GitBranch },
    { id: 'tunnels', label: t.navTunnels, icon: Server },
    { id: 'traffic', label: t.navTraffic, icon: Activity },
    { id: 'shield', label: t.navShield, icon: ShieldCheck },
    { id: 'certs', label: t.navCerts, icon: KeyRound },
    { id: 'cli', label: t.navCLI, icon: DownloadCloud },
  ];

  return (
    <header className="sticky top-0 z-40 bg-[#0c1017]/95 backdrop-blur-md border-b border-emerald-950/60 text-emerald-100 px-4 py-2.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3">
        {/* Left branding */}
        <div className="flex items-center gap-3 w-full md:w-auto justify-between md:justify-start">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center w-9 h-9 rounded-lg bg-emerald-950/80 border border-emerald-500/40 shadow-[0_0_15px_rgba(16,185,129,0.15)] text-emerald-400">
              <Radio className="w-5 h-5 animate-pulse" />
              <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-bold tracking-tight text-white font-mono text-lg">{t.appName}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
                  {t.badge}
                </span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400">
                  v2.4.1
                </span>
              </div>
              <div className="text-[11px] text-zinc-400 flex items-center gap-2 font-mono">
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                <span>{t.edgeStatus}</span>
                <span className="text-zinc-600">•</span>
                <span className="text-emerald-400/90">{t.tunnelQuic}</span>
                <span className="text-zinc-600">•</span>
                <span>{t.rtt}: 14.2ms</span>
              </div>
            </div>
          </div>

          {/* Quick Attack Button on mobile */}
          <div className="flex items-center gap-2 md:hidden">
            <button
              onClick={onToggleAttack}
              className={`text-xs px-2.5 py-1.5 rounded flex items-center gap-1 font-mono transition-colors ${
                isAttackActive 
                  ? 'bg-rose-600/90 text-white animate-pulse' 
                  : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700'
              }`}
            >
              <Flame className="w-3.5 h-3.5" />
              {isAttackActive ? t.attackRunning : t.testAttack}
            </button>
          </div>
        </div>

        {/* Center Nav tabs */}
        <nav className="flex items-center overflow-x-auto w-full md:w-auto pb-1 md:pb-0 gap-1 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = currentTab === item.id && !isTuiMode;
            return (
              <button
                key={item.id}
                onClick={() => {
                  setIsTuiMode(false);
                  setCurrentTab(item.id);
                }}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  isActive
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-[0_0_10px_rgba(16,185,129,0.1)]'
                    : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        {/* Right tools: Attack generator, TUI switch, language */}
        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          {/* Quick DDoS Simulation button */}
          <button
            onClick={onToggleAttack}
            title="Simulate L7 DDoS / SYN Flood Attack to test Rate Limiter & Shield"
            className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono font-medium transition-all ${
              isAttackActive
                ? 'bg-rose-500/20 border border-rose-500 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.3)] animate-pulse'
                : 'bg-zinc-900 border border-zinc-700 text-zinc-300 hover:border-rose-500/50 hover:text-rose-300'
            }`}
          >
            <Flame className={`w-3.5 h-3.5 ${isAttackActive ? 'text-rose-400' : 'text-zinc-400'}`} />
            <span>{isAttackActive ? t.attackRunning : t.testAttack}</span>
          </button>

          {/* TUI mode toggle */}
          <button
            onClick={() => setIsTuiMode(!isTuiMode)}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-mono transition-all border ${
              isTuiMode
                ? 'bg-amber-500/20 border-amber-500 text-amber-300 shadow-[0_0_10px_rgba(245,158,11,0.2)]'
                : 'bg-zinc-900 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:border-zinc-500'
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t.terminalMode}</span>
          </button>

          {/* Language selector */}
          <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded p-0.5 text-xs font-mono">
            <button
              onClick={() => setLanguage('ua')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                language === 'ua' ? 'bg-emerald-600 text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              UA
            </button>
            <button
              onClick={() => setLanguage('en')}
              className={`px-1.5 py-0.5 rounded transition-colors ${
                language === 'en' ? 'bg-emerald-600 text-white font-bold' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              EN
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};
