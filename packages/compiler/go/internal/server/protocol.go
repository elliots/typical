package server

import "github.com/elliots/typical/packages/compiler/internal/transform"

// MessagePack protocol types - matching tsgo's api/server.go

type MessageType uint8

const (
	MessageTypeUnknown MessageType = iota
	MessageTypeRequest
	MessageTypeCallResponse
	MessageTypeCallError
	MessageTypeResponse
	MessageTypeError
	MessageTypeCall
)

func (m MessageType) IsValid() bool {
	return m >= MessageTypeRequest && m <= MessageTypeCall
}

func (m MessageType) String() string {
	switch m {
	case MessageTypeRequest:
		return "request"
	case MessageTypeCallResponse:
		return "call-response"
	case MessageTypeCallError:
		return "call-error"
	case MessageTypeResponse:
		return "response"
	case MessageTypeError:
		return "error"
	case MessageTypeCall:
		return "call"
	default:
		return "unknown"
	}
}

type MessagePackType uint8

const (
	MessagePackTypeFixedArray3 MessagePackType = 0x93
	MessagePackTypeBin8        MessagePackType = 0xC4
	MessagePackTypeBin16       MessagePackType = 0xC5
	MessagePackTypeBin32       MessagePackType = 0xC6
	MessagePackTypeU8          MessagePackType = 0xCC
)

// API method names
const (
	MethodEcho            = "echo"
	MethodLoadProject     = "loadProject"
	MethodTransformFile   = "transformFile"
	MethodTransformSource = "transformSource"
	MethodRelease         = "release"
	MethodAnalyseFile     = "analyseFile"
)

// Request/Response types

type LoadProjectParams struct {
	ConfigFileName string `json:"configFileName"`
}

type ProjectResponse struct {
	Id         string   `json:"id"`
	ConfigFile string   `json:"configFile"`
	RootFiles  []string `json:"rootFiles"`
}

type TransformFileParams struct {
	Project               string   `json:"project"`
	FileName              string   `json:"fileName"`
	IgnoreTypes           []string `json:"ignoreTypes,omitempty"`           // Glob patterns for types to skip
	MaxGeneratedFunctions int      `json:"maxGeneratedFunctions,omitempty"` // Max helper functions before error (0 = default 50)
	ReusableValidators    *string  `json:"reusableValidators,omitempty"`    // "auto" (default), "never", or "always"
}

type TransformSourceParams struct {
	FileName              string   `json:"fileName"`                        // Virtual filename for error messages
	Source                string   `json:"source"`                          // TypeScript source code
	IgnoreTypes           []string `json:"ignoreTypes,omitempty"`           // Glob patterns for types to skip
	MaxGeneratedFunctions int      `json:"maxGeneratedFunctions,omitempty"` // Max helper functions before error (0 = default 50)
	ReusableValidators    *string  `json:"reusableValidators,omitempty"`    // "auto" (default), "never", or "always"
}

type TransformResponse struct {
	Code      string                  `json:"code"`
	SourceMap *transform.RawSourceMap `json:"sourceMap,omitempty"`
}

// AnalyseFileParams contains parameters for the analyseFile method
type AnalyseFileParams struct {
	Project     string   `json:"project"`
	FileName    string   `json:"fileName"`
	Content     string   `json:"content,omitempty"`     // Optional: file content (if provided, uses this instead of reading from disk)
	IgnoreTypes []string `json:"ignoreTypes,omitempty"`
}

// AnalyseFileResponse contains the analysis results
type AnalyseFileResponse struct {
	Items []ValidationItem `json:"items"`
}

// ValidationItem represents a single validation point in the source code
type ValidationItem struct {
	StartLine   int    `json:"startLine"`            // 1-based line number
	StartColumn int    `json:"startColumn"`          // 0-based column
	EndLine     int    `json:"endLine"`              // 1-based line number
	EndColumn   int    `json:"endColumn"`            // 0-based column
	Kind        string `json:"kind"`                 // "parameter", "return", "cast", "json-parse", "json-stringify"
	Name        string `json:"name"`                 // param name, "return value", or expression text
	Status      string `json:"status"`               // "validated" or "skipped"
	TypeString  string `json:"typeString"`           // e.g. "User", "string | null"
	SkipReason  string `json:"skipReason,omitempty"` // reason for skipping (when status is "skipped")
}
