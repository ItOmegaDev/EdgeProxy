import React, { useState } from 'react';
import { 
  ShieldCheck, 
  ShieldAlert, 
  Flame, 
  Sliders, 
  RefreshCw, 
  Lock, 
  Unlock, 
  Zap, 
  AlertTriangle, 
  CheckCircle2, 
  Clock, 
  Terminal,
  Activity,
  Layers
} from 'lucide-react';
import { RateLimiterConfig, TrafficRequest } from '../types';

interface RateLimiterDDoSProps {
  config: RateLimiterConfig;
  onUpdateConfig: (newConfig: Partial<RateLimiterConfig>) => void;
  onSendProbe: () => void;
  onTriggerBurst: (count: number) => void;
  isAttackActive: boolean;
  onToggleAttack: () => void;
  language: 'ua' | 'en';
}

export const RateLimiterDDoS: React.FC<RateLimiterDDoSProps> = ({
  config,
  onUpdateConfig,
  onSendProbe,
  onTriggerBurst,
  isAttackActive,
  onToggleAttack,
  language,
}) => {
  const [newWhitelistedIp, setNewWhitelistedIp] = useState('');

  const t = {
    ua: {
      title: 'DDoS Захист та Rate Limiting',
      subtitle: 'Апаратний захист каналу на базі алгоритму Token Bucket та виявлення аномальних L7/SYN сплесків',
      algoTitle: 'Алгоритм обмеження частоти запитів:',
      tokenBucket: 'Token Bucket (Рекомендовано)',
      leakyBucket: 'Leaky Bucket',
      bucketVisual: 'Візуалізація Ємності Бакета (In-Memory / Redis):',
      currentTokens: 'Поточна кількість токенів:',
      capacityLabel: 'Burst Capacity (Макс. місткість бакета):',
      refillLabel: 'Refill Rate (Швидкість поповнення, токенів/сек):',
      anomalyLabel: 'Поріг аномалії L7 (RPS для авто-блокування):',
      jailDuration: 'Тривалість тимчасового бану IP:',
      generatorTitle: 'Генератор Навантаження та Стрес-Тест Захисту:',
      probeBtn: 'Надіслати 1 запит',
      burstBtn: 'Сплеск 100 запитів',
      startFloodBtn: 'Запустити L7 DDoS Атаку (500 RPS)',
      stopFloodBtn: 'Зупинити Атаку',
      jailedIpsTitle: 'Заблоковані IP-адреси та Jail Таблиця:',
      unbanBtn: 'Розблокувати',
      whitelistTitle: 'Дозволені підмережі (IP Whitelist / CIDR):',
      addBtn: 'Додати',
      ipCol: 'IP Адреса',
      reasonCol: 'Причина блокування',
      timeCol: 'Залишилось часу',
      synShield: 'SYN Flood & Slowloris Shield (TCP рівень)',
      l7Shield: 'Layer 7 HTTP Flood Detection (Edge рівень)',
      activeProtected: 'Захист активний: легітимний трафік не перевантажує локальний сервер',
    },
    en: {
      title: 'DDoS Shield & Rate Limiting Engine',
      subtitle: 'Real-time channel protection with Token Bucket rate limiting and anomaly L7/SYN flood defense',
      algoTitle: 'Rate Limiting Algorithm:',
      tokenBucket: 'Token Bucket (Recommended)',
      leakyBucket: 'Leaky Bucket',
      bucketVisual: 'Bucket Capacity State (In-Memory / Redis):',
      currentTokens: 'Current Available Tokens:',
      capacityLabel: 'Burst Capacity (Max bucket size):',
      refillLabel: 'Refill Rate (Tokens replenished per sec):',
      anomalyLabel: 'L7 Anomaly Threshold (RPS for auto-jail):',
      jailDuration: 'IP Jail Duration:',
      generatorTitle: 'Traffic Generator & Attack Stress-Test:',
      probeBtn: 'Send 1 Probe',
      burstBtn: 'Burst 100 Requests',
      startFloodBtn: 'Launch L7 HTTP Flood Attack (500 RPS)',
      stopFloodBtn: 'Stop Attack',
      jailedIpsTitle: 'Jailed IP Addresses (Automated Defense):',
      unbanBtn: 'Unban',
      whitelistTitle: 'Allowlisted CIDRs (Bypasses rate limit):',
      addBtn: 'Add CIDR',
      ipCol: 'IP Address',
      reasonCol: 'Trigger Reason',
      timeCol: 'Time Remaining',
      synShield: 'SYN Flood & Slowloris Shield (TCP layer)',
      l7Shield: 'Layer 7 HTTP Flood Detection (Edge layer)',
      activeProtected: 'Shield active: Local developer backend is safeguarded from collapsing',
    },
  }[language];

  const tokenPercent = Math.min(100, Math.max(0, (config.currentTokens / config.capacity) * 100));

  const handleUnban = (ipToUnban: string) => {
    onUpdateConfig({
      blockedIpRecords: config.blockedIpRecords.filter((rec) => rec.ip !== ipToUnban),
      blacklistedIps: config.blacklistedIps.filter((ip) => ip !== ipToUnban),
    });
  };

  const handleAddWhitelist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newWhitelistedIp) return;
    if (!config.whitelistedIps.includes(newWhitelistedIp)) {
      onUpdateConfig({
        whitelistedIps: [...config.whitelistedIps, newWhitelistedIp],
      });
    }
    setNewWhitelistedIp('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/80 border border-zinc-800 p-5 rounded-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight font-mono">{t.title}</h1>
          </div>
          <p className="text-sm text-zinc-400 mt-1">{t.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-mono px-2.5 py-1 rounded bg-emerald-950/70 border border-emerald-500/40 text-emerald-300 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>Redis State Synced</span>
          </span>
        </div>
      </div>

      {/* Main Grid: Visual Bucket on Left, Controls on Right */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Visual Token Bucket Container */}
        <div className="lg:col-span-5 bg-zinc-950 border border-zinc-800 rounded-xl p-5 flex flex-col justify-between shadow-lg">
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-bold text-white font-mono">{t.bucketVisual}</span>
              <span className="text-xs font-mono text-emerald-400 font-bold">
                {Math.floor(config.currentTokens)} / {config.capacity} Tokens
              </span>
            </div>

            {/* The Bucket representation */}
            <div className="relative w-full h-56 bg-zinc-900 border-2 border-zinc-700 rounded-b-2xl rounded-t-lg overflow-hidden flex flex-col justify-end p-2 shadow-inner">
              {/* Background measurement marks */}
              <div className="absolute inset-0 flex flex-col justify-between p-3 pointer-events-none opacity-20 font-mono text-[10px] text-zinc-400">
                <div className="border-b border-zinc-600">MAX BURST ({config.capacity})</div>
                <div className="border-b border-zinc-600">75%</div>
                <div className="border-b border-zinc-600">50%</div>
                <div className="border-b border-zinc-600">25%</div>
                <div className="border-b border-zinc-600">EMPTY (429 ACTIVE)</div>
              </div>

              {/* Water / Token level */}
              <div
                className={`w-full rounded-b-xl transition-all duration-300 relative ${
                  tokenPercent < 20
                    ? 'bg-gradient-to-t from-rose-600/80 to-rose-400/80'
                    : tokenPercent < 50
                    ? 'bg-gradient-to-t from-amber-600/80 to-amber-400/80'
                    : 'bg-gradient-to-t from-emerald-600/80 to-emerald-400/80'
                }`}
                style={{ height: `${tokenPercent}%` }}
              >
                {/* Surface wave */}
                <div className="absolute top-0 left-0 right-0 h-1 bg-white/40 animate-pulse"></div>
              </div>
            </div>

            <div className="flex items-center justify-between text-xs font-mono text-zinc-400 mt-3 pt-2 border-t border-zinc-800">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>Refill: +{config.refillRate} tokens/s</span>
              </div>
              <div>
                Status:{' '}
                <span
                  className={`font-bold ${
                    tokenPercent < 15 ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {tokenPercent < 15 ? 'THROTTLING (429)' : 'NOMINAL (200 OK)'}
                </span>
              </div>
            </div>
          </div>

          {/* Algorithm selection pills */}
          <div className="mt-4 pt-4 border-t border-zinc-800">
            <span className="text-[11px] font-mono text-zinc-400 block mb-2">{t.algoTitle}</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onUpdateConfig({ algorithm: 'token_bucket' })}
                className={`py-2 px-3 rounded-lg border text-xs font-mono font-medium transition-colors ${
                  config.algorithm === 'token_bucket'
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {t.tokenBucket}
              </button>
              <button
                onClick={() => onUpdateConfig({ algorithm: 'leaky_bucket' })}
                className={`py-2 px-3 rounded-lg border text-xs font-mono font-medium transition-colors ${
                  config.algorithm === 'leaky_bucket'
                    ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                    : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
                }`}
              >
                {t.leakyBucket}
              </button>
            </div>
          </div>
        </div>

        {/* Configuration Sliders & Toggles on Right */}
        <div className="lg:col-span-7 space-y-4">
          {/* Sliders Box */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 space-y-4 font-mono text-xs">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-emerald-400" />
                <span className="font-bold text-white text-sm">Dynamic Parameters</span>
              </div>
              <span className="text-[11px] text-zinc-400">Hot-reloaded without service restart</span>
            </div>

            {/* Capacity Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-zinc-300">
                <span>{t.capacityLabel}</span>
                <span className="text-emerald-400 font-bold">{config.capacity} requests</span>
              </div>
              <input
                type="range"
                min="20"
                max="300"
                step="5"
                value={config.capacity}
                onChange={(e) => onUpdateConfig({ capacity: Number(e.target.value) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Refill Rate Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-zinc-300">
                <span>{t.refillLabel}</span>
                <span className="text-emerald-400 font-bold">{config.refillRate} req/sec</span>
              </div>
              <input
                type="range"
                min="5"
                max="150"
                step="5"
                value={config.refillRate}
                onChange={(e) => onUpdateConfig({ refillRate: Number(e.target.value) })}
                className="w-full accent-emerald-500 cursor-pointer"
              />
            </div>

            {/* Anomaly Threshold Slider */}
            <div className="space-y-1.5">
              <div className="flex justify-between text-zinc-300">
                <span>{t.anomalyLabel}</span>
                <span className="text-amber-400 font-bold">{config.anomalyThresholdRps} RPS burst</span>
              </div>
              <input
                type="range"
                min="50"
                max="500"
                step="25"
                value={config.anomalyThresholdRps}
                onChange={(e) => onUpdateConfig({ anomalyThresholdRps: Number(e.target.value) })}
                className="w-full accent-amber-500 cursor-pointer"
              />
            </div>

            {/* Feature Checkboxes */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-3 border-t border-zinc-800">
              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={config.enableL7FloodShield}
                  onChange={(e) => onUpdateConfig({ enableL7FloodShield: e.target.checked })}
                  className="rounded accent-emerald-500"
                />
                <span>{t.l7Shield}</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                <input
                  type="checkbox"
                  checked={config.enableSynFloodShield}
                  onChange={(e) => onUpdateConfig({ enableSynFloodShield: e.target.checked })}
                  className="rounded accent-emerald-500"
                />
                <span>{t.synShield}</span>
              </label>
            </div>
          </div>

          {/* Interactive Attack Simulator Control */}
          <div className="bg-zinc-900/90 border border-zinc-800 rounded-xl p-5 font-mono text-xs">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Flame className="w-4 h-4 text-rose-400" />
                <span className="font-bold text-white text-sm">{t.generatorTitle}</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <button
                onClick={onSendProbe}
                className="py-2.5 px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors"
              >
                {t.probeBtn}
              </button>

              <button
                onClick={() => onTriggerBurst(100)}
                className="py-2.5 px-3 rounded-lg bg-amber-950/60 hover:bg-amber-900/60 border border-amber-500/40 text-amber-300 transition-colors"
              >
                {t.burstBtn}
              </button>

              <button
                onClick={onToggleAttack}
                className={`py-2.5 px-3 rounded-lg font-bold transition-all ${
                  isAttackActive
                    ? 'bg-rose-600 text-white animate-pulse shadow-lg shadow-rose-900/50'
                    : 'bg-rose-950/60 hover:bg-rose-900/60 border border-rose-500/40 text-rose-300'
                }`}
              >
                {isAttackActive ? t.stopFloodBtn : t.startFloodBtn}
              </button>
            </div>

            {isAttackActive && (
              <div className="mt-3 py-2 px-3 rounded bg-rose-950/80 border border-rose-500/50 text-rose-300 text-[11px] flex items-center gap-2 animate-fadeIn">
                <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 animate-bounce" />
                <span>
                  High-volume Layer 7 flood incoming! Token bucket drained, 429 Too Many Requests shedding load, botnet IPs auto-quarantined.
                </span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Jailed IPs Table */}
      <div className="bg-zinc-950 border border-zinc-800 rounded-xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lock className="w-4 h-4 text-rose-400" />
            <h3 className="font-bold text-white font-mono text-sm">{t.jailedIpsTitle}</h3>
          </div>
          <span className="text-xs font-mono text-zinc-500">
            Auto-purged when timer expires
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left font-mono text-xs">
            <thead className="bg-zinc-900/80 text-zinc-400 text-[10px] uppercase border-b border-zinc-800">
              <tr>
                <th className="py-2 px-3">{t.ipCol}</th>
                <th className="py-2 px-3">{t.reasonCol}</th>
                <th className="py-2 px-3">{t.timeCol}</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-850">
              {config.blockedIpRecords.length === 0 ? (
                <tr>
                  <td colSpan={4} className="py-4 text-center text-zinc-500">
                    No IPs currently in quarantine jail.
                  </td>
                </tr>
              ) : (
                config.blockedIpRecords.map((rec) => {
                  const remainingSec = Math.max(0, Math.round((rec.blockedUntil - Date.now()) / 1000));
                  return (
                    <tr key={rec.ip} className="hover:bg-zinc-900/50">
                      <td className="py-2.5 px-3 text-rose-400 font-bold">{rec.ip}</td>
                      <td className="py-2.5 px-3 text-zinc-300">{rec.reason}</td>
                      <td className="py-2.5 px-3 text-amber-400 font-semibold">{remainingSec}s</td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          onClick={() => handleUnban(rec.ip)}
                          className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 text-[11px] transition-colors"
                        >
                          {t.unbanBtn}
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Whitelist Manager */}
      <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl p-5 font-mono text-xs">
        <h3 className="font-bold text-white text-sm mb-2">{t.whitelistTitle}</h3>
        <div className="flex flex-wrap gap-2 mb-3">
          {config.whitelistedIps.map((ip) => (
            <span
              key={ip}
              className="px-2.5 py-1 rounded bg-zinc-950 border border-zinc-750 text-emerald-300 flex items-center gap-1.5"
            >
              <CheckCircle2 className="w-3 h-3 text-emerald-400" />
              <span>{ip}</span>
            </span>
          ))}
        </div>

        <form onSubmit={handleAddWhitelist} className="flex gap-2 max-w-md">
          <input
            type="text"
            value={newWhitelistedIp}
            onChange={(e) => setNewWhitelistedIp(e.target.value)}
            placeholder="e.g. 192.168.1.0/24 or 10.0.0.1"
            className="flex-1 bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-white focus:outline-none focus:border-emerald-500"
          />
          <button
            type="submit"
            className="px-3 py-1.5 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold transition-colors"
          >
            {t.addBtn}
          </button>
        </form>
      </div>
    </div>
  );
};
