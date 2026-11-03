package protocol

import (
	"bytes"
	"encoding/binary"
	"errors"
	"testing"
)

func header(streamID uint32, frameType byte, length uint32) []byte {
	buf := make([]byte, HeaderSize)
	binary.BigEndian.PutUint32(buf[0:4], streamID)
	buf[4] = frameType
	binary.BigEndian.PutUint32(buf[5:9], length)
	return buf
}

func TestReadFrameRoundTrip(t *testing.T) {
	original := &Frame{StreamID: 42, Type: FrameData, Payload: []byte("hello")}
	decoded, err := ReadFrame(bytes.NewReader(original.Encode()))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if decoded.StreamID != original.StreamID || decoded.Type != original.Type {
		t.Fatalf("header mismatch: %+v", decoded)
	}
	if !bytes.Equal(decoded.Payload, original.Payload) {
		t.Fatalf("payload mismatch: %q", decoded.Payload)
	}
}

func TestReadFrameRejectsOversizedPayload(t *testing.T) {
	raw := header(1, FrameData, 65537)
	_, err := ReadFrame(bytes.NewReader(raw))
	if !errors.Is(err, ErrPayloadTooLarge) {
		t.Fatalf("expected ErrPayloadTooLarge, got %v", err)
	}
}

func TestReadFrameRejectsUnknownType(t *testing.T) {
	raw := header(1, 0x7f, 0)
	_, err := ReadFrame(bytes.NewReader(raw))
	if !errors.Is(err, ErrInvalidFrame) {
		t.Fatalf("expected ErrInvalidFrame, got %v", err)
	}
}

func TestReadFrameRejectsTruncatedPayload(t *testing.T) {
	raw := append(header(1, FrameData, 10), []byte("short")...)
	_, err := ReadFrame(bytes.NewReader(raw))
	if err == nil {
		t.Fatal("expected an error for a truncated payload")
	}
}
