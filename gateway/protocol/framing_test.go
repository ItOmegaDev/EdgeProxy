package protocol

import (
	"bytes"
	"testing"
)

func TestEncodeDecodeFrame(t *testing.T) {
	orig := &Frame{
		StreamID: 1042,
		Type:     FrameData,
		Length:   5,
		Payload:  []byte("hello"),
	}

	encoded := orig.Encode()
	if len(encoded) != HeaderSize+5 {
		t.Fatalf("expected encoded length %d, got %d", HeaderSize+5, len(encoded))
	}

	buf := bytes.NewReader(encoded)
	decoded, err := ReadFrame(buf)
	if err != nil {
		t.Fatalf("unexpected read error: %v", err)
	}

	if decoded.StreamID != orig.StreamID {
		t.Errorf("expected StreamID %d, got %d", orig.StreamID, decoded.StreamID)
	}
	if decoded.Type != orig.Type {
		t.Errorf("expected Type 0x%02x, got 0x%02x", orig.Type, decoded.Type)
	}
	if decoded.Length != orig.Length {
		t.Errorf("expected Length %d, got %d", orig.Length, decoded.Length)
	}
	if !bytes.Equal(decoded.Payload, orig.Payload) {
		t.Errorf("expected payload '%s', got '%s'", string(orig.Payload), string(decoded.Payload))
	}
}

func TestPayloadTooLarge(t *testing.T) {
	fakeHeader := make([]byte, HeaderSize)
	// Put length > 65536
	fakeHeader[4] = FrameData
	fakeHeader[5] = 0x00
	fakeHeader[6] = 0x02 // 131072 bytes
	fakeHeader[7] = 0x00
	fakeHeader[8] = 0x00

	buf := bytes.NewReader(fakeHeader)
	_, err := ReadFrame(buf)
	if err == nil {
		t.Fatal("expected error for payload size exceeding 64KB, got nil")
	}
}
