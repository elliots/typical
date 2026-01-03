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
	session  *project.Session
	cwd      string
	fs       vfs.FS
	mu       sync.Mutex
	projects map[string]*projectInfo
	nextId   int
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
		session:  session,
		cwd:      opts.Cwd,
		fs:       opts.FS,
		projects: make(map[string]*projectInfo),
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

func (a *API) TransformFile(projectId, fileName string) (*TransformResponse, error) {
	debugf("[DEBUG] TransformFile called: project=%s file=%s\n", projectId, fileName)

	a.mu.Lock()
	info, ok := a.projects[projectId]
	a.mu.Unlock()

	if !ok {
		return nil, fmt.Errorf("project not found: %s", projectId)
	}

	fileName = a.toAbsolutePath(fileName)
	debugf("[DEBUG] Absolute path: %s\n", fileName)

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

	// Transform the file with source map
	debugf("[DEBUG] Starting transform...\n")
	code, sourceMap := transform.TransformFileWithSourceMap(sourceFile, checker, transform.DefaultConfig())
	debugf("[DEBUG] Transform complete, code length: %d\n", len(code))

	return &TransformResponse{
		Code:      code,
		SourceMap: sourceMap,
	}, nil
}

// TransformSource transforms a standalone TypeScript source string without needing a project.
// It creates a temporary directory with tsconfig.json and the source file to enable type checking.
func (a *API) TransformSource(fileName, source string) (*TransformResponse, error) {
	debugf("[DEBUG] TransformSource called: fileName=%s sourceLen=%d\n", fileName, len(source))

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

	code, sourceMap := transform.TransformFileWithSourceMap(sourceFile, checker, transform.DefaultConfig())
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
