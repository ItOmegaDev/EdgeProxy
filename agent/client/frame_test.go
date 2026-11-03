package client

import (
	"bytes"
	"encoding/binary"
	"strings"
	"testing"
)

func testHeader(streamID uint32, frameType byte, length uint32) []byte {
	buf := make([]byte, HeaderSize)
	binary.BigEndian.PutUint32(buf[0:4], streamID)
	buf[4] = frameType
	binary.BigEndian.PutUint32(buf[5:9], length)
	return buf
}

func TestReadFrameRejectsOversizedPayload(t *testing.T) {
	raw := testHeader(1, FrameData, 1<<20)
	_, _, _, err := readFrame(bytes.NewReader(raw))
	if err == nil || !strings.Contains(err.Error(), "exceeds 64KB") {
		t.Fatalf("expected 64KB limit error, got %v", err)
	}
}

func TestReadFrameRejectsTruncatedPayload(t *testing.T) {
	raw := append(testHeader(1, FrameData, 10), []byte("short")...)
	if _, _, _, err := readFrame(bytes.NewReader(raw)); err == nil {
		t.Fatal("expected a truncation error")
	}
}

func TestReadFrameRoundTrip(t *testing.T) {
	payload := []byte("payload")
	raw := encodeFrame(7, FrameSyn, payload)

	streamID, frameType, decoded, err := readFrame(bytes.NewReader(raw))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if streamID != 7 || frameType != FrameSyn || !bytes.Equal(decoded, payload) {
		t.Fatalf("unexpected frame: id=%d type=%d payload=%q", streamID, frameType, decoded)
	}
}
