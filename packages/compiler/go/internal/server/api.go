package server

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sync"

	"github.com/microsoft/typescript-go/shim/bundled"
	"github.com/microsoft/typescript-go/shim/lsp/lsproto"
	"github.com/microsoft/typescript-go/shim/project"
	"github.com/microsoft/typescript-go/shim/tspath"
	"github.com/microsoft/typescript-go/shim/vfs"

	"github.com/elliots/typical/packages/compiler/internal/analyse"
	"github.com/elliots/typical/packages/compiler/internal/transform"
)

var debug = os.Getenv("DEBUG") == "1"

func debugf(format string, args ...any) {
	if debug {
		fmt.Fprintf(os.Stderr, format, args...)
	}
}

type APIOptions struct {
	Cwd                string
	FS                 vfs.FS
	DefaultLibraryPath string
}

type projectInfo struct {
	path    tspath.Path
	project *project.Project
}

type API struct {
	session        *project.Session
	cwd            string
	fs             vfs.FS
	mu             sync.Mutex
	projects       map[string]*projectInfo
	nextId         int
	fileVersions   map[string]int32 // track version per file for overlays
	openFiles      map[string]bool  // track which files have been opened via DidOpenFile
}

func NewAPI(opts *APIOptions) *API {
	session := project.NewSession(&project.SessionInit{
		FS: opts.FS,
		Options: &project.SessionOptions{
			CurrentDirectory:   opts.Cwd,
			DefaultLibraryPath: opts.DefaultLibraryPath,
			PositionEncoding:   lsproto.PositionEncodingKindUTF8,
		},
	})

	return &API{
		session:      session,
		cwd:          opts.Cwd,
		fs:           opts.FS,
		projects:     make(map[string]*projectInfo),
		fileVersions: make(map[string]int32),
		openFiles:    make(map[string]bool),
	}
}

func (a *API) LoadProject(configFileName string) (*ProjectResponse, error) {
	configFileName = a.toAbsolutePath(configFileName)

	ctx := context.Background()
	proj, err := a.session.OpenProject(ctx, configFileName)
	if err != nil {
		return nil, fmt.Errorf("failed to open project: %w", err)
	}

	a.mu.Lock()
	defer a.mu.Unlock()

	a.nextId++
	id := fmt.Sprintf("p%d", a.nextId)

	a.projects[id] = &projectInfo{
		path:    proj.ConfigFilePath(),
		project: proj,
	}

	rootFiles := proj.CommandLine.FileNames()

	return &ProjectResponse{
		Id:         id,
		ConfigFile: configFileName,
		RootFiles:  rootFiles,
	}, nil
}

func (a *API) TransformFile(projectId, fileName string, ignoreTypes []string, maxGeneratedFunctions int, reusableValidators *string) (*TransformResponse, error) {
	debugf("[DEBUG] TransformFile called: project=%s file=%s ignoreTypes=%v maxFuncs=%d reusable=%v\n", projectId, fileName, ignoreTypes, maxGeneratedFunctions, reusableValidators)

	a.mu.Lock()
	info, ok := a.projects[projectId]
	a.mu.Unlock()

	if !ok {
		return nil, fmt.Errorf("project not found: %s", projectId)
	}

	fileName = a.toAbsolutePath(fileName)
	debugf("[DEBUG] Absolute path: %s\n", fileName)

	debugf("[DEBUG] Getting program...\n")
	program := info.project.GetProgram()
	debugf("[DEBUG] Got program\n")

	sourceFile := program.GetSourceFile(fileName)
	if sourceFile == nil {
		return nil, fmt.Errorf("source file not found: %s", fileName)
	}
	debugf("[DEBUG] Got source file\n")

	ctx := context.Background()
	debugf("[DEBUG] Getting type checker...\n")
	checker, release := program.GetTypeChecker(ctx)
	defer release()
	debugf("[DEBUG] Got type checker\n")

	// Build config with ignore patterns and max functions limit
	config := transform.DefaultConfig()
	config.IgnoreTypes = transform.CompileIgnorePatterns(ignoreTypes)
	if maxGeneratedFunctions > 0 {
		config.MaxGeneratedFunctions = maxGeneratedFunctions
	}
	if reusableValidators != nil {
		config.ReusableValidators = transform.ReusableValidatorsMode(*reusableValidators)
	}

	// Transform the file with source map
	debugf("[DEBUG] Starting transform...\n")
	code, sourceMap, err := transform.TransformFileWithSourceMapAndError(sourceFile, checker, program, config)
	if err != nil {
		return nil, err
	}
	debugf("[DEBUG] Transform complete, code length: %d\n", len(code))

	return &TransformResponse{
		Code:      code,
		SourceMap: sourceMap,
	}, nil
}

