//go:build js && wasm

// Package wasmapi provides a WASM-compatible API for the Typical compiler.
// It uses an in-memory virtual filesystem instead of the real filesystem,
// making it suitable for browser and other sandboxed environments.
package wasmapi

import (
	"context"
	"fmt"
	"os"
	"path/filepath"

	"github.com/microsoft/typescript-go/shim/bundled"
	"github.com/microsoft/typescript-go/shim/lsp/lsproto"
	"github.com/microsoft/typescript-go/shim/project"

	"github.com/elliots/typical/packages/compiler/internal/analyse"
	"github.com/elliots/typical/packages/compiler/internal/transform"
)

// In WASM, always enable debug for now
var debug = true // os.Getenv("DEBUG") == "1"

func debugf(format string, args ...any) {
	if debug {
		fmt.Fprintf(os.Stderr, format, args...)
	}
}

// TransformOptions contains options for transforming TypeScript source.
type TransformOptions struct {
	IgnoreTypes           []string `json:"ignoreTypes,omitempty"`
	MaxGeneratedFunctions int      `json:"maxGeneratedFunctions,omitempty"`
}

// TransformResult contains the result of a transform operation.
type TransformResult struct {
	Code      string                   `json:"code"`
	SourceMap *transform.RawSourceMap `json:"sourceMap,omitempty"`
}

// API provides WASM-compatible transformation functions.
type API struct {
	// For WASM, we use the bundled filesystem which wraps the OS VFS.
	// In the browser, the Go runtime's os package uses syscall/js to access
	// the JavaScript fs module provided via globalThis.fs.
	// The caller is responsible for setting up globalThis.fs appropriately:
	// - In Node.js: inject the real node:fs module
	// - In browser: inject a virtual filesystem implementation
}

// New creates a new WASM API instance.
func New() *API {
	return &API{}
}

