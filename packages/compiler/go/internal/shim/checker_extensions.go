// Package checker provides additional shim functions for typical-compiler.
// This file extends the auto-generated shim.go with functions needed for validation.
// It is NOT overwritten by sync-shims.sh.
package checker

import (
	"unsafe"

	"github.com/microsoft/typescript-go/internal/ast"
	"github.com/microsoft/typescript-go/internal/checker"
)

// Checker_GetTypeAtLocation returns the type of a node.
// This is useful for getting the type of an expression without needing a type annotation.
//
//go:linkname Checker_GetTypeAtLocation github.com/microsoft/typescript-go/internal/checker.(*Checker).GetTypeAtLocation
func Checker_GetTypeAtLocation(recv *checker.Checker, node *ast.Node) *checker.Type

// Type_TargetTupleType returns the target TupleType for a tuple type reference.
// Returns nil if the type is not a tuple type reference.
func Type_TargetTupleType(t *checker.Type) *checker.TupleType {
	if !IsTupleType(t) {
		return nil
	}
	return t.TargetTupleType()
}

// Type_Target returns the target type for a type reference.
// Returns nil if the type is not a reference type.
func Type_Target(t *checker.Type) *checker.Type {
	objFlags := Type_objectFlags(t)
	if objFlags&ObjectFlagsReference == 0 {
		return nil
	}
	return t.Target()
}

// TemplateLiteralType accessors

// extra_TemplateLiteralType mirrors the internal layout of checker.TemplateLiteralType
// to allow access to unexported fields.
type extra_TemplateLiteralType struct {
	// ConstrainedType embedded fields:
	// - TypeBase (contains Type struct)
	// - resolvedBaseConstraint *Type
	checker.ConstrainedType
	texts []string
	types []*checker.Type
}

// TemplateLiteralType_Texts returns the static text parts of a template literal type.
// The texts array is always one element longer than the types array.
// For `hello-${string}-world`, texts would be ["hello-", "-world"].
func TemplateLiteralType_Texts(t *checker.TemplateLiteralType) []string {
	return ((*extra_TemplateLiteralType)(unsafe.Pointer(t))).texts
}

// TemplateLiteralType_Types returns the dynamic type parts of a template literal type.
// For `hello-${string}-world`, types would be [string type].
func TemplateLiteralType_Types(t *checker.TemplateLiteralType) []*checker.Type {
	return ((*extra_TemplateLiteralType)(unsafe.Pointer(t))).types
}

// IsTemplateLiteralType checks if a type is a template literal type.
func IsTemplateLiteralType(t *checker.Type) bool {
	return Type_flags(t)&TypeFlagsTemplateLiteral != 0
}
