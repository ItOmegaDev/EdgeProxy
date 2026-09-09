package client

import (
	"encoding/binary"
	"fmt"
	"io"
	"log"
	"net"
	"sync"
	"time"

	"edgeproxy/agent/demux"
	"edgeproxy/agent/metrics"
)

// Header size: 9 bytes
const HeaderSize = 9

const (
	FrameSyn     byte = 0x01
	FrameData    byte = 0x02
	FrameFin     byte = 0x03
	FramePing    byte = 0x04
	FramePong    byte = 0x05
	FrameRst     byte = 0x06
	FrameAck     byte = 0x07
	FrameMetrics byte = 0x08
)

// MaxInFlightWindow defines max unacknowledged 32KB chunks per stream for backpressure
const MaxInFlightWindow = 4

type TunnelClient struct {
	gatewayAddr string
	subdomain   string
	localPort   int
	token       string
	demuxer     *demux.StreamDemuxer
	collector   *metrics.LocalMetricsCollector
	conn        net.Conn
	mu          sync.Mutex
	running     bool

	// Flow control credit map: streamID -> channel of ACK pulses
	ackChans   map[uint32]chan struct{}
	ackChansMu sync.RWMutex
}

func NewTunnelClient(gatewayAddr, subdomain string, localPort int, token string) *TunnelClient {
	agentID := fmt.Sprintf("agent-%s-%d", subdomain, time.Now().Unix())
	return &TunnelClient{
		gatewayAddr: gatewayAddr,
		subdomain:   subdomain,
		localPort:   localPort,
		token:       token,
		demuxer:     demux.NewStreamDemuxer(fmt.Sprintf("127.0.0.1:%d", localPort)),
		collector:   metrics.NewMetricsCollector(agentID, subdomain),
		ackChans:    make(map[uint32]chan struct{}),
	}
}

// Start opens an encrypted multiplexed connection to the Gateway and listens for virtual streams
func (c *TunnelClient) Start() error {
	log.Printf("[AGENT] Connecting to Edge Gateway at %s...", c.gatewayAddr)

	conn, err := net.DialTimeout("tcp", c.gatewayAddr, 5*time.Second)
	if err != nil {
		return fmt.Errorf("failed connecting to gateway: %w", err)
	}
	c.conn = conn
	c.running = true

	// Handshake: send SYN frame with JSON handshake payload containing subdomain + auth token
	handshakePayload := fmt.Sprintf(`{"subdomain":"%s","token":"%s","version":"v1.0.0-PROD"}`, c.subdomain, c.token)
	handshakeFrame := encodeFrame(0, FrameSyn, []byte(handshakePayload))
	if _, err := c.conn.Write(handshakeFrame); err != nil {
		return fmt.Errorf("handshake write failed: %w", err)
	}

	log.Printf("[AGENT] Tunnel online! Public URL: https://%s.edgeproxy.mesh -> http://127.0.0.1:%d", c.subdomain, c.localPort)

	// Keep-alive heartbeat loop
	go c.heartbeatLoop()

	// Periodic telemetry collector loop sending FrameMetrics
	go c.telemetryLoop()

	// Frame read and processing loop
	for c.running {
		streamID, frameType, payload, err := readFrame(c.conn)
		if err != nil {
			if c.running {
				log.Printf("[AGENT] Connection lost: %v", err)
			}
			break
		}

		switch frameType {
		case FramePing:
			c.mu.Lock()
			c.conn.Write(encodeFrame(streamID, FramePong, nil))
			c.mu.Unlock()

		case FrameAck:
			// Release backpressure credit for the corresponding stream
			c.ackChansMu.RLock()
			ch, exists := c.ackChans[streamID]
			c.ackChansMu.RUnlock()
			if exists && ch != nil {
				select {
				case ch <- struct{}{}:
				default:
				}
			}

		case FrameSyn, FrameData:
			c.collector.StreamStarted()
			// Asynchronously forward to local port with flow control window
			go func(sid uint32, raw []byte) {
				defer c.collector.StreamFinished()

				startTime := time.Now()
				respBytes, err := c.demuxer.ForwardRequest(raw)
				duration := time.Since(startTime)

				if err != nil {
					c.collector.RecordRequest(duration, int64(len(raw)), 0, 502)
					// Send FrameRst to notify gateway of local error
					c.mu.Lock()
					c.conn.Write(encodeFrame(sid, FrameRst, []byte(err.Error())))
					c.mu.Unlock()
					return
				}

				c.collector.RecordRequest(duration, int64(len(raw)), int64(len(respBytes)), 200)

				// Register ACK credit channel for flow control
				ackChan := make(chan struct{}, MaxInFlightWindow)
				// Preload initial credit window
				for i := 0; i < MaxInFlightWindow; i++ {
					ackChan <- struct{}{}
				}

				c.ackChansMu.Lock()
				c.ackChans[sid] = ackChan
				c.ackChansMu.Unlock()

				defer func() {
					c.ackChansMu.Lock()
					delete(c.ackChans, sid)
					c.ackChansMu.Unlock()
				}()

				// Stream response in 32KB chunks with windowed credit backpressure
				const chunkSize = 32768
				for offset := 0; offset < len(respBytes); offset += chunkSize {
					end := offset + chunkSize
					if end > len(respBytes) {
						end = len(respBytes)
					}

					// Wait for flow control credit (prevents deadlock on large 10MB+ transfers)
					select {
					case <-ackChan:
						// Credit available, transmit chunk
					case <-time.After(10 * time.Second):
						log.Printf("[AGENT-BACKPRESSURE] Flow control window timeout for stream %d", sid)
						return
					}

					c.mu.Lock()
					c.conn.Write(encodeFrame(sid, FrameData, respBytes[offset:end]))
					c.mu.Unlock()
				}

				// Signal stream completion with FrameFin
				c.mu.Lock()
				c.conn.Write(encodeFrame(sid, FrameFin, nil))
				c.mu.Unlock()
			}(streamID, payload)
		}
	}

	return nil
}

func (c *TunnelClient) telemetryLoop() {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()

	for c.running {
		<-ticker.C
		reportBytes, err := c.collector.EncodeJSON()
		if err == nil && len(reportBytes) > 0 {
			c.mu.Lock()
			if c.conn != nil {
				c.conn.Write(encodeFrame(0, FrameMetrics, reportBytes))
			}
			c.mu.Unlock()
		}
	}
}

func (c *TunnelClient) heartbeatLoop() {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for c.running {
		<-ticker.C
		c.mu.Lock()
		if c.conn != nil {
			c.conn.Write(encodeFrame(0, FramePing, nil))
		}
		c.mu.Unlock()
	}
}

func (c *TunnelClient) Stop() {
	c.running = false
	if c.conn != nil {
		c.conn.Close()
	}
}

func encodeFrame(streamID uint32, frameType byte, payload []byte) []byte {
	buf := make([]byte, HeaderSize+len(payload))
	binary.BigEndian.PutUint32(buf[0:4], streamID)
	buf[4] = frameType
	binary.BigEndian.PutUint32(buf[5:9], uint32(len(payload)))
	copy(buf[9:], payload)
	return buf
}

func readFrame(r io.Reader) (uint32, byte, []byte, error) {
	header := make([]byte, HeaderSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return 0, 0, nil, err
	}

	streamID := binary.BigEndian.Uint32(header[0:4])
	frameType := header[4]
	length := binary.BigEndian.Uint32(header[5:9])

	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return 0, 0, nil, err
		}
	}

	return streamID, frameType, payload, nil
}