// TransformSource transforms a standalone TypeScript source string.
// It creates a temporary directory with the source file to enable type checking.
func (a *API) TransformSource(fileName, source string, options *TransformOptions) (*TransformResult, error) {
	fmt.Fprintf(os.Stderr, "[WASM v2] TransformSource starting - fileName=%s\n", fileName)
	debugf("[WASM DEBUG] TransformSource called: fileName=%s sourceLen=%d\n", fileName, len(source))

	if options == nil {
		options = &TransformOptions{}
	}

	// Create a temporary directory for this transformation.
	// In WASM mode, os.MkdirTemp uses syscall/js to call globalThis.fs.mkdirSync.
	// The caller must provide an appropriate fs implementation.
	tmpDir, err := os.MkdirTemp("", "typical-wasm-*")
	if err != nil {
		return nil, fmt.Errorf("failed to create temp dir: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	// Write tsconfig.json
	tsconfigPath := filepath.Join(tmpDir, "tsconfig.json")
	tsconfigContent := `{"compilerOptions":{"strict":true,"target":"ES2020","module":"ESNext"},"include":["*.ts","*.tsx"]}`
	if err := os.WriteFile(tsconfigPath, []byte(tsconfigContent), 0644); err != nil {
		return nil, fmt.Errorf("failed to write tsconfig: %w", err)
	}

	// Write the source file
	sourcePath := filepath.Join(tmpDir, fileName)
	if err := os.WriteFile(sourcePath, []byte(source), 0644); err != nil {
		return nil, fmt.Errorf("failed to write source file: %w", err)
	}

	debugf("[WASM DEBUG] Temp paths: dir=%s tsconfig=%s source=%s\n", tmpDir, tsconfigPath, sourcePath)

	// Verify files were written
	if _, err := os.Stat(sourcePath); err != nil {
		return nil, fmt.Errorf("source file stat failed after write: %w", err)
	}
	debugf("[WASM DEBUG] Source file stat OK\n")

	content, err := os.ReadFile(sourcePath)
	if err != nil {
		return nil, fmt.Errorf("source file read failed after write: %w", err)
	}
	debugf("[WASM DEBUG] Source file read OK: %d bytes\n", len(content))

	// Create filesystem with bundled TypeScript libs
	// Use WasmFS instead of osvfs.FS() because os.DirFS doesn't work in WASM -
	// Go's io/fs interface doesn't properly route through globalThis.fs
	fs := bundled.WrapFS(WasmFS())

	// Create a session for this temporary project
	ctx := context.Background()
	tmpSession := project.NewSession(&project.SessionInit{
		FS: fs,
		Options: &project.SessionOptions{
			CurrentDirectory:   tmpDir,
			DefaultLibraryPath: bundled.LibPath(),
			PositionEncoding:   lsproto.PositionEncodingKindUTF8,
		},
	})

	// Debug: check directory listing through the VFS
	debugf("[WASM DEBUG] Checking directory entries for: %s\n", tmpDir)
	entries := fs.GetAccessibleEntries(tmpDir)
	debugf("[WASM DEBUG] Directory files: %v\n", entries.Files)
	debugf("[WASM DEBUG] Directory dirs: %v\n", entries.Directories)

	// Debug: check if tsconfig can be read through VFS
	if tscontent, ok := fs.ReadFile(tsconfigPath); ok {
		debugf("[WASM DEBUG] tsconfig.json content: %s\n", tscontent)
	} else {
		debugf("[WASM DEBUG] Failed to read tsconfig.json via VFS\n")
	}

	debugf("[WASM DEBUG] Opening project at: %s\n", tsconfigPath)
	proj, err := tmpSession.OpenProject(ctx, tsconfigPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create project: %w", err)
	}
	debugf("[WASM DEBUG] Project opened successfully\n")

	program := proj.GetProgram()
	debugf("[WASM DEBUG] Got program, source files count: %d\n", len(program.SourceFiles()))

	// Debug: check if file exists through the VFS
	debugf("[WASM DEBUG] Checking file via VFS: %s\n", sourcePath)
	if fs.FileExists(sourcePath) {
		debugf("[WASM DEBUG] VFS says file exists\n")
	} else {
		debugf("[WASM DEBUG] VFS says file does NOT exist\n")
		// Try reading directly
		if content, ok := fs.ReadFile(sourcePath); ok {
			debugf("[WASM DEBUG] But ReadFile returned %d bytes\n", len(content))
		} else {
			debugf("[WASM DEBUG] ReadFile also failed\n")
		}
	}

	// Debug: list all source files in the program
	debugf("[WASM DEBUG] Program source files:\n")
	for _, sf := range program.SourceFiles() {
		debugf("[WASM DEBUG]   - %s\n", sf.FileName())
	}

	sourceFile := program.GetSourceFile(sourcePath)
	if sourceFile == nil {
		return nil, fmt.Errorf("source file not found: %s", sourcePath)
	}

	checker, release := program.GetTypeChecker(ctx)
	defer release()

	// Build config with ignore patterns and max functions limit
	config := transform.DefaultConfig()
	config.IgnoreTypes = transform.CompileIgnorePatterns(options.IgnoreTypes)
	if options.MaxGeneratedFunctions > 0 {
		config.MaxGeneratedFunctions = options.MaxGeneratedFunctions
	}

	// Run project analysis even for single-file transforms
	// This enables cross-function optimisations within the file
	analyseConfig := analyse.Config{
		ValidateParameters:     config.ValidateParameters,
		ValidateReturns:        config.ValidateReturns,
		ValidateCasts:          config.ValidateCasts,
		TransformJSONParse:     config.TransformJSONParse,
		TransformJSONStringify: config.TransformJSONStringify,
		IgnoreTypes:            config.IgnoreTypes,
		PureFunctions:          config.PureFunctions,
	}
	projectAnalysis := analyse.AnalyseProject(program, checker, analyseConfig)
	config.ProjectAnalysis = projectAnalysis
	debugf("[WASM DEBUG] Project analysis complete: %d functions found\n", len(projectAnalysis.CallGraph))

	code, sourceMap, err := transform.TransformFileWithSourceMapAndError(sourceFile, checker, program, config)
	if err != nil {
		return nil, err
	}

	debugf("[WASM DEBUG] TransformSource complete, code length: %d\n", len(code))

	return &TransformResult{
		Code:      code,
		SourceMap: sourceMap,
	}, nil
}
