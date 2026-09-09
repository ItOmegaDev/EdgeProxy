package metrics

import (
	"encoding/json"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// TelemetryReport represents the telemetry payload sent from Local Agent to Edge Gateway
type TelemetryReport struct {
	AgentID          string    `json:"agentId"`
	Subdomain        string    `json:"subdomain"`
	Timestamp        time.Time `json:"timestamp"`
	TotalRequests    uint64    `json:"totalRequests"`
	ActiveStreams    int32     `json:"activeStreams"`
	BytesSent        uint64    `json:"bytesSent"`
	BytesReceived    uint64    `json:"bytesReceived"`
	AvgLatencyMs     float64   `json:"avgLatencyMs"`
	P50LatencyMs     float64   `json:"p50LatencyMs"`
	P95LatencyMs     float64   `json:"p95LatencyMs"`
	P99LatencyMs     float64   `json:"p99LatencyMs"`
	ErrorCount       uint64    `json:"errorCount"`
	LocalServiceRTT  float64   `json:"localServiceRttMs"`
}

// LocalMetricsCollector aggregates stream-level telemetry inside the Local Agent
type LocalMetricsCollector struct {
	mu             sync.Mutex
	agentID        string
	subdomain      string
	totalRequests  uint64
	activeStreams  int32
	bytesSent      uint64
	bytesReceived  uint64
	errorCount     uint64
	latencySamples []float64
	lastRTT        float64
}

// NewMetricsCollector initializes a new collector for the agent
func NewMetricsCollector(agentID, subdomain string) *LocalMetricsCollector {
	return &LocalMetricsCollector{
		agentID:        agentID,
		subdomain:      subdomain,
		latencySamples: make([]float64, 0, 1024),
	}
}

// StreamStarted tracks active concurrent streams
func (m *LocalMetricsCollector) StreamStarted() {
	atomic.AddInt32(&m.activeStreams, 1)
}

// StreamFinished tracks closed concurrent streams
func (m *LocalMetricsCollector) StreamFinished() {
	atomic.AddInt32(&m.activeStreams, -1)
}

// RecordRequest records completion of an HTTP request through the demuxer
func (m *LocalMetricsCollector) RecordRequest(duration time.Duration, bytesIn, bytesOut int64, statusCode int) {
	latMs := float64(duration.Microseconds()) / 1000.0
	atomic.AddUint64(&m.totalRequests, 1)
	atomic.AddUint64(&m.bytesReceived, uint64(bytesIn))
	atomic.AddUint64(&m.bytesSent, uint64(bytesOut))

	if statusCode >= 400 {
		atomic.AddUint64(&m.errorCount, 1)
	}

	m.mu.Lock()
	if len(m.latencySamples) < 2048 {
		m.latencySamples = append(m.latencySamples, latMs)
	} else {
		// Keep ring buffer of latest 2048 samples
		m.latencySamples = append(m.latencySamples[1:], latMs)
	}
	m.lastRTT = latMs
	m.mu.Unlock()
}

// Snapshot returns calculated percentiles and counters
func (m *LocalMetricsCollector) Snapshot() TelemetryReport {
	m.mu.Lock()
	defer m.mu.Unlock()

	var avg, p50, p95, p99 float64
	sampleCount := len(m.latencySamples)

	if sampleCount > 0 {
		sorted := make([]float64, sampleCount)
		copy(sorted, m.latencySamples)
		sort.Float64s(sorted)

		var sum float64
		for _, v := range sorted {
			sum += v
		}
		avg = sum / float64(sampleCount)

		p50 = sorted[int(float64(sampleCount)*0.50)]
		p95Idx := int(float64(sampleCount) * 0.95)
		if p95Idx >= sampleCount {
			p95Idx = sampleCount - 1
		}
		p95 = sorted[p95Idx]

		p99Idx := int(float64(sampleCount) * 0.99)
		if p99Idx >= sampleCount {
			p99Idx = sampleCount - 1
		}
		p99 = sorted[p99Idx]
	}

	return TelemetryReport{
		AgentID:         m.agentID,
		Subdomain:       m.subdomain,
		Timestamp:       time.Now(),
		TotalRequests:   atomic.LoadUint64(&m.totalRequests),
		ActiveStreams:   atomic.LoadInt32(&m.activeStreams),
		BytesSent:       atomic.LoadUint64(&m.bytesSent),
		BytesReceived:   atomic.LoadUint64(&m.bytesReceived),
		AvgLatencyMs:    avg,
		P50LatencyMs:    p50,
		P95LatencyMs:    p95,
		P99LatencyMs:    p99,
		ErrorCount:      atomic.LoadUint64(&m.errorCount),
		LocalServiceRTT: m.lastRTT,
	}
}

// EncodeJSON serializes the telemetry snapshot to bytes for Frame transmission
func (m *LocalMetricsCollector) EncodeJSON() ([]byte, error) {
	snap := m.Snapshot()
	return json.Marshal(snap)
}
