package proxy

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func TestVerifyAuthorizationDenyByDefault(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)

	if router.VerifyAuthorization("app", "any-token") {
		t.Fatal("expected deny when no tunnels are configured")
	}
	if router.VerifyAuthorization("", "any-token") {
		t.Fatal("expected deny for empty subdomain")
	}
	if router.VerifyAuthorization("app", "") {
		t.Fatal("expected deny for empty token")
	}
}

func TestVerifyAuthorizationMatchesHash(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)
	router.SyncAllowedTunnels([]AllowedTunnelConfig{
		{Subdomain: "app", AuthTokenHash: tokenHash("correct-token"), IsActive: true},
	})

	if !router.VerifyAuthorization("app", "correct-token") {
		t.Fatal("expected a valid token to be accepted")
	}
	if router.VerifyAuthorization("app", "wrong-token") {
		t.Fatal("expected a wrong token to be rejected")
	}
	if router.VerifyAuthorization("other", "correct-token") {
		t.Fatal("expected an unknown subdomain to be rejected")
	}
}

func TestVerifyAuthorizationRejectsInactiveAndIncompleteConfig(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)
	router.SyncAllowedTunnels([]AllowedTunnelConfig{
		{Subdomain: "inactive", AuthTokenHash: tokenHash("token"), IsActive: false},
		{Subdomain: "nohash", AuthTokenHash: "", IsActive: true},
		{Subdomain: "badhash", AuthTokenHash: "not-a-hash", IsActive: true},
		{Subdomain: "../evil", AuthTokenHash: tokenHash("token"), IsActive: true},
	})

	for _, subdomain := range []string{"inactive", "nohash", "badhash", "../evil"} {
		if router.VerifyAuthorization(subdomain, "token") {
			t.Fatalf("expected deny for %q", subdomain)
		}
	}
}

func TestSyncAllowedTunnelsSkipsInvalidEntries(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)
	router.SyncAllowedTunnels([]AllowedTunnelConfig{
		{Subdomain: "ok", AuthTokenHash: tokenHash("token"), IsActive: true},
		{Subdomain: "UPPER", AuthTokenHash: tokenHash("token"), IsActive: true},
		{Subdomain: "has.dot", AuthTokenHash: tokenHash("token"), IsActive: true},
		{Subdomain: "short-hash", AuthTokenHash: "abc", IsActive: true},
	})

	router.mu.RLock()
	count := len(router.allowedTunnels)
	_, ok := router.allowedTunnels["ok"]
	router.mu.RUnlock()

	if count != 1 || !ok {
		t.Fatalf("expected only the valid entry to be stored, got %d", count)
	}
}

func TestValidSubdomain(t *testing.T) {
	valid := []string{"a", "app", "app-01", strings.Repeat("a", 63)}
	for _, value := range valid {
		if !ValidSubdomain(value) {
			t.Fatalf("expected %q to be valid", value)
		}
	}

	invalid := []string{"", "-app", "app-", "a.b", "UPPER", "has space", "../etc", strings.Repeat("a", 64)}
	for _, value := range invalid {
		if ValidSubdomain(value) {
			t.Fatalf("expected %q to be invalid", value)
		}
	}
}

func TestServeHTTPHealthz(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)

	req := httptest.NewRequest(http.MethodGet, "http://127.0.0.1:8080/healthz", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), `"status":"ok"`) {
		t.Fatalf("unexpected body: %s", rec.Body.String())
	}
}

func TestServeHTTPRootAndUnknownHost(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)

	root := httptest.NewRequest(http.MethodGet, "http://edgeproxy.mesh/", nil)
	rootRec := httptest.NewRecorder()
	router.ServeHTTP(rootRec, root)
	if rootRec.Code != http.StatusOK {
		t.Fatalf("expected root 200, got %d", rootRec.Code)
	}
	if !strings.Contains(rootRec.Body.String(), `"service":"EdgeProxy Gateway"`) {
		t.Fatalf("unexpected root body: %s", rootRec.Body.String())
	}

	unknown := httptest.NewRequest(http.MethodGet, "http://elsewhere.example/", nil)
	unknownRec := httptest.NewRecorder()
	router.ServeHTTP(unknownRec, unknown)
	if unknownRec.Code != http.StatusNotFound {
		t.Fatalf("expected unknown host 404, got %d", unknownRec.Code)
	}
}

func TestServeHTTPRejectsMultiLabelSubdomain(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)

	req := httptest.NewRequest(http.MethodGet, "http://a.b.edgeproxy.mesh/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for nested subdomain, got %d", rec.Code)
	}
}

func TestServeHTTPOfflineTunnelReturns502(t *testing.T) {
	router := NewRouter("edgeproxy.mesh", 100, 150)

	req := httptest.NewRequest(http.MethodGet, "http://offline.edgeproxy.mesh/", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusBadGateway {
		t.Fatalf("expected 502 for offline tunnel, got %d", rec.Code)
	}
}
