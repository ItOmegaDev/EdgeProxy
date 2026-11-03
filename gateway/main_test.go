package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestInternalAuth(t *testing.T) {
	handler := internalAuth("correct-secret-value", http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	}))

	tests := []struct {
		name   string
		header string
		want   int
	}{
		{"missing", "", http.StatusUnauthorized},
		{"wrong", "wrong-secret", http.StatusUnauthorized},
		{"correct", "correct-secret-value", http.StatusOK},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			req := httptest.NewRequest(http.MethodGet, "/internal/certs", nil)
			if test.header != "" {
				req.Header.Set("X-EdgeProxy-Internal", test.header)
			}
			rec := httptest.NewRecorder()
			handler.ServeHTTP(rec, req)
			if rec.Code != test.want {
				t.Fatalf("expected %d, got %d", test.want, rec.Code)
			}
		})
	}
}