// TransformSource transforms a standalone TypeScript source string without needing a project.
// It creates a temporary directory with tsconfig.json and the source file to enable type checking.
func (a *API) TransformSource(fileName, source string, ignoreTypes []string, maxGeneratedFunctions int, reusableValidators *string) (*TransformResponse, error) {
	debugf("[DEBUG] TransformSource called: fileName=%s sourceLen=%d ignoreTypes=%v maxFuncs=%d reusable=%v\n", fileName, len(source), ignoreTypes, maxGeneratedFunctions, reusableValidators)

	// Create a temporary directory for this transformation
	tmpDir, err := os.MkdirTemp("", "typical-transform-*")
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

	debugf("[DEBUG] Temp paths: dir=%s tsconfig=%s source=%s\n", tmpDir, tsconfigPath, sourcePath)

	// Create a session for this temporary project
	ctx := context.Background()
	tmpSession := project.NewSession(&project.SessionInit{
		FS: a.fs,
		Options: &project.SessionOptions{
			CurrentDirectory:   tmpDir,
			DefaultLibraryPath: bundled.LibPath(),
			PositionEncoding:   lsproto.PositionEncodingKindUTF8,
		},
	})

	proj, err := tmpSession.OpenProject(ctx, tsconfigPath)
	if err != nil {
		return nil, fmt.Errorf("failed to create project: %w", err)
	}

	program := proj.GetProgram()
	sourceFile := program.GetSourceFile(sourcePath)
	if sourceFile == nil {
		return nil, fmt.Errorf("source file not found: %s", sourcePath)
	}

	checker, release := program.GetTypeChecker(ctx)
	defer release()

	// Build config with ignore patterns and max functions limit
	config := transform.DefaultConfig()
	config.IgnoreTypes = transform.CompileIgnorePatterns(ignoreTypes)
	if maxGeneratedFunctions > 0 {
		config.MaxGeneratedFunctions = maxGeneratedFunctions
	}
	if reusableValidators != nil {
		config.ReusableValidators = transform.ReusableValidatorsMode(*reusableValidators)
	}

	code, sourceMap, err := transform.TransformFileWithSourceMapAndError(sourceFile, checker, program, config)
	if err != nil {
		return nil, err
	}
	debugf("[DEBUG] TransformSource complete, code length: %d\n", len(code))

	return &TransformResponse{
		Code:      code,
		SourceMap: sourceMap,
	}, nil
}

func (a *API) Release(handle string) error {
	a.mu.Lock()
	defer a.mu.Unlock()

	if _, ok := a.projects[handle]; ok {
		delete(a.projects, handle)
		return nil
	}

	return fmt.Errorf("handle not found: %s", handle)
}

func (a *API) toAbsolutePath(path string) string {
	return tspath.GetNormalizedAbsolutePath(path, a.cwd)
}

