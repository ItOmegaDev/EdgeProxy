package limiter

import (
	"testing"
	"time"
)

func TestTokenBucketAllowAndBurst(t *testing.T) {
	// Capacity: 5 tokens, Refill: 2 tokens/sec
	tb := NewTokenBucket(5, 2)

	// Consume all 5 tokens
	for i := 0; i < 5; i++ {
		if !tb.Allow() {
			t.Fatalf("request %d should have been allowed within burst capacity", i+1)
		}
	}

	// 6th request should fail
	if tb.Allow() {
		t.Fatal("6th request should have been rate limited")
	}

	// Wait 600ms (1.2 tokens refilled)
	time.Sleep(600 * time.Millisecond)
	if !tb.Allow() {
		t.Fatal("request after refill interval should be allowed")
	}
}

func TestRateLimiterStorePerIP(t *testing.T) {
	store := NewRateLimiterStore(10, 2)

	// IP 1 should be allowed up to burst
	if !store.Check("192.168.1.1") {
		t.Error("IP 1 request 1 should be allowed")
	}
	if !store.Check("192.168.1.1") {
		t.Error("IP 1 request 2 should be allowed")
	}
	if store.Check("192.168.1.1") {
		t.Error("IP 1 request 3 should be blocked")
	}

	// Different IP 2 should have independent bucket
	if !store.Check("10.0.0.2") {
		t.Error("IP 2 should be allowed independently")
	}
}
