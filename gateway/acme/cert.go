package acme

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"fmt"
	"log"
	"math/big"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// CertificateMeta holds metadata for the dashboard and ACME status reports
type CertificateMeta struct {
	ID            string   `json:"id"`
	Domain        string   `json:"domain"`
	Wildcard      bool     `json:"wildcard"`
	Issuer        string   `json:"issuer"`
	Status        string   `json:"status"` // "valid", "renewing", "pending_challenge", "revoked"
	ValidFrom     string   `json:"validFrom"`
	ValidTo       string   `json:"validTo"`
	DaysRemaining int      `json:"daysRemaining"`
	ChallengeType string   `json:"challengeType"` // "SELF-SIGNED" (no public ACME client yet)
	SANList       []string `json:"sanList"`
	OCSPStapled   bool     `json:"ocspStapled"`
	Fingerprint   string   `json:"fingerprint"`
	AutoRenew     bool     `json:"autoRenew"`
}

// CertManager handles automated TLS termination, ACME issuance, and certificate hot-reloading
type CertManager struct {
	mu           sync.RWMutex
	certificates map[string]*tls.Certificate
	metadata     map[string]*CertificateMeta
	baseDomain   string
	certDir      string
}

// NewCertManager initializes the certificate manager and preloads/generates base certificates
func NewCertManager(baseDomain string, certDir string) *CertManager {
	if certDir == "" {
		certDir = "./certs"
	}
	_ = os.MkdirAll(certDir, 0750)

	cm := &CertManager{
		certificates: make(map[string]*tls.Certificate),
		metadata:     make(map[string]*CertificateMeta),
		baseDomain:   baseDomain,
		certDir:      certDir,
	}

	// Bootstrap base wildcard certificate (*.baseDomain and baseDomain)
	if err := cm.bootstrapWildcardCert(); err != nil {
		log.Printf("[ACME-INIT] Warning: Wildcard bootstrap: %v", err)
	}

	// Launch background renewal watcher
	go cm.AutoRenewLoop()

	return cm
}

// TLSConfig returns a production-ready *tls.Config hooked into dynamic SNI certificate resolution
func (m *CertManager) TLSConfig() *tls.Config {
	return &tls.Config{
		GetCertificate: m.GetCertificate,
		MinVersion:     tls.VersionTLS12,
		NextProtos:     []string{"h2", "http/1.1", "acme-tls/1"},
		CipherSuites: []uint16{
			tls.TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384,
			tls.TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305,
			tls.TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256,
			tls.TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256,
		},
	}
}

// GetCertificate dynamically retrieves or generates the TLS certificate matching SNI
func (m *CertManager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	serverName := strings.ToLower(hello.ServerName)
	if serverName == "" {
		serverName = m.baseDomain
	}

	m.mu.RLock()
	cert, exists := m.certificates[serverName]
	m.mu.RUnlock()

	if exists {
		return cert, nil
	}

	// Wildcard check (*.baseDomain)
	wildcard := "*." + m.baseDomain
	m.mu.RLock()
	wildCert, wildExists := m.certificates[wildcard]
	m.mu.RUnlock()

	if wildExists {
		return wildCert, nil
	}

	// On-demand issuance for recognized subdomains
	if strings.HasSuffix(serverName, "."+m.baseDomain) || serverName == m.baseDomain {
		log.Printf("[TLS] On-demand TLS certificate generation for SNI: %s", serverName)
		meta, err := m.IssueOrRenew(serverName, false)
		if err == nil && meta != nil {
			m.mu.RLock()
			newCert := m.certificates[serverName]
			m.mu.RUnlock()
			if newCert != nil {
				return newCert, nil
			}
		}
	}

	return nil, fmt.Errorf("no certificate found matching SNI: %s", serverName)
}

