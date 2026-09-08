import React, { useState } from 'react';
import { 
  Server, 
  Plus, 
  Copy, 
  Check, 
  ExternalLink, 
  Pause, 
  Play, 
  Trash2, 
  Settings2, 
  ShieldCheck, 
  Radio, 
  Zap, 
  Lock, 
  Globe,
  Sliders,
  AlertCircle
} from 'lucide-react';
import { Tunnel, ProtocolType, LocalDiscoveryItem } from '../types';

interface TunnelsViewProps {
  tunnels: Tunnel[];
  onAddTunnel: (tunnel: Partial<Tunnel>) => void;
  onUpdateTunnel: (id: string, updates: Partial<Tunnel>) => void;
  onDeleteTunnel: (id: string) => void;
  discoveredServices: LocalDiscoveryItem[];
  language: 'ua' | 'en';
}

export const TunnelsView: React.FC<TunnelsViewProps> = ({
  tunnels,
  onAddTunnel,
  onUpdateTunnel,
  onDeleteTunnel,
  discoveredServices,
  language,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [editingTunnel, setEditingTunnel] = useState<Tunnel | null>(null);

  // Form state
  const [formName, setFormName] = useState('');
  const [formSubdomain, setFormSubdomain] = useState('');
  const [formPort, setFormPort] = useState<number>(3000);
  const [formProtocol, setFormProtocol] = useState<ProtocolType>('quic');
  const [formMaxRps, setFormMaxRps] = useState<number>(100);
  const [formBurst, setFormBurst] = useState<number>(150);
  const [formAuthType, setFormAuthType] = useState<'none' | 'token' | 'basic'>('none');
  const [formToken, setFormToken] = useState('');

  const t = {
    ua: {
      title: 'Керування Тунелями та Портами',
      subtitle: 'Динамічна публікація локальних сервісів у глобальний інтернет через зашифрований Edge Mesh',
      newTunnelBtn: 'Створити Тунель',
      searchPlaceholder: 'Пошук за назвою, піддоменом або портом...',
      autoDiscoveryTitle: 'Виявлені локальні сервіси (Auto-Discovery):',
      exposeBtn: 'Опублікувати',
      target: 'Цільовий порт',
      streams: 'Потоки',
      traffic: 'Трафік',
      latency: 'Затримка',
      rateLimit: 'Ліміт RPS',
      actions: 'Дії',
      copyUrl: 'Скопіювати URL',
      copied: 'Скопійовано!',
      pause: 'Призупинити',
      resume: 'Відновити',
      edit: 'Налаштування',
      delete: 'Видалити',
      modalTitle: 'Новий тунель зворотного проксі (Reverse Proxy)',
      modalSubtitle: 'Маршрутизація трафіку з піддомену на локальний порт без публічного IP',
      nameLabel: 'Назва сервісу',
      subdomainLabel: 'Піддомен (наприклад: myapp)',
      portLabel: 'Локальний порт (127.0.0.1:port)',
      protoLabel: 'Протокол тунелювання',
      rpsLabel: 'Обмеження запитів (Max RPS)',
      burstLabel: 'Burst ємність (Bucket)',
      authLabel: 'Захист авторизацією',
      createBtn: 'Створити та Активувати Тунель',
      cancelBtn: 'Скасувати',
    },
    en: {
      title: 'Tunnel & Dynamic Port Management',
      subtitle: 'Publish local services to the public internet securely through encrypted Edge Mesh',
      newTunnelBtn: 'Create Tunnel',
      searchPlaceholder: 'Filter by name, subdomain, or port...',
      autoDiscoveryTitle: 'Detected Local Services (Auto-Discovery):',
      exposeBtn: 'Expose',
      target: 'Target Port',
      streams: 'Streams',
      traffic: 'Traffic',
      latency: 'Latency',
      rateLimit: 'Rate Limit',
      actions: 'Actions',
      copyUrl: 'Copy URL',
      copied: 'Copied!',
      pause: 'Pause',
      resume: 'Resume',
      edit: 'Configure',
      delete: 'Delete',
      modalTitle: 'New Reverse Proxy Tunnel',
      modalSubtitle: 'Route incoming traffic to local machine port bypassing NAT',
      nameLabel: 'Service Name',
      subdomainLabel: 'Subdomain (e.g. myapp)',
      portLabel: 'Local Port (127.0.0.1:port)',
      protoLabel: 'Tunnel Protocol',
      rpsLabel: 'Max Requests/Sec',
      burstLabel: 'Burst Capacity (Bucket)',
      authLabel: 'Authentication Shield',
      createBtn: 'Create & Activate Tunnel',
      cancelBtn: 'Cancel',
    },
  }[language];

  const handleCopy = (id: string, url: string) => {
    navigator.clipboard.writeText(url);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAutoExpose = (service: LocalDiscoveryItem) => {
    setFormName(service.name);
    setFormSubdomain(service.suggestedSubdomain);
    setFormPort(service.port);
    setFormProtocol(service.serviceType === 'Minecraft' ? 'tcp' : 'quic');
    setIsModalOpen(true);
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formSubdomain || !formPort) return;

    onAddTunnel({
      name: formName || `${formSubdomain} service`,
      subdomain: formSubdomain.toLowerCase().replace(/[^a-z0-9-]/g, ''),
      targetHost: '127.0.0.1',
      targetPort: Number(formPort),
      protocol: formProtocol,
      status: 'online',
      rateLimit: {
        enabled: true,
        maxRps: Number(formMaxRps),
        burst: Number(formBurst),
      },
      auth: {
        enabled: formAuthType !== 'none',
        type: formAuthType,
        token: formToken || undefined,
      },
      headersRewrite: {
        'X-Forwarded-Proto': 'https',
        'X-Real-IP': '$client_ip',
      },
      tags: [formProtocol, String(formPort)],
    });

    setIsModalOpen(false);
    resetForm();
  };

  const resetForm = () => {
    setFormName('');
    setFormSubdomain('');
    setFormPort(3000);
    setFormProtocol('quic');
    setFormMaxRps(100);
    setFormBurst(150);
    setFormAuthType('none');
    setFormToken('');
  };

  const filteredTunnels = tunnels.filter(
    (t) =>
      t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      t.subdomain.toLowerCase().includes(searchQuery.toLowerCase()) ||
      String(t.targetPort).includes(searchQuery)
  );

  const formatBytes = (bytes: number) => {
    if (bytes > 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / 1024).toFixed(0)} KB`;
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/80 border border-zinc-800 p-5 rounded-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <Server className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight font-mono">{t.title}</h1>
          </div>
          <p className="text-sm text-zinc-400 mt-1">{t.subtitle}</p>
        </div>

        <button
          onClick={() => {
            resetForm();
            setIsModalOpen(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-sm font-semibold transition-colors shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" />
          <span>{t.newTunnelBtn}</span>
        </button>
      </div>

      {/* Auto-Discovery Bar */}
      <div className="bg-zinc-950/70 border border-zinc-800/90 rounded-xl p-4">
        <div className="flex items-center gap-2 text-xs font-mono font-bold text-zinc-300 mb-3">
          <Zap className="w-4 h-4 text-amber-400" />
          <span>{t.autoDiscoveryTitle}</span>
        </div>

        <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
          {discoveredServices.map((service) => (
            <div
              key={service.id}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs font-mono whitespace-nowrap flex-shrink-0 hover:border-zinc-700"
            >
              <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
              <span className="text-white font-medium">{service.name}</span>
              <span className="text-zinc-500">:{service.port}</span>
              {service.isTunneled ? (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-400 border border-emerald-800">
                  Active
                </span>
              ) : (
                <button
                  onClick={() => handleAutoExpose(service)}
                  className="text-[10px] px-2 py-0.5 rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/40 font-bold transition-colors"
                >
                  + {t.exposeBtn}
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Search Filter */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.searchPlaceholder}
            className="w-full bg-zinc-900/90 border border-zinc-800 rounded-lg px-3 py-2 text-xs font-mono text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
        <div className="text-xs font-mono text-zinc-400">
          Total: <span className="text-white font-bold">{filteredTunnels.length}</span> active tunnels
        </div>
      </div>

      {/* Tunnel Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {filteredTunnels.map((tunnel) => {
          const publicUrl = `https://${tunnel.subdomain}.edgeproxy.mesh`;
          const isOnline = tunnel.status === 'online';

          return (
            <div
              key={tunnel.id}
              className={`bg-zinc-900/90 border rounded-xl p-4 transition-all ${
                isOnline ? 'border-zinc-800 hover:border-zinc-700' : 'border-zinc-800/50 opacity-60'
              }`}
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 mb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2.5 h-2.5 rounded-full ${
                        isOnline ? 'bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.8)]' : 'bg-zinc-600'
                      }`}
                    ></span>
                    <h3 className="font-bold text-white font-mono text-sm">{tunnel.name}</h3>
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs font-mono">
                    <span className="text-emerald-400 font-medium">{publicUrl}</span>
                    <button
                      onClick={() => handleCopy(tunnel.id, publicUrl)}
                      className="text-zinc-500 hover:text-zinc-200 transition-colors"
                      title={t.copyUrl}
                    >
                      {copiedId === tunnel.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-zinc-800 text-zinc-300 border border-zinc-700 font-bold">
                    {tunnel.protocol}
                  </span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                    TLS 1.3
                  </span>
                </div>
              </div>

              {/* Stats row */}
              <div className="grid grid-cols-4 gap-2 bg-zinc-950/70 p-2.5 rounded-lg border border-zinc-800/80 font-mono text-xs mb-3">
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">{t.target}</span>
                  <span className="text-white font-semibold">:{tunnel.targetPort}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">{t.streams}</span>
                  <span className="text-emerald-400 font-semibold">{tunnel.activeStreams}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">{t.traffic}</span>
                  <span className="text-zinc-300">{formatBytes(tunnel.bytesIn + tunnel.bytesOut)}</span>
                </div>
                <div>
                  <span className="text-[10px] text-zinc-500 block uppercase">{t.rateLimit}</span>
                  <span className="text-amber-300">{tunnel.rateLimit.maxRps} r/s</span>
                </div>
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800/80 text-xs font-mono">
                <div className="flex items-center gap-2 text-zinc-400">
                  <Globe className="w-3.5 h-3.5 text-zinc-500" />
                  <span>NAT: Direct P2P (14ms)</span>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() =>
                      onUpdateTunnel(tunnel.id, {
                        status: tunnel.status === 'online' ? 'offline' : 'online',
                      })
                    }
                    className="p-1.5 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                    title={tunnel.status === 'online' ? t.pause : t.resume}
                  >
                    {tunnel.status === 'online' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5 text-emerald-400" />}
                  </button>

                  <button
                    onClick={() => onDeleteTunnel(tunnel.id)}
                    className="p-1.5 rounded hover:bg-rose-950/50 text-zinc-500 hover:text-rose-400 transition-colors"
                    title={t.delete}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Modal for Creating New Tunnel */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-lg font-bold text-white font-mono">{t.modalTitle}</h2>
                <p className="text-xs text-zinc-400 mt-0.5">{t.modalSubtitle}</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="text-zinc-500 hover:text-zinc-300 text-sm font-mono"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleFormSubmit} className="space-y-3 font-mono text-xs">
              <div>
                <label className="block text-zinc-300 mb-1">{t.nameLabel}</label>
                <input
                  type="text"
                  required
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Nextcloud Homelab / Vite Dev"
                  className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-zinc-300 mb-1">{t.subdomainLabel}</label>
                  <div className="flex items-center">
                    <input
                      type="text"
                      required
                      value={formSubdomain}
                      onChange={(e) => setFormSubdomain(e.target.value)}
                      placeholder="myapp"
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-l px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                    />
                    <span className="bg-zinc-800 text-zinc-400 px-2 py-2 rounded-r border border-l-0 border-zinc-800 text-[10px]">
                      .edgeproxy.mesh
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-zinc-300 mb-1">{t.portLabel}</label>
                  <input
                    type="number"
                    required
                    value={formPort}
                    onChange={(e) => setFormPort(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-zinc-300 mb-1">{t.protoLabel}</label>
                  <select
                    value={formProtocol}
                    onChange={(e) => setFormProtocol(e.target.value as ProtocolType)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-2 text-white focus:outline-none focus:border-emerald-500 uppercase"
                  >
                    <option value="quic">QUIC (HTTP/3)</option>
                    <option value="http2">HTTP/2</option>
                    <option value="ws">WebSocket</option>
                    <option value="tcp">Raw TCP</option>
                  </select>
                </div>

                <div>
                  <label className="block text-zinc-300 mb-1">{t.rpsLabel}</label>
                  <input
                    type="number"
                    value={formMaxRps}
                    onChange={(e) => setFormMaxRps(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div>
                  <label className="block text-zinc-300 mb-1">{t.burstLabel}</label>
                  <input
                    type="number"
                    value={formBurst}
                    onChange={(e) => setFormBurst(Number(e.target.value))}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-300 mb-1">{t.authLabel}</label>
                <div className="grid grid-cols-3 gap-2 mb-2">
                  {(['none', 'token', 'basic'] as const).map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setFormAuthType(type)}
                      className={`py-1.5 rounded uppercase border text-center transition-colors ${
                        formAuthType === type
                          ? 'bg-emerald-600 text-white border-emerald-500'
                          : 'bg-zinc-950 text-zinc-400 border-zinc-800 hover:text-white'
                      }`}
                    >
                      {type}
                    </button>
                  ))}
                </div>

                {formAuthType === 'token' && (
                  <input
                    type="text"
                    value={formToken}
                    onChange={(e) => setFormToken(e.target.value)}
                    placeholder="Enter Secret Bearer Token..."
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                )}
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-zinc-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-colors"
                >
                  {t.cancelBtn}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors"
                >
                  {t.createBtn}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
