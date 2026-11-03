package acme

import (
	"crypto/tls"
	"os"
	"path/filepath"
	"testing"
)

func newTestManager(t *testing.T) *CertManager {
	t.Helper()
	return &CertManager{
		certificates: make(map[string]*tls.Certificate),
		metadata:     make(map[string]*CertificateMeta),
		baseDomain:   "edgeproxy.mesh",
		certDir:      t.TempDir(),
	}
}

func TestValidDomain(t *testing.T) {
	valid := []string{"edgeproxy.mesh", "app.example.com", "a-b.example.co"}
	for _, domain := range valid {
		if !validDomain(domain) {
			t.Fatalf("expected %q to be valid", domain)
		}
	}

	invalid := []string{"", "localhost", "-bad.example", "bad-.example", "a..b", "has space.example", "app.example/path"}
	for _, domain := range invalid {
		if validDomain(domain) {
			t.Fatalf("expected %q to be invalid", domain)
		}
	}
}

func TestIssueOrRenewIsLabelledSelfSigned(t *testing.T) {
	manager := newTestManager(t)

	meta, err := manager.IssueOrRenew("app.example.com", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if meta.Issuer != "EdgeProxy Self-Signed CA (not publicly trusted)" {
		t.Fatalf("unexpected issuer: %q", meta.Issuer)
	}
	if meta.ChallengeType != "SELF-SIGNED" {
		t.Fatalf("unexpected challenge type: %q", meta.ChallengeType)
	}
	if meta.OCSPStapled {
		t.Fatal("OCSP stapling is not implemented and must not be claimed")
	}
	if meta.Fingerprint == "" {
		t.Fatal("expected a fingerprint")
	}
}

func TestIssueOrRenewWritesKeyWithRestrictedPermissions(t *testing.T) {
	certDir := t.TempDir()
	manager := &CertManager{
		certificates: make(map[string]*tls.Certificate),
		metadata:     make(map[string]*CertificateMeta),
		baseDomain:   "edgeproxy.mesh",
		certDir:      certDir,
	}

	if _, err := manager.IssueOrRenew("edgeproxy.mesh", true); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}

	keyPath := filepath.Join(certDir, "wildcard.edgeproxy.mesh.key")
	info, err := os.Stat(keyPath)
	if err != nil {
		t.Fatalf("expected key file: %v", err)
	}
	if mode := info.Mode().Perm(); mode != 0600 {
		t.Fatalf("expected key permissions 0600, got %o", mode)
	}
}

func TestIssueOrRenewRejectsInvalidDomain(t *testing.T) {
	manager := newTestManager(t)

	for _, domain := range []string{"", "../etc/passwd", "bad_domain.example", "*.bad..example"} {
		if _, err := manager.IssueOrRenew(domain, false); err == nil {
			t.Fatalf("expected %q to be rejected", domain)
		}
	}
}