// IssueOrRenew creates or renews a self-signed X.509 ECDSA certificate for the
// edge mesh. It is intentionally labelled as self-signed: there is no public
// ACME client inside the gateway yet.
func (m *CertManager) IssueOrRenew(domain string, wildcard bool) (*CertificateMeta, error) {
	domain = strings.ToLower(strings.TrimSpace(domain))
	wildcard = wildcard || strings.HasPrefix(domain, "*.")
	domain = strings.TrimPrefix(domain, "*.")
	if !validDomain(domain) {
		return nil, fmt.Errorf("invalid domain name: %q", domain)
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	privKey, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return nil, fmt.Errorf("failed generating ECDSA private key: %w", err)
	}

	serialNumber, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	if err != nil {
		return nil, fmt.Errorf("failed generating serial number: %w", err)
	}

	now := time.Now()
	validTo := now.Add(90 * 24 * time.Hour)

	var sanList []string
	if wildcard {
		sanList = []string{"*." + domain, domain}
	} else {
		sanList = []string{domain}
	}

	template := x509.Certificate{
		SerialNumber: serialNumber,
		Subject: pkix.Name{
			CommonName:   domain,
			Organization: []string{"EdgeProxy Self-Signed CA"},
		},
		NotBefore:             now.Add(-1 * time.Hour),
		NotAfter:              validTo,
		KeyUsage:              x509.KeyUsageKeyEncipherment | x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              sanList,
	}

	// Self-sign X.509 certificate for edge mesh
	derBytes, err := x509.CreateCertificate(rand.Reader, &template, &template, &privKey.PublicKey, privKey)
	if err != nil {
		return nil, fmt.Errorf("failed creating X.509 certificate: %w", err)
	}

	// Calculate true SHA-256 fingerprint from DER bytes
	fingerprintBytes := sha256.Sum256(derBytes)
	var hexParts []string
	for _, b := range fingerprintBytes[:16] {
		hexParts = append(hexParts, fmt.Sprintf("%02X", b))
	}
	fingerprint := "SHA256: " + strings.Join(hexParts, ":")

	tlsCert := &tls.Certificate{
		Certificate: [][]byte{derBytes},
		PrivateKey:  privKey,
	}

	certKey := domain
	if wildcard {
		certKey = "*." + domain
	}

	m.certificates[certKey] = tlsCert
	if wildcard {
		m.certificates[domain] = tlsCert
	}

	// Persist to disk
	certPEM := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: derBytes})
	privBytes, _ := x509.MarshalECPrivateKey(privKey)
	keyPEM := pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: privBytes})

	safeName := strings.ReplaceAll(certKey, "*", "wildcard")
	_ = os.WriteFile(filepath.Join(m.certDir, safeName+".crt"), certPEM, 0644)
	_ = os.WriteFile(filepath.Join(m.certDir, safeName+".key"), keyPEM, 0600)

	meta := &CertificateMeta{
		ID:            fmt.Sprintf("cert-%d", now.UnixNano()),
		Domain:        domain,
		Wildcard:      wildcard,
		Issuer:        "EdgeProxy Self-Signed CA (not publicly trusted)",
		Status:        "valid",
		ValidFrom:     now.Format("2006-01-02"),
		ValidTo:       validTo.Format("2006-01-02"),
		DaysRemaining: 90,
		ChallengeType: "SELF-SIGNED",
		SANList:       sanList,
		OCSPStapled:   false,
		Fingerprint:   fingerprint,
		AutoRenew:     true,
	}

	m.metadata[certKey] = meta
	log.Printf("[TLS] Successfully issued certificate for %s (Fingerprint: %s)", certKey, fingerprint)
	return meta, nil
}

// ListCertificates returns snapshot of all managed certificates for the API
func (m *CertManager) ListCertificates() []*CertificateMeta {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*CertificateMeta, 0, len(m.metadata))
	for _, meta := range m.metadata {
		result = append(result, meta)
	}
	return result
}

func (m *CertManager) bootstrapWildcardCert() error {
	_, err := m.IssueOrRenew(m.baseDomain, true)
	return err
}

// validDomain accepts a lowercase DNS name made of at least two labels.
func validDomain(domain string) bool {
	if len(domain) == 0 || len(domain) > 253 {
		return false
	}
	labels := strings.Split(domain, ".")
	if len(labels) < 2 {
		return false
	}
	for _, label := range labels {
		if len(label) == 0 || len(label) > 63 {
			return false
		}
		if strings.HasPrefix(label, "-") || strings.HasSuffix(label, "-") {
			return false
		}
		for _, r := range label {
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '-' {
				return false
			}
		}
	}
	return true
}

// AutoRenewLoop renews certificates that expire within 30 days.
func (m *CertManager) AutoRenewLoop() {
	ticker := time.NewTicker(12 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		log.Printf("[TLS] Running scheduled certificate expiry check...")

		m.mu.RLock()
		snapshot := make(map[string]*CertificateMeta, len(m.metadata))
		for key, meta := range m.metadata {
			snapshot[key] = meta
		}
		m.mu.RUnlock()

		for key, meta := range snapshot {
			if !meta.AutoRenew {
				continue
			}
			// A wildcard entry also updates its bare-domain alias; renew once.
			if !strings.HasPrefix(key, "*.") {
				if _, hasWildcard := snapshot["*."+key]; hasWildcard {
					continue
				}
			}

			validTo, err := time.Parse("2006-01-02", meta.ValidTo)
			if err == nil && time.Until(validTo) > 30*24*time.Hour {
				continue
			}

			cleanDomain := strings.TrimPrefix(key, "*.")
			isWildcard := strings.HasPrefix(key, "*.")
			if _, err := m.IssueOrRenew(cleanDomain, isWildcard); err != nil {
				log.Printf("[TLS] Automated renewal failed for %s: %v", key, err)
			}
		}
	}
}
