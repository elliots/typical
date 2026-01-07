// Package project provides additional shim functions for typical-compiler.
// This file extends the auto-generated shim.go with functions needed for live updates.
// It is NOT overwritten by sync-shims.sh - it is copied to shim/project/typical_extensions.go
package project

import (
	"context"
	_ "unsafe"

	"github.com/microsoft/typescript-go/internal/ls"
	"github.com/microsoft/typescript-go/internal/lsp/lsproto"
	"github.com/microsoft/typescript-go/internal/project"
)

// Session_DidChangeFile notifies the session that a file's content has changed.
// This updates the overlay for the file, allowing subsequent operations to see the new content.
//
//go:linkname Session_DidChangeFile github.com/microsoft/typescript-go/internal/project.(*Session).DidChangeFile
func Session_DidChangeFile(recv *project.Session, ctx context.Context, uri lsproto.DocumentUri, version int32, changes []lsproto.TextDocumentContentChangePartialOrWholeDocument)

// Session_DidOpenFile notifies the session that a file has been opened with content.
// This immediately flushes pending changes and updates the snapshot.
//
//go:linkname Session_DidOpenFile github.com/microsoft/typescript-go/internal/project.(*Session).DidOpenFile
func Session_DidOpenFile(recv *project.Session, ctx context.Context, uri lsproto.DocumentUri, version int32, content string, languageKind lsproto.LanguageKind)

// Session_DidCloseFile notifies the session that a file has been closed.
//
//go:linkname Session_DidCloseFile github.com/microsoft/typescript-go/internal/project.(*Session).DidCloseFile
func Session_DidCloseFile(recv *project.Session, ctx context.Context, uri lsproto.DocumentUri)

// Session_GetProjectsForFile gets all projects containing the given file.
// This method properly flushes pending changes and updates the snapshot before returning projects.
// It ensures the returned projects have up-to-date programs reflecting any overlay changes.
//
//go:linkname Session_GetProjectsForFile github.com/microsoft/typescript-go/internal/project.(*Session).GetProjectsForFile
func Session_GetProjectsForFile(recv *project.Session, ctx context.Context, uri lsproto.DocumentUri) ([]ls.Project, error)

// Session_GetLanguageServiceAndProjectsForFile gets the default project, language service, and all projects for a file.
// This is the method used by the LSP server for handling requests - it properly flushes pending changes,
// updates the snapshot, and returns a LanguageService with an up-to-date program.
//
//go:linkname Session_GetLanguageServiceAndProjectsForFile github.com/microsoft/typescript-go/internal/project.(*Session).GetLanguageServiceAndProjectsForFile
func Session_GetLanguageServiceAndProjectsForFile(recv *project.Session, ctx context.Context, uri lsproto.DocumentUri) (*project.Project, *ls.LanguageService, []ls.Project, error)
