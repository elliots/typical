//go:build js && wasm

// Package wasmapi provides a WASM-compatible filesystem implementation.
// This is needed because os.DirFS doesn't work correctly in WASM mode -
// Go's io/fs interface for DirFS doesn't properly route through globalThis.fs.
// Instead, we use direct os.* calls which DO work with globalThis.fs.
// For directory listing, we call JavaScript's fs.readdirSync directly via syscall/js
// because Go's os.ReadDir tries to open directories as files, which ZenFS doesn't support.
package wasmapi

import (
	"io/fs"
	"os"
	"path/filepath"
	"syscall/js"
	"time"

	"github.com/microsoft/typescript-go/shim/tspath"
	"github.com/microsoft/typescript-go/shim/vfs"
)

// wasmFS is a VFS implementation that uses direct os.* calls instead of os.DirFS.
// This is required in WASM because os.DirFS uses Go's io/fs interface which
// doesn't properly integrate with the globalThis.fs provided by the JavaScript host.
type wasmFS struct{}

// WasmFS returns a VFS implementation suitable for WASM environments.
func WasmFS() vfs.FS {
	return &wasmFS{}
}

func (w *wasmFS) UseCaseSensitiveFileNames() bool {
	// In WASM/browser context, assume case-sensitive
	return true
}

func (w *wasmFS) ReadFile(path string) (contents string, ok bool) {
	debugf("[wasmFS] ReadFile: %s\n", path)
	data, err := os.ReadFile(path)
	if err != nil {
		debugf("[wasmFS] ReadFile error: %v\n", err)
		return "", false
	}
	debugf("[wasmFS] ReadFile success: %d bytes\n", len(data))
	return string(data), true
}

func (w *wasmFS) DirectoryExists(path string) bool {
	debugf("[wasmFS] DirectoryExists: %s\n", path)
	info, err := os.Stat(path)
	if err != nil {
		debugf("[wasmFS] DirectoryExists error: %v\n", err)
		return false
	}
	result := info.IsDir()
	debugf("[wasmFS] DirectoryExists result: %v\n", result)
	return result
}

func (w *wasmFS) FileExists(path string) bool {
	debugf("[wasmFS] FileExists: %s\n", path)
	info, err := os.Stat(path)
	if err != nil {
		debugf("[wasmFS] FileExists error: %v\n", err)
		return false
	}
	result := !info.IsDir()
	debugf("[wasmFS] FileExists result: %v\n", result)
	return result
}

func (w *wasmFS) GetAccessibleEntries(path string) (result vfs.Entries) {
	debugf("[wasmFS] GetAccessibleEntries: %s\n", path)

	// Call JavaScript's fs.readdirSync directly via syscall/js
	// because Go's os.ReadDir tries to open directories as files, which ZenFS doesn't support.
	fsGlobal := js.Global().Get("fs")
	if fsGlobal.IsUndefined() {
		debugf("[wasmFS] GetAccessibleEntries: globalThis.fs is undefined\n")
		return result
	}
	debugf("[wasmFS] GetAccessibleEntries: got fs global\n")

	readdirSync := fsGlobal.Get("readdirSync")
	if readdirSync.IsUndefined() {
		debugf("[wasmFS] GetAccessibleEntries: fs.readdirSync is undefined\n")
		return result
	}
	debugf("[wasmFS] GetAccessibleEntries: got readdirSync function\n")

	// Call readdirSync with withFileTypes option to get directory entries
	options := js.Global().Get("Object").New()
	options.Set("withFileTypes", true)
	debugf("[wasmFS] GetAccessibleEntries: calling readdirSync(%s, {withFileTypes: true})\n", path)

	var entries js.Value
	defer func() {
		if r := recover(); r != nil {
			debugf("[wasmFS] GetAccessibleEntries panic: %v\n", r)
		}
	}()

	entries = readdirSync.Invoke(path, options)
	debugf("[wasmFS] GetAccessibleEntries: readdirSync returned\n")
	if entries.IsUndefined() || entries.IsNull() {
		debugf("[wasmFS] GetAccessibleEntries: readdirSync returned nil\n")
		return result
	}

	length := entries.Length()
	debugf("[wasmFS] GetAccessibleEntries found %d entries\n", length)

	for i := 0; i < length; i++ {
		entry := entries.Index(i)
		name := entry.Get("name").String()

		// Check if it's a directory or file using isDirectory() and isFile() methods
		isDir := entry.Call("isDirectory").Bool()
		isFile := entry.Call("isFile").Bool()
		isSymlink := entry.Call("isSymbolicLink").Bool()

		debugf("[wasmFS] Entry: %s, isDir=%v, isFile=%v, isSymlink=%v\n", name, isDir, isFile, isSymlink)

		if isDir {
			result.Directories = append(result.Directories, name)
		} else if isFile {
			result.Files = append(result.Files, name)
		} else if isSymlink {
			// Handle symlinks by checking what they point to
			fullPath := filepath.Join(path, name)
			info, err := os.Stat(fullPath)
			if err == nil {
				if info.IsDir() {
					result.Directories = append(result.Directories, name)
				} else {
					result.Files = append(result.Files, name)
				}
			}
		}
	}

	debugf("[wasmFS] GetAccessibleEntries result: files=%v dirs=%v\n", result.Files, result.Directories)
	return result
}

func (w *wasmFS) Stat(path string) vfs.FileInfo {
	debugf("[wasmFS] Stat: %s\n", path)
	info, err := os.Stat(path)
	if err != nil {
		debugf("[wasmFS] Stat error: %v\n", err)
		return nil
	}
	debugf("[wasmFS] Stat success: name=%s size=%d isDir=%v\n", info.Name(), info.Size(), info.IsDir())
	return info
}

func (w *wasmFS) WalkDir(root string, walkFn vfs.WalkDirFunc) error {
	debugf("[wasmFS] WalkDir: %s\n", root)
	return filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
		// Normalise path separators
		path = tspath.NormalizeSlashes(path)
		return walkFn(path, d, err)
	})
}

func (w *wasmFS) Realpath(path string) string {
	debugf("[wasmFS] Realpath: %s\n", path)
	// In WASM, just normalise the path
	absPath, err := filepath.Abs(path)
	if err != nil {
		return path
	}
	return tspath.NormalizeSlashes(absPath)
}

func (w *wasmFS) WriteFile(path string, data string, writeByteOrderMark bool) error {
	debugf("[wasmFS] WriteFile: %s (%d bytes)\n", path, len(data))

	content := data
	if writeByteOrderMark {
		content = "\uFEFF" + data
	}

	// Ensure directory exists
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		debugf("[wasmFS] WriteFile mkdir error: %v\n", err)
		return err
	}

	err := os.WriteFile(path, []byte(content), 0644)
	if err != nil {
		debugf("[wasmFS] WriteFile error: %v\n", err)
	}
	return err
}

func (w *wasmFS) Remove(path string) error {
	debugf("[wasmFS] Remove: %s\n", path)
	return os.RemoveAll(path)
}

func (w *wasmFS) Chtimes(path string, aTime time.Time, mTime time.Time) error {
	debugf("[wasmFS] Chtimes: %s\n", path)
	return os.Chtimes(path, aTime, mTime)
}
