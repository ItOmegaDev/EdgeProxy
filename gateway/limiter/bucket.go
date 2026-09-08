package limiter

import (
	"sync"
	"time"
)

// TokenBucket implements atomic rate limiting with burst allowance and sliding replenishment
type TokenBucket struct {
	mu           sync.Mutex
	capacity     float64
	tokens       float64
	refillRate   float64 // tokens per second
	lastRefill   time.Time
	violationCnt int
	jailedUntil  time.Time
}

// NewTokenBucket creates a bucket with specified max capacity and refill rate (tokens/sec)
func NewTokenBucket(capacity float64, refillRate float64) *TokenBucket {
	return &TokenBucket{
		capacity:   capacity,
		tokens:     capacity,
		refillRate: refillRate,
		lastRefill: time.Now(),
	}
}

// Allow evaluates whether a single request can proceed or must be rejected (HTTP 429)
func (tb *TokenBucket) Allow() bool {
	tb.mu.Lock()
	defer tb.mu.Unlock()

	now := time.Now()

	// Check if IP is actively jailed
	if now.Before(tb.jailedUntil) {
		return false
	}

	// Refill tokens based on elapsed duration
	elapsed := now.Sub(tb.lastRefill).Seconds()
	tb.tokens += elapsed * tb.refillRate
	if tb.tokens > tb.capacity {
		tb.tokens = tb.capacity
	}
	tb.lastRefill = now

	// Attempt to consume 1 token
	if tb.tokens >= 1.0 {
		tb.tokens -= 1.0
		return true
	}

	// Token deficit: increment violation counter
	tb.violationCnt++
	if tb.violationCnt >= 5 {
		// Jail IP for 60 seconds
		tb.jailedUntil = now.Add(60 * time.Second)
		tb.violationCnt = 0
	}

	return false
}

// RateLimiterStore manages per-IP TokenBuckets
type RateLimiterStore struct {
	mu      sync.RWMutex
	buckets map[string]*TokenBucket
	rps     float64
	burst   float64
}

func NewRateLimiterStore(rps, burst float64) *RateLimiterStore {
	return &RateLimiterStore{
		buckets: make(map[string]*TokenBucket),
		rps:     rps,
		burst:   burst,
	}
}

func (s *RateLimiterStore) Check(clientIP string) bool {
	s.mu.RLock()
	b, exists := s.buckets[clientIP]
	s.mu.RUnlock()

	if !exists {
		s.mu.Lock()
		b = NewTokenBucket(s.burst, s.rps)
		s.buckets[clientIP] = b
		s.mu.Unlock()
	}

	return b.Allow()
}
