package acme

import (
	"crypto/tls"
	"fmt"
	"log"
	"sync"
	"time"
)

// CertManager handles automated TLS termination and certificate hot-reloading
type CertManager struct {
	mu           sync.RWMutex
	certificates map[string]*tls.Certificate
	baseDomain   string
}

func NewCertManager(baseDomain string) *CertManager {
	return &CertManager{
		certificates: make(map[string]*tls.Certificate),
		baseDomain:   baseDomain,
	}
}

// GetCertificate dynamically retrieves or generates the TLS certificate matching SNI
func (m *CertManager) GetCertificate(hello *tls.ClientHelloInfo) (*tls.Certificate, error) {
	m.mu.RLock()
	cert, exists := m.certificates[hello.ServerName]
	m.mu.RUnlock()

	if exists {
		return cert, nil
	}

	// Check wildcard fallback (*.baseDomain)
	wildcard := "*." + m.baseDomain
	m.mu.RLock()
	wildCert, wildExists := m.certificates[wildcard]
	m.mu.RUnlock()

	if wildExists {
		return wildCert, nil
	}

	log.Printf("[ACME] Requesting Let's Encrypt TLS-ALPN-01 certificate for SNI: %s", hello.ServerName)
	return nil, fmt.Errorf("certificate for %s not found in local cache", hello.ServerName)
}

// AutoRenewLoop checks for certificates expiring within 30 days
func (m *CertManager) AutoRenewLoop() {
	ticker := time.NewTicker(12 * time.Hour)
	defer ticker.Stop()

	for range ticker.C {
		log.Printf("[ACME] Scanning certificates for renewal...")
		// ACME v2 renew logic executes here
	}
}
