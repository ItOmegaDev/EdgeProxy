import React, { useState } from 'react';
import { 
  KeyRound, 
  ShieldCheck, 
  RefreshCw, 
  Plus, 
  CheckCircle2, 
  Clock, 
  Lock, 
  ExternalLink, 
  AlertCircle,
  FileCode,
  Zap,
  Globe
} from 'lucide-react';
import { SSLCertificate } from '../types';

interface CertManagerProps {
  certificates: SSLCertificate[];
  onIssueCert: (cert: Partial<SSLCertificate>) => void;
  onRenewCert: (id: string) => void;
  language: 'ua' | 'en';
}

export const CertManager: React.FC<CertManagerProps> = ({
  certificates,
  onIssueCert,
  onRenewCert,
  language,
}) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [issueStep, setIssueStep] = useState<'form' | 'challenge' | 'issued'>('form');
  const [domainInput, setDomainInput] = useState('');
  const [challengeType, setChallengeType] = useState<'DNS-01' | 'HTTP-01'>('DNS-01');
  const [isWildcard, setIsWildcard] = useState(true);

  const t = {
    ua: {
      title: 'Автоматичний SSL / Let\'s Encrypt (ACME v2)',
      subtitle: 'Випуск та авто-оновлення Wildcard SSL-сертифікатів для піддоменів без простою сервісу',
      issueNewBtn: 'Випустити Новий Сертифікат',
      acmeStatus: 'ACME v2 Directory: З\'єднано з Let\'s Encrypt Production',
      domainCol: 'Домен / Піддомени',
      issuerCol: 'Центр Сертифікації',
      expiresCol: 'Термін дії',
      statusCol: 'Статус',
      renewCol: 'Авто-оновлення',
      actionsCol: 'Дії',
      forceRenewBtn: 'Оновити зараз',
      renewing: 'Оновлюється...',
      modalTitle: 'Випуск SSL Сертифіката (ACME v2)',
      modalSubtitle: 'Генерація ключів ECDSA P-256 та перевірка власності домену',
      domainLabel: 'Доменне ім\'я (наприклад: *.myhomelab.dev або app.mydomain.com)',
      wildcardLabel: 'Випустити Wildcard сертифікат (*.domain.com)',
      challengeLabel: 'Тип ACME перевірки:',
      dnsChallengeDesc: 'DNS-01: Створення TXT запису _acme-challenge (підходить для Wildcard)',
      httpChallengeDesc: 'HTTP-01: Перевірка через /.well-known/acme-challenge/ на 80 порту',
      startIssueBtn: 'Почати випуск сертифіката',
      verifyingTitle: 'Виконується перевірка челенджу...',
      verifyingDesc: 'EdgeProxy звертається до DNS авторитетного сервера для валідації токена',
      issuedSuccess: 'Сертифікат успішно згенеровано та встановлено в EdgeProxy!',
      closeBtn: 'Закрити',
      ocspStapled: 'OCSP Stapling: Активно',
    },
    en: {
      title: 'Automated SSL / Let\'s Encrypt (ACME v2)',
      subtitle: 'Seamless issuance & auto-renewal of Wildcard SSL certificates for all mesh subdomains',
      issueNewBtn: 'Issue New Certificate',
      acmeStatus: 'ACME v2 Directory: Connected to Let\'s Encrypt Production',
      domainCol: 'Domain / SANs',
      issuerCol: 'Certificate Authority',
      expiresCol: 'Validity',
      statusCol: 'Status',
      renewCol: 'Auto-Renew',
      actionsCol: 'Actions',
      forceRenewBtn: 'Renew Now',
      renewing: 'Renewing...',
      modalTitle: 'SSL Certificate Issuance (ACME v2)',
      modalSubtitle: 'ECDSA P-256 key generation & domain ownership verification',
      domainLabel: 'Domain Name (e.g. *.myhomelab.dev or app.mydomain.com)',
      wildcardLabel: 'Issue Wildcard Certificate (*.domain.com)',
      challengeLabel: 'ACME Challenge Type:',
      dnsChallengeDesc: 'DNS-01: TXT record _acme-challenge verification (required for Wildcards)',
      httpChallengeDesc: 'HTTP-01: HTTP route /.well-known/acme-challenge/ on port 80',
      startIssueBtn: 'Start Certificate Issuance',
      verifyingTitle: 'Verifying ACME Challenge...',
      verifyingDesc: 'EdgeProxy is checking DNS propagation for the temporary verification token',
      issuedSuccess: 'Certificate issued and hot-reloaded into EdgeProxy router!',
      closeBtn: 'Close',
      ocspStapled: 'OCSP Stapling: Active',
    },
  }[language];

  const handleStartIssue = (e: React.FormEvent) => {
    e.preventDefault();
    if (!domainInput) return;
    setIssueStep('challenge');

    setTimeout(() => {
      setIssueStep('issued');
      onIssueCert({
        domain: isWildcard && !domainInput.startsWith('*.') ? `*.${domainInput}` : domainInput,
        wildcard: isWildcard,
        issuer: "Let's Encrypt Authority E1",
        status: 'valid',
        validFrom: new Date().toISOString().split('T')[0],
        validTo: new Date(Date.now() + 90 * 86400000).toISOString().split('T')[0],
        daysRemaining: 90,
        challengeType,
        sanList: [domainInput, `*.${domainInput}`],
        ocspStapled: true,
        fingerprint: `SHA256: ${Math.random().toString(16).substring(2, 10).toUpperCase()}:${Math.random().toString(16).substring(2, 10).toUpperCase()}`,
        autoRenew: true,
      });
    }, 1800);
  };

  const handleModalClose = () => {
    setIsModalOpen(false);
    setIssueStep('form');
    setDomainInput('');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-zinc-900/80 border border-zinc-800 p-5 rounded-xl">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-400">
              <KeyRound className="w-5 h-5" />
            </span>
            <h1 className="text-xl font-bold text-white tracking-tight font-mono">{t.title}</h1>
          </div>
          <p className="text-sm text-zinc-400 mt-1">{t.subtitle}</p>
        </div>

        <button
          onClick={() => {
            setIssueStep('form');
            setIsModalOpen(true);
          }}
          className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-mono text-sm font-semibold transition-colors shadow-lg shadow-emerald-900/30"
        >
          <Plus className="w-4 h-4" />
          <span>{t.issueNewBtn}</span>
        </button>
      </div>

      {/* ACME Status Banner */}
      <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2 text-emerald-300">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>{t.acmeStatus}</span>
        </div>
        <div className="flex items-center gap-3 text-zinc-400">
          <span className="flex items-center gap-1">
            <Lock className="w-3.5 h-3.5 text-emerald-400" />
            <span>TLS 1.3 / ECDSA P-256</span>
          </span>
          <span>•</span>
          <span className="text-zinc-300">{t.ocspStapled}</span>
        </div>
      </div>

      {/* Certificates Cards / Table */}
      {certificates.length === 0 ? (
        <div className="bg-zinc-950/70 border border-zinc-800/80 rounded-xl p-8 text-center space-y-3 font-mono">
          <KeyRound className="w-10 h-10 text-zinc-600 mx-auto" />
          <h3 className="text-sm font-semibold text-zinc-300">
            {language === 'ua' ? 'Немає активних SSL/TLS сертифікатів' : 'No active SSL/TLS certificates'}
          </h3>
          <p className="text-xs text-zinc-500 max-w-md mx-auto">
            {language === 'ua'
              ? 'Натисніть кнопку "Випустити Новий Сертифікат" для автоматичного запиту валідації ACME v2 DNS-01 або HTTP-01.'
              : 'Click "Issue New Certificate" to trigger automated ACME v2 DNS-01 or HTTP-01 issuance.'}
          </p>
          <button
            onClick={() => {
              setIssueStep('form');
              setIsModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold shadow-lg shadow-emerald-900/30 transition-colors"
          >
            <Plus className="w-4 h-4" />
            <span>{t.issueNewBtn}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {certificates.map((cert) => (
            <div
              key={cert.id}
              className="bg-zinc-900/90 border border-zinc-800 hover:border-zinc-700 rounded-xl p-5 shadow-sm space-y-4 font-mono text-xs transition-all"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]"></span>
                    <h3 className="font-bold text-white text-sm tracking-wide">{cert.domain}</h3>
                  </div>
                  <div className="text-[11px] text-zinc-400 mt-1">Issuer: {cert.issuer}</div>
                </div>

                <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-emerald-300 uppercase text-[10px] font-bold">
                  {cert.status}
                </span>
              </div>

              {/* SANs and challenge info */}
              <div className="bg-zinc-950/80 p-3 rounded-lg border border-zinc-800/80 space-y-2">
                <div className="flex justify-between">
                  <span className="text-zinc-500">Challenge Type:</span>
                  <span className="text-zinc-300">{cert.challengeType}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Valid Period:</span>
                  <span className="text-zinc-300">{cert.validFrom} → {cert.validTo}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-zinc-500">Days Remaining:</span>
                  <span className="text-emerald-400 font-bold">{cert.daysRemaining} days</span>
                </div>
                <div className="text-[10px] text-zinc-500 truncate pt-1 border-t border-zinc-850">
                  Fingerprint: {cert.fingerprint}
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-zinc-800 text-xs">
                <span className="text-zinc-400 flex items-center gap-1.5">
                  <RefreshCw className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Auto-renew: ON (at 30 days)</span>
                </span>

                <button
                  onClick={() => onRenewCert(cert.id)}
                  disabled={cert.status === 'renewing'}
                  className="px-3 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-200 transition-colors flex items-center gap-1"
                >
                  <RefreshCw className={`w-3 h-3 ${cert.status === 'renewing' ? 'animate-spin' : ''}`} />
                  <span>{cert.status === 'renewing' ? t.renewing : t.forceRenewBtn}</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modal for Issuing New SSL Cert */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fadeIn">
          <div className="bg-zinc-900 border border-zinc-800 rounded-xl max-w-lg w-full p-6 shadow-2xl space-y-4 font-mono text-xs">
            <div className="flex items-start justify-between border-b border-zinc-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-white">{t.modalTitle}</h2>
                <p className="text-[11px] text-zinc-400 mt-0.5">{t.modalSubtitle}</p>
              </div>
              <button onClick={handleModalClose} className="text-zinc-500 hover:text-white">✕</button>
            </div>

            {issueStep === 'form' && (
              <form onSubmit={handleStartIssue} className="space-y-4">
                <div>
                  <label className="block text-zinc-300 mb-1">{t.domainLabel}</label>
                  <input
                    type="text"
                    required
                    value={domainInput}
                    onChange={(e) => setDomainInput(e.target.value)}
                    placeholder="myhomelab.dev"
                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-2 text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <label className="flex items-center gap-2 cursor-pointer text-zinc-300">
                  <input
                    type="checkbox"
                    checked={isWildcard}
                    onChange={(e) => setIsWildcard(e.target.checked)}
                    className="rounded accent-emerald-500"
                  />
                  <span>{t.wildcardLabel}</span>
                </label>

                <div>
                  <label className="block text-zinc-300 mb-1">{t.challengeLabel}</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setChallengeType('DNS-01')}
                      className={`p-2 rounded border text-left transition-colors ${
                        challengeType === 'DNS-01'
                          ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      <span className="font-bold block mb-1">DNS-01 Challenge</span>
                      <span className="text-[10px] text-zinc-500 leading-tight block">{t.dnsChallengeDesc}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setChallengeType('HTTP-01')}
                      className={`p-2 rounded border text-left transition-colors ${
                        challengeType === 'HTTP-01'
                          ? 'bg-emerald-950/60 border-emerald-500 text-emerald-300'
                          : 'bg-zinc-950 border-zinc-800 text-zinc-400'
                      }`}
                    >
                      <span className="font-bold block mb-1">HTTP-01 Challenge</span>
                      <span className="text-[10px] text-zinc-500 leading-tight block">{t.httpChallengeDesc}</span>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end gap-2 pt-3 border-t border-zinc-800">
                  <button
                    type="button"
                    onClick={handleModalClose}
                    className="px-4 py-2 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                  >
                    {t.startIssueBtn}
                  </button>
                </div>
              </form>
            )}

            {issueStep === 'challenge' && (
              <div className="py-8 text-center space-y-3">
                <RefreshCw className="w-8 h-8 text-emerald-400 animate-spin mx-auto" />
                <h3 className="text-white font-bold text-sm">{t.verifyingTitle}</h3>
                <p className="text-zinc-400 text-[11px] max-w-sm mx-auto">{t.verifyingDesc}</p>
                <div className="bg-zinc-950 p-2 rounded text-[10px] text-emerald-400 border border-zinc-800 inline-block font-mono">
                  TXT _acme-challenge.{domainInput} → {Math.random().toString(36).substring(2, 18)}
                </div>
              </div>
            )}

            {issueStep === 'issued' && (
              <div className="py-6 text-center space-y-4">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                <h3 className="text-white font-bold text-sm">{t.issuedSuccess}</h3>
                <p className="text-zinc-400 text-[11px]">
                  ECDSA certificate active for *.${domainInput}. Traffic automatically routes over HTTPS with HTTP/3 QUIC support.
                </p>
                <button
                  onClick={handleModalClose}
                  className="px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-500 text-white font-bold"
                >
                  {t.closeBtn}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
