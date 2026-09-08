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
)

// Header size: 9 bytes
const HeaderSize = 9

const (
	FrameSyn  byte = 0x01
	FrameData byte = 0x02
	FrameFin  byte = 0x03
	FramePing byte = 0x04
	FramePong byte = 0x05
)

type TunnelClient struct {
	gatewayAddr string
	subdomain   string
	localPort   int
	token       string
	demuxer     *demux.StreamDemuxer
	conn        net.Conn
	mu          sync.Mutex
	running     bool
}

func NewTunnelClient(gatewayAddr, subdomain string, localPort int, token string) *TunnelClient {
	return &TunnelClient{
		gatewayAddr: gatewayAddr,
		subdomain:   subdomain,
		localPort:   localPort,
		token:       token,
		demuxer:     demux.NewStreamDemuxer(fmt.Sprintf("127.0.0.1:%d", localPort)),
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

	// Handshake: send SYN frame with requested subdomain
	handshakeFrame := encodeFrame(0, FrameSyn, []byte(c.subdomain))
	if _, err := c.conn.Write(handshakeFrame); err != nil {
		return fmt.Errorf("handshake write failed: %w", err)
	}

	log.Printf("[AGENT] Tunnel online! Public URL: https://%s.edgeproxy.mesh -> http://127.0.0.1:%d", c.subdomain, c.localPort)

	// Keep-alive heartbeat loop
	go c.heartbeatLoop()

	// Frame read and processing loop
	for c.running {
		streamID, frameType, payload, err := readFrame(c.conn)
		if err != nil {
			if c.running {
				log.Printf("[AGENT] Connection lost: %v", err)
			}
			break
		}

		if frameType == FramePing {
			c.mu.Lock()
			c.conn.Write(encodeFrame(streamID, FramePong, nil))
			c.mu.Unlock()
			continue
		}

		if frameType == FrameSyn || frameType == FrameData {
			// Asynchronously forward to local port and stream back response
			go func(sid uint32, raw []byte) {
				respBytes, err := c.demuxer.ForwardRequest(raw)
				if err != nil {
					return
				}
				respFrame := encodeFrame(sid, FrameData, respBytes)
				c.mu.Lock()
				c.conn.Write(respFrame)
				c.mu.Unlock()
			}(streamID, payload)
		}
	}

	return nil
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