// AnalyseFile analyses a file for validation points without transforming it.
// Returns validation items that can be used by the VSCode extension.
// If content is provided, it updates the file overlay before analysing.
func (a *API) AnalyseFile(projectId, fileName, content string, ignoreTypes []string) (*AnalyseFileResponse, error) {
	debugf("[DEBUG] AnalyseFile called: project=%s file=%s contentLen=%d ignoreTypes=%v\n", projectId, fileName, len(content), ignoreTypes)

	// Verify the project exists (we still need to validate the projectId)
	a.mu.Lock()
	_, ok := a.projects[projectId]
	a.mu.Unlock()

	if !ok {
		return nil, fmt.Errorf("project not found: %s", projectId)
	}

	fileName = a.toAbsolutePath(fileName)
	debugf("[DEBUG] Absolute path: %s\n", fileName)

	ctx := context.Background()

	// Build URI for the file
	uri := lsproto.DocumentUri("file://" + fileName)

	// If content is provided, update the file overlay in the session
	if content != "" {
		// Increment version for this file
		a.mu.Lock()
		a.fileVersions[fileName]++
		version := a.fileVersions[fileName]
		isOpen := a.openFiles[fileName]
		a.mu.Unlock()

		if !isOpen {
			// First time seeing this file - use DidOpenFile to create the overlay
			debugf("[DEBUG] Calling DidOpenFile with URI: %s, version: %d, contentLen: %d\n", uri, version, len(content))
			project.Session_DidOpenFile(a.session, ctx, uri, version, content, lsproto.LanguageKindTypeScript)

			a.mu.Lock()
			a.openFiles[fileName] = true
			a.mu.Unlock()
			debugf("[DEBUG] Opened file overlay for %s\n", fileName)
		} else {
			// File already open - use DidChangeFile with a whole document change
			changes := []lsproto.TextDocumentContentChangePartialOrWholeDocument{
				{
					WholeDocument: &lsproto.TextDocumentContentChangeWholeDocument{
						Text: content,
					},
				},
			}
			debugf("[DEBUG] Calling DidChangeFile with URI: %s, version: %d, contentLen: %d\n", uri, version, len(content))
			project.Session_DidChangeFile(a.session, ctx, uri, version, changes)
			debugf("[DEBUG] Updated file overlay for %s\n", fileName)
		}
	}

	// Use GetLanguageServiceAndProjectsForFile - this is exactly what the LSP server uses.
	// It properly flushes pending changes, updates the snapshot, and returns a fresh program.
	proj, _, _, err := project.Session_GetLanguageServiceAndProjectsForFile(a.session, ctx, uri)
	if err != nil {
		return nil, fmt.Errorf("failed to get project for file: %w", err)
	}

	program := proj.GetProgram()
	sourceFile := program.GetSourceFile(fileName)

	if sourceFile == nil {
		return nil, fmt.Errorf("source file not found: %s", fileName)
	}

	debugf("[DEBUG] SourceFile text length: %d\n", len(sourceFile.Text()))

	checker, release := program.GetTypeChecker(ctx)
	defer release()

	// Build analyse config
	config := analyse.Config{
		ValidateParameters:     true,
		ValidateReturns:        true,
		ValidateCasts:          true,
		TransformJSONParse:     true,
		TransformJSONStringify: true,
		IgnoreTypes:            transform.CompileIgnorePatterns(ignoreTypes),
		PureFunctions:          transform.CompileIgnorePatterns([]string{"console.*", "JSON.stringify"}),
	}

	// Analyse the file
	result := analyse.AnalyseFile(sourceFile, checker, program, config)

	// Convert analyse.ValidationItem to server.ValidationItem
	items := make([]ValidationItem, len(result.Items))
	for i, item := range result.Items {
		items[i] = ValidationItem{
			StartLine:   item.StartLine,
			StartColumn: item.StartColumn,
			EndLine:     item.EndLine,
			EndColumn:   item.EndColumn,
			Kind:        item.Kind,
			Name:        item.Name,
			Status:      item.Status,
			TypeString:  item.TypeString,
			SkipReason:  item.SkipReason,
		}
	}

	debugf("[DEBUG] AnalyseFile complete, found %d validation items\n", len(items))

	return &AnalyseFileResponse{
		Items: items,
	}, nil
}
