package protocol

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

// Frame header size: 4 bytes (StreamID) + 1 byte (Type) + 4 bytes (Length) = 9 bytes
const HeaderSize = 9

// Frame types for EdgeProxy multiplexing
const (
	FrameSyn  byte = 0x01 // Stream open request
	FrameData byte = 0x02 // Data payload
	FrameFin  byte = 0x03 // Stream close
	FramePing byte = 0x04 // Keep-alive ping
	FramePong byte = 0x05 // Keep-alive pong
	FrameRst     byte = 0x06 // Stream abort/reset
	FrameAck     byte = 0x07 // Window/credit acknowledgement for flow control
	FrameMetrics byte = 0x08 // Agent local telemetry metrics report
)

var (
	ErrPayloadTooLarge = errors.New("frame payload exceeds maximum 64KB size")
	ErrInvalidFrame    = errors.New("corrupted binary frame header")
)

// Frame represents a single multiplexed binary frame
type Frame struct {
	StreamID uint32
	Type     byte
	Length   uint32
	Payload  []byte
}

// Encode converts a Frame into its wire-format byte slice
func (f *Frame) Encode() []byte {
	buf := make([]byte, HeaderSize+len(f.Payload))
	binary.BigEndian.PutUint32(buf[0:4], f.StreamID)
	buf[4] = f.Type
	binary.BigEndian.PutUint32(buf[5:9], uint32(len(f.Payload)))
	if len(f.Payload) > 0 {
		copy(buf[9:], f.Payload)
	}
	return buf
}

// ReadFrame reads and decodes a single frame from an io.Reader (zero-copy buffer allocation)
func ReadFrame(r io.Reader) (*Frame, error) {
	header := make([]byte, HeaderSize)
	if _, err := io.ReadFull(r, header); err != nil {
		return nil, err
	}

	streamID := binary.BigEndian.Uint32(header[0:4])
	frameType := header[4]
	length := binary.BigEndian.Uint32(header[5:9])

	// Max 64KB per frame to avoid memory exhaustion
	if length > 65536 {
		return nil, fmt.Errorf("%w: %d bytes", ErrPayloadTooLarge, length)
	}

	payload := make([]byte, length)
	if length > 0 {
		if _, err := io.ReadFull(r, payload); err != nil {
			return nil, err
		}
	}

	return &Frame{
		StreamID: streamID,
		Type:     frameType,
		Length:   length,
		Payload:  payload,
	}, nil
}
