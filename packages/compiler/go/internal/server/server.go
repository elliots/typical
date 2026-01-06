package server

import (
	"bufio"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"github.com/microsoft/typescript-go/shim/bundled"
	"github.com/microsoft/typescript-go/shim/vfs/osvfs"
)

var (
	ErrInvalidRequest = errors.New("invalid request")
)

// extractMethod extracts the base method name from a requestId.
// RequestIds have format "method:id" (e.g., "transformFile:0") or just "method".
func extractMethod(requestId string) string {
	if idx := strings.Index(requestId, ":"); idx != -1 {
		return requestId[:idx]
	}
	return requestId
}

type Options struct {
	In  io.Reader
	Out io.Writer
	Err io.Writer
	Cwd string
}

type Server struct {
	r      *bufio.Reader
	w      *bufio.Writer
	stderr io.Writer
	cwd    string
	api    *API
}

func New(opts *Options) *Server {
	if opts.Cwd == "" {
		panic("Cwd is required")
	}

	fs := bundled.WrapFS(osvfs.FS())
	defaultLibPath := bundled.LibPath()

	s := &Server{
		r:      bufio.NewReader(opts.In),
		w:      bufio.NewWriter(opts.Out),
		stderr: opts.Err,
		cwd:    opts.Cwd,
	}

	s.api = NewAPI(&APIOptions{
		Cwd:                opts.Cwd,
		FS:                 fs,
		DefaultLibraryPath: defaultLibPath,
	})

	return s
}

func (s *Server) Run() error {
	for {
		messageType, requestId, payload, err := s.readRequest()
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}

		if messageType != MessageTypeRequest {
			return fmt.Errorf("%w: expected request, received: %s", ErrInvalidRequest, messageType.String())
		}

		// Extract base method from requestId (format: "method:id" or just "method")
		method := extractMethod(requestId)

		result, err := s.handleRequest(method, payload)
		if err != nil {
			// Echo back the full requestId, not just method
			if sendErr := s.sendError(requestId, err); sendErr != nil {
				return sendErr
			}
		} else {
			// Echo back the full requestId, not just method
			if sendErr := s.sendResponse(requestId, result); sendErr != nil {
				return sendErr
			}
		}
	}
}

func (s *Server) handleRequest(method string, payload []byte) ([]byte, error) {
	switch method {
	case MethodEcho:
		return payload, nil

	case MethodLoadProject:
		var params LoadProjectParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
		resp, err := s.api.LoadProject(params.ConfigFileName)
		if err != nil {
			return nil, err
		}
		return json.Marshal(resp)

	case MethodTransformFile:
		var params TransformFileParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
		resp, err := s.api.TransformFile(params.Project, params.FileName, params.IgnoreTypes, params.MaxGeneratedFunctions, params.ReusableValidators)
		if err != nil {
			return nil, err
		}
		return json.Marshal(resp)

	case MethodTransformSource:
		var params TransformSourceParams
		if err := json.Unmarshal(payload, &params); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
		resp, err := s.api.TransformSource(params.FileName, params.Source, params.IgnoreTypes, params.MaxGeneratedFunctions, params.ReusableValidators)
		if err != nil {
			return nil, err
		}
		return json.Marshal(resp)

	case MethodRelease:
		var handle string
		if err := json.Unmarshal(payload, &handle); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrInvalidRequest, err)
		}
		return nil, s.api.Release(handle)

	default:
		return nil, fmt.Errorf("unknown method: %s", method)
	}
}

func (s *Server) readRequest() (messageType MessageType, method string, payload []byte, err error) {
	// Read fixed array marker (0x93 = 3-element array)
	t, err := s.r.ReadByte()
	if err != nil {
		return 0, "", nil, err
	}
	if MessagePackType(t) != MessagePackTypeFixedArray3 {
		return 0, "", nil, fmt.Errorf("%w: expected 0x93, got 0x%02x", ErrInvalidRequest, t)
	}

	// Read message type (u8)
	t, err = s.r.ReadByte()
	if err != nil {
		return 0, "", nil, err
	}
	if MessagePackType(t) != MessagePackTypeU8 {
		return 0, "", nil, fmt.Errorf("%w: expected 0xCC, got 0x%02x", ErrInvalidRequest, t)
	}

	rawType, err := s.r.ReadByte()
	if err != nil {
		return 0, "", nil, err
	}
	messageType = MessageType(rawType)
	if !messageType.IsValid() {
		return 0, "", nil, fmt.Errorf("%w: invalid message type: %d", ErrInvalidRequest, messageType)
	}

	// Read method (bin)
	methodBytes, err := s.readBin()
	if err != nil {
		return 0, "", nil, err
	}
	method = string(methodBytes)

	// Read payload (bin)
	payload, err = s.readBin()
	if err != nil {
		return 0, "", nil, err
	}

	return messageType, method, payload, nil
}

func (s *Server) readBin() ([]byte, error) {
	t, err := s.r.ReadByte()
	if err != nil {
		return nil, err
	}

	var size uint32
	switch MessagePackType(t) {
	case MessagePackTypeBin8:
		var size8 uint8
		if err := binary.Read(s.r, binary.BigEndian, &size8); err != nil {
			return nil, err
		}
		size = uint32(size8)
	case MessagePackTypeBin16:
		var size16 uint16
		if err := binary.Read(s.r, binary.BigEndian, &size16); err != nil {
			return nil, err
		}
		size = uint32(size16)
	case MessagePackTypeBin32:
		if err := binary.Read(s.r, binary.BigEndian, &size); err != nil {
			return nil, err
		}
	default:
		return nil, fmt.Errorf("%w: expected bin (0xC4-0xC6), got 0x%02x", ErrInvalidRequest, t)
	}

	data := make([]byte, size)
	if _, err := io.ReadFull(s.r, data); err != nil {
		return nil, err
	}
	return data, nil
}

func (s *Server) sendResponse(method string, result []byte) error {
	return s.writeMessage(MessageTypeResponse, method, result)
}

func (s *Server) sendError(method string, err error) error {
	return s.writeMessage(MessageTypeError, method, []byte(err.Error()))
}

func (s *Server) writeMessage(messageType MessageType, method string, payload []byte) error {
	// Write fixed array marker
	if err := s.w.WriteByte(byte(MessagePackTypeFixedArray3)); err != nil {
		return err
	}

	// Write message type
	if err := s.w.WriteByte(byte(MessagePackTypeU8)); err != nil {
		return err
	}
	if err := s.w.WriteByte(byte(messageType)); err != nil {
		return err
	}

	// Write method
	if err := s.writeBin([]byte(method)); err != nil {
		return err
	}

	// Write payload
	if err := s.writeBin(payload); err != nil {
		return err
	}

	return s.w.Flush()
}

func (s *Server) writeBin(data []byte) error {
	length := len(data)

	if length < 256 {
		if err := s.w.WriteByte(byte(MessagePackTypeBin8)); err != nil {
			return err
		}
		if err := s.w.WriteByte(byte(length)); err != nil {
			return err
		}
	} else if length < 65536 {
		if err := s.w.WriteByte(byte(MessagePackTypeBin16)); err != nil {
			return err
		}
		if err := binary.Write(s.w, binary.BigEndian, uint16(length)); err != nil {
			return err
		}
	} else {
		if err := s.w.WriteByte(byte(MessagePackTypeBin32)); err != nil {
			return err
		}
		if err := binary.Write(s.w, binary.BigEndian, uint32(length)); err != nil {
			return err
		}
	}

	_, err := s.w.Write(data)
	return err
}
