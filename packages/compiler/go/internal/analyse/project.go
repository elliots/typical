// Package analyse provides project-wide analysis for cross-file validation optimisation.
package analyse

import (
	"fmt"
	"os"
	"strings"

	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
	"github.com/microsoft/typescript-go/shim/compiler"
)

var debug = os.Getenv("DEBUG") == "1"

func debugf(format string, args ...interface{}) {
	if debug {
		fmt.Fprintf(os.Stderr, format, args...)
	}
}

// ProjectAnalysis holds whole-project analysis results for cross-file validation tracking.
type ProjectAnalysis struct {
	// CallGraph maps function keys to their analysis info
	CallGraph map[string]*FunctionInfo

	// ValidatedReturns maps function keys to whether they validate their return
	ValidatedReturns map[string]bool

	// ExportedFunctions maps function keys to whether they are exported
	ExportedFunctions map[string]bool

	// Files maps file paths to their analysis results
	Files map[string]*FileAnalysis

	// CheckTypeUsage maps type keys to usage counts for check validators
	// This is used by transform to decide when to hoist validators
	CheckTypeUsage map[string]int

	// FilterTypeUsage maps type keys to usage counts for filter validators
	FilterTypeUsage map[string]int

	// CheckTypeObjects maps type keys to type info for code generation
	CheckTypeObjects map[string]TypeInfo

	// FilterTypeObjects maps type keys to type info for code generation
	FilterTypeObjects map[string]TypeInfo

	// DirtyExternalArgs maps "callPos:argIndex" to dirty argument info
	// Used by transform to validate dirty values passed to external functions
	DirtyExternalArgs map[string]*DirtyExternalArg

	// UnvalidatedCallResults maps call position to info about calls that need result validation
	// Used by transform to validate results from functions that don't validate their returns
	UnvalidatedCallResults map[int]*UnvalidatedCallResult
}

// UnvalidatedCallResult describes a call whose result needs validation.
type UnvalidatedCallResult struct {
	// CallPos is the position of the call expression
	CallPos int

	// CallEnd is the end position of the call expression
	CallEnd int

	// Type is the return type that needs validation
	Type *checker.Type

	// TypeNode is the AST node for the type (for code generation)
	TypeNode *ast.Node

	// VarName is the variable being assigned to (if any)
	VarName string
}

// FunctionInfo contains analysis results for a single function.
type FunctionInfo struct {
	// Key is the unique identifier for this function
	Key string

	// Symbol is the TypeScript symbol for this function
	Symbol *ast.Symbol

	// FileName is the source file containing this function
	FileName string

	// Name is the function name (may be empty for anonymous functions)
	Name string

	// IsExported indicates if this function is exported from its module
	IsExported bool

	// IsAsync indicates if this is an async function
	IsAsync bool

	// Node is the AST node for the function declaration
	Node *ast.Node

	// Parameters contains info about each parameter
	Parameters []*ParameterInfo

	// ReturnType is the declared return type (nil if not annotated)
	ReturnType *checker.Type

	// HasReturnTypeAnnotation indicates if the function has an explicit return type
	HasReturnTypeAnnotation bool

	// ValidatesReturn indicates if this function validates its return value
	ValidatesReturn bool

	// ValidatesParams indicates which parameters are validated at entry
	ValidatesParams []bool

	// MutatesParams indicates which parameters might be mutated by this function
	MutatesParams []bool

	// EscapesParams indicates which parameters escape to external/stored locations
	EscapesParams []bool

	// CallSites contains all calls made within this function
	CallSites []*CallSite

	// CanSkipParamValidation indicates which params can skip validation
	// because all callers pre-validate them (only for non-exported functions)
	CanSkipParamValidation []bool

	// ValidatedVariables maps variable names to their validation position.
	// A variable is validated at a position and may become dirty later.
	ValidatedVariables map[string]*VariableValidation

	// BodyStart is the position where the function body starts (for dirty checking)
	BodyStart int

	// BodyNode is the function body AST node (for dirty checking)
	BodyNode *ast.Node
}

// VariableValidation tracks when and how a variable was validated.
type VariableValidation struct {
	// Position is where the variable was validated
	Position int

	// Type is the validated type
	Type *checker.Type

	// Source describes how the variable was validated
	Source string // "parameter", "cast", "json-parse", "trusted-call", "alias"
}

// ParameterInfo describes a function parameter.
type ParameterInfo struct {
	// Name is the parameter name
	Name string

	// Type is the parameter's type
	Type *checker.Type

	// IsOptional indicates if the parameter is optional
	IsOptional bool

	// Position is the parameter index (0-based)
	Position int

	// IsPrimitive indicates if the type is a primitive (string, number, etc.)
	IsPrimitive bool
}

// EscapeKind describes how a value escapes from its current scope.
type EscapeKind int

const (
	// EscapeNone means the value doesn't escape
	EscapeNone EscapeKind = iota

	// EscapeInternal means the value is passed to an internal project function
	EscapeInternal

	// EscapeExternal means the value is passed to an external/unknown function
	EscapeExternal

	// EscapeStored means the value is stored in a field, global, or closure
	EscapeStored
)

// CallSite represents a call to another function within a function body.
type CallSite struct {
	// CalleeFuncKey is the key into CallGraph for the callee (empty if external)
	CalleeFuncKey string

	// CalleeSymbol is the symbol of the called function
	CalleeSymbol *ast.Symbol

	// IsExternal indicates the callee is outside the project (node_modules, etc.)
	IsExternal bool

	// IsAsync indicates the callee is an async function
	IsAsync bool

	// Arguments contains info about each argument at this call site
	Arguments []*ArgumentInfo

	// Position is the source position of the call expression
	Position int

	// AssignedTo is the variable name if the result is assigned (empty otherwise)
	AssignedTo string

	// IsReturnValue indicates if this call's result is directly returned
	IsReturnValue bool
}

// ArgumentInfo describes an argument at a call site.
type ArgumentInfo struct {
	// ParamIndex is which parameter position this argument fills
	ParamIndex int

	// RootVariable is the root variable name if the argument is a variable reference
	RootVariable string

	// Type is the type of the argument expression
	Type *checker.Type

	// IsValidated indicates if this argument is known to be pre-validated
	IsValidated bool

	// EscapeKind describes how this argument escapes via this call
	EscapeKind EscapeKind

	// ValidationPath shows how validation was established (for debugging)
	ValidationPath []string
}

// FileAnalysis contains per-file analysis data.
type FileAnalysis struct {
	// FileName is the absolute path to the source file
	FileName string

	// Functions contains all functions defined in this file
	Functions []*FunctionInfo

	// ExportedSymbols maps symbol names to whether they're exported
	ExportedSymbols map[string]bool

	// Version is used for incremental invalidation
	Version int32
}

// AnalysisContext is passed through analysis phases.
type AnalysisContext struct {
	// Program is the TypeScript program
	Program *compiler.Program

	// Checker is the type checker
	Checker *checker.Checker

	// Config is the analysis configuration
	Config Config

	// ProjectAnalysis is the result being built
	ProjectAnalysis *ProjectAnalysis

	// CurrentFunction is the function currently being analysed
	CurrentFunction *FunctionInfo

	// VisitedFunctions tracks functions visited during propagation
	VisitedFunctions map[string]bool
}

// NewProjectAnalysis creates a new empty ProjectAnalysis.
func NewProjectAnalysis() *ProjectAnalysis {
	return &ProjectAnalysis{
		CallGraph:              make(map[string]*FunctionInfo),
		ValidatedReturns:       make(map[string]bool),
		ExportedFunctions:      make(map[string]bool),
		Files:                  make(map[string]*FileAnalysis),
		CheckTypeUsage:         make(map[string]int),
		FilterTypeUsage:        make(map[string]int),
		CheckTypeObjects:       make(map[string]TypeInfo),
		FilterTypeObjects:      make(map[string]TypeInfo),
		DirtyExternalArgs:      make(map[string]*DirtyExternalArg),
		UnvalidatedCallResults: make(map[int]*UnvalidatedCallResult),
	}
}

// AnalyseProject performs whole-project analysis for cross-file validation tracking.
func AnalyseProject(program *compiler.Program, c *checker.Checker, config Config) *ProjectAnalysis {
	ctx := &AnalysisContext{
		Program:          program,
		Checker:          c,
		Config:           config,
		ProjectAnalysis:  NewProjectAnalysis(),
		VisitedFunctions: make(map[string]bool),
	}

	// Phase 1: Collect all functions from all source files
	collectAllFunctions(ctx)

	// Phase 2: Track validated variables within each function
	// This must happen before call site analysis so we know which arguments are validated
	analyseValidatedVariables(ctx)

	// Phase 3: Determine which functions validate their returns
	// This must happen BEFORE call site analysis so we can mark args from validated functions
	analyseValidatedReturns(ctx)

	// Phase 3.5: Extend validated variables to include assignments from validated-return functions
	// This must happen after Phase 3 so we know which functions validate their returns
	extendValidatedVariablesFromCalls(ctx)

	// Phase 4: Analyse call sites within each function
	analyseCallSites(ctx)

	// Phase 5: Analyse parameter mutations
	analyseParameterMutations(ctx)

	// Phase 6: Analyse parameter escapes
	analyseParameterEscapes(ctx)

	// Phase 7: Propagate validation through the call graph
	propagateValidation(ctx)

	return ctx.ProjectAnalysis
}

// GetFunctionInfo returns the FunctionInfo for a function key, or nil if not found.
func (pa *ProjectAnalysis) GetFunctionInfo(key string) *FunctionInfo {
	return pa.CallGraph[key]
}

// IsExported returns whether a function is exported.
func (pa *ProjectAnalysis) IsExported(key string) bool {
	return pa.ExportedFunctions[key]
}

// ValidatesReturn returns whether a function validates its return value.
func (pa *ProjectAnalysis) ValidatesReturn(key string) bool {
	return pa.ValidatedReturns[key]
}

// collectAllFunctions walks all source files and collects function declarations.
func collectAllFunctions(ctx *AnalysisContext) {
	for _, sf := range ctx.Program.SourceFiles() {
		// Skip declaration files and node_modules
		fileName := sf.FileName()
		if isDeclarationFile(fileName) || isNodeModules(fileName) {
			continue
		}

		fileAnalysis := &FileAnalysis{
			FileName:        fileName,
			Functions:       make([]*FunctionInfo, 0),
			ExportedSymbols: make(map[string]bool),
		}

		// First pass: collect exported symbols
		collectExportedSymbols(sf, fileAnalysis)

		// Second pass: collect functions
		var visit ast.Visitor
		visit = func(node *ast.Node) bool {
			if node == nil {
				return false
			}
			if isFunctionLikeNode(node) {
				funcInfo := analyseFunctionNode(ctx, node, fileAnalysis)
				if funcInfo != nil {
					fileAnalysis.Functions = append(fileAnalysis.Functions, funcInfo)
					ctx.ProjectAnalysis.CallGraph[funcInfo.Key] = funcInfo
					if funcInfo.IsExported {
						ctx.ProjectAnalysis.ExportedFunctions[funcInfo.Key] = true
					}
				}
			}
			node.ForEachChild(visit)
			return false
		}
		sf.AsNode().ForEachChild(visit)

		ctx.ProjectAnalysis.Files[fileName] = fileAnalysis
	}
}

// isFunctionLikeNode returns true if the node is a function-like declaration.
func isFunctionLikeNode(node *ast.Node) bool {
	switch node.Kind {
	case ast.KindFunctionDeclaration,
		ast.KindFunctionExpression,
		ast.KindArrowFunction,
		ast.KindMethodDeclaration:
		return true
	}
	return false
}

// isDeclarationFile returns true if the file is a .d.ts file.
func isDeclarationFile(fileName string) bool {
	return len(fileName) > 5 && fileName[len(fileName)-5:] == ".d.ts"
}

// isNodeModules returns true if the file is in node_modules.
func isNodeModules(fileName string) bool {
	return strings.Contains(fileName, "/node_modules/") || strings.Contains(fileName, "\\node_modules\\")
}

// collectExportedSymbols finds all exported symbols in a source file.
func collectExportedSymbols(sf *ast.SourceFile, fileAnalysis *FileAnalysis) {
	var visit ast.Visitor
	visit = func(node *ast.Node) bool {
		if node == nil {
			return false
		}
		switch node.Kind {
		case ast.KindFunctionDeclaration:
			fd := node.AsFunctionDeclaration()
			if fd != nil && fd.Name() != nil {
				if hasExportModifier(node) {
					fileAnalysis.ExportedSymbols[fd.Name().Text()] = true
				}
			}
		case ast.KindVariableStatement:
			// Check if the variable statement has export modifier
			if hasExportModifier(node) {
				// Mark all declared variables as exported
				vs := node.AsVariableStatement()
				if vs != nil && vs.DeclarationList != nil {
					for _, decl := range vs.DeclarationList.AsVariableDeclarationList().Declarations.Nodes {
						if vd := decl.AsVariableDeclaration(); vd != nil && vd.Name() != nil && vd.Name().Kind == ast.KindIdentifier {
							if ident := vd.Name().AsIdentifier(); ident != nil {
								fileAnalysis.ExportedSymbols[ident.Text] = true
							}
						}
					}
				}
			}
		case ast.KindExportDeclaration:
			// Handle: export { foo, bar }
			ed := node.AsExportDeclaration()
			if ed != nil && ed.ExportClause != nil {
				if named := ed.ExportClause.AsNamedExports(); named != nil && named.Elements != nil {
					for _, elem := range named.Elements.Nodes {
						if spec := elem.AsExportSpecifier(); spec != nil {
							// Export the local name
							if spec.PropertyName != nil {
								fileAnalysis.ExportedSymbols[spec.PropertyName.Text()] = true
							} else if spec.Name() != nil {
								fileAnalysis.ExportedSymbols[spec.Name().Text()] = true
							}
						}
					}
				}
			}
		case ast.KindExportAssignment:
			// Handle: export default ...
			fileAnalysis.ExportedSymbols["default"] = true
		}
		node.ForEachChild(visit)
		return false
	}
	sf.AsNode().ForEachChild(visit)
}

// hasExportModifier checks if a node has the export modifier.
func hasExportModifier(node *ast.Node) bool {
	return ast.GetCombinedModifierFlags(node)&ast.ModifierFlagsExport != 0
}

// hasAsyncModifier checks if a modifier list contains async.
func hasAsyncModifierList(modifiers *ast.ModifierList) bool {
	if modifiers == nil {
		return false
	}
	for _, mod := range modifiers.Nodes {
		if mod.Kind == ast.KindAsyncKeyword {
			return true
		}
	}
	return false
}

// analyseFunctionNode extracts FunctionInfo from a function-like node.
func analyseFunctionNode(ctx *AnalysisContext, node *ast.Node, fileAnalysis *FileAnalysis) *FunctionInfo {
	var name string
	var isAsync bool
	var returnType *ast.Node
	var hasReturnAnnotation bool
	var params *ast.NodeList

	switch node.Kind {
	case ast.KindFunctionDeclaration:
		fd := node.AsFunctionDeclaration()
		if fd.Name() != nil {
			name = fd.Name().Text()
		}
		isAsync = hasAsyncModifierList(fd.Modifiers())
		returnType = fd.Type
		hasReturnAnnotation = fd.Type != nil
		params = fd.Parameters
	case ast.KindFunctionExpression:
		fe := node.AsFunctionExpression()
		if fe.Name() != nil {
			name = fe.Name().Text()
		}
		isAsync = hasAsyncModifierList(fe.Modifiers())
		returnType = fe.Type
		hasReturnAnnotation = fe.Type != nil
		params = fe.Parameters
	case ast.KindArrowFunction:
		af := node.AsArrowFunction()
		// Arrow functions don't have names, but might be assigned to a variable
		isAsync = hasAsyncModifierList(af.Modifiers())
		returnType = af.Type
		hasReturnAnnotation = af.Type != nil
		params = af.Parameters
	case ast.KindMethodDeclaration:
		md := node.AsMethodDeclaration()
		if md.Name() != nil {
			name = md.Name().Text()
		}
		isAsync = hasAsyncModifierList(md.Modifiers())
		returnType = md.Type
		hasReturnAnnotation = md.Type != nil
		params = md.Parameters
	default:
		return nil
	}

	// Generate a unique key for this function
	key := generateFunctionKey(fileAnalysis.FileName, name, node.Pos())

	// Check if exported
	isExported := false
	if name != "" {
		isExported = fileAnalysis.ExportedSymbols[name] || hasExportModifier(node)
	}

	// Get return type from checker
	var checkerReturnType *checker.Type
	if returnType != nil {
		checkerReturnType = checker.Checker_getTypeFromTypeNode(ctx.Checker, returnType)
	}

	// Get symbol for this function via its type
	var funcSymbol *ast.Symbol
	funcType := checker.Checker_GetTypeAtLocation(ctx.Checker, node)
	if funcType != nil {
		funcSymbol = checker.Type_symbol(funcType)
	}

	// Get body node and start position
	bodyNode := getFunctionBodyNode(node)
	if bodyNode == nil {
		// Ambient declaration (no body) - skip it
		// These are external/declared functions we don't track
		return nil
	}
	bodyStart := bodyNode.Pos()

	funcInfo := &FunctionInfo{
		Key:                     key,
		Symbol:                  funcSymbol,
		FileName:                fileAnalysis.FileName,
		Name:                    name,
		IsExported:              isExported,
		IsAsync:                 isAsync,
		Node:                    node,
		ReturnType:              checkerReturnType,
		HasReturnTypeAnnotation: hasReturnAnnotation,
		Parameters:              make([]*ParameterInfo, 0),
		CallSites:               make([]*CallSite, 0),
		ValidatedVariables:      make(map[string]*VariableValidation),
		BodyStart:               bodyStart,
		BodyNode:                bodyNode,
	}

	// Collect parameters
	if params != nil {
		for i, paramNode := range params.Nodes {
			if param := paramNode.AsParameterDeclaration(); param != nil {
				paramInfo := &ParameterInfo{
					Position: i,
				}
				if param.Name() != nil && param.Name().Kind == ast.KindIdentifier {
					if ident := param.Name().AsIdentifier(); ident != nil {
						paramInfo.Name = ident.Text
					}
				}
				if param.Type != nil {
					paramInfo.Type = checker.Checker_getTypeFromTypeNode(ctx.Checker, param.Type)
					paramInfo.IsPrimitive = isPrimitiveType(paramInfo.Type)
				}
				paramInfo.IsOptional = param.QuestionToken != nil
				funcInfo.Parameters = append(funcInfo.Parameters, paramInfo)
			}
		}
	}

	// Initialise boolean slices
	paramCount := len(funcInfo.Parameters)
	funcInfo.ValidatesParams = make([]bool, paramCount)
	funcInfo.MutatesParams = make([]bool, paramCount)
	funcInfo.EscapesParams = make([]bool, paramCount)
	funcInfo.CanSkipParamValidation = make([]bool, paramCount)

	// If config has ValidateParameters, mark all params as validated at entry
	if ctx.Config.ValidateParameters {
		for i := range funcInfo.ValidatesParams {
			funcInfo.ValidatesParams[i] = true
		}
	}

	return funcInfo
}

// generateFunctionKey creates a unique key for a function.
func generateFunctionKey(fileName, name string, pos int) string {
	if name != "" {
		return fmt.Sprintf("%s:%s", fileName, name)
	}
	return fmt.Sprintf("%s:anonymous@%d", fileName, pos)
}

// isPrimitiveType returns true if the type is a primitive type.
func isPrimitiveType(t *checker.Type) bool {
	if t == nil {
		return false
	}
	flags := checker.Type_flags(t)
	return flags&(checker.TypeFlagsString|checker.TypeFlagsNumber|checker.TypeFlagsBoolean|
		checker.TypeFlagsBigInt|checker.TypeFlagsESSymbol|checker.TypeFlagsNull|
		checker.TypeFlagsUndefined|checker.TypeFlagsVoid|
		checker.TypeFlagsStringLiteral|checker.TypeFlagsNumberLiteral|checker.TypeFlagsBooleanLiteral|
		checker.TypeFlagsBigIntLiteral) != 0
}

// analyseCallSites walks each function body to find call expressions and build the call graph.
func analyseCallSites(ctx *AnalysisContext) {
	for _, funcInfo := range ctx.ProjectAnalysis.CallGraph {
		bodyNode := getFunctionBodyNode(funcInfo.Node)
		if bodyNode == nil {
			continue
		}

		// Build a map of parameter names to indices for quick lookup
		paramIndices := make(map[string]int)
		for i, param := range funcInfo.Parameters {
			if param.Name != "" {
				paramIndices[param.Name] = i
			}
		}

		var visit ast.Visitor
		visit = func(node *ast.Node) bool {
			if node == nil {
				return false
			}
			if node.Kind == ast.KindCallExpression {
				callSite := analyseCallExpression(ctx, funcInfo, node.AsCallExpression(), paramIndices)
				if callSite != nil {
					funcInfo.CallSites = append(funcInfo.CallSites, callSite)
				}
			}
			node.ForEachChild(visit)
			return false
		}
		bodyNode.ForEachChild(visit)
	}
}

// getFunctionBodyNode returns the body node for a function-like node.
func getFunctionBodyNode(node *ast.Node) *ast.Node {
	switch node.Kind {
	case ast.KindFunctionDeclaration:
		if fd := node.AsFunctionDeclaration(); fd != nil {
			return fd.Body
		}
	case ast.KindFunctionExpression:
		if fe := node.AsFunctionExpression(); fe != nil {
			return fe.Body
		}
	case ast.KindArrowFunction:
		if af := node.AsArrowFunction(); af != nil {
			return af.Body
		}
	case ast.KindMethodDeclaration:
		if md := node.AsMethodDeclaration(); md != nil {
			return md.Body
		}
	}
	return nil
}

// analyseCallExpression extracts information about a call expression.
func analyseCallExpression(ctx *AnalysisContext, caller *FunctionInfo, call *ast.CallExpression, paramIndices map[string]int) *CallSite {
	if call == nil {
		return nil
	}

	// Try to resolve the callee
	calleeType := checker.Checker_GetTypeAtLocation(ctx.Checker, call.Expression)

	callSite := &CallSite{
		Position:   call.Pos(),
		Arguments:  make([]*ArgumentInfo, 0),
		IsExternal: true, // Assume external until proven otherwise
	}

	// Try to find the callee in our call graph
	if calleeType != nil {
		calleeSym := checker.Type_symbol(calleeType)
		if calleeSym != nil {
			// Check if this symbol is in our project
			for _, decl := range calleeSym.Declarations {
				sf := ast.GetSourceFileOfNode(decl)
				if sf != nil {
					declFileName := sf.FileName()
					if !isNodeModules(declFileName) && !isDeclarationFile(declFileName) {
						// This is an internal function
						callSite.IsExternal = false
						callSite.CalleeSymbol = calleeSym

						// Try to find the function key
						funcName := ""
						if calleeSym.Name != "" {
							funcName = calleeSym.Name
						}
						possibleKey := generateFunctionKey(declFileName, funcName, decl.Pos())
						if _, exists := ctx.ProjectAnalysis.CallGraph[possibleKey]; exists {
							callSite.CalleeFuncKey = possibleKey
						} else if funcName != "" {
							// Try simpler key format
							simpleKey := fmt.Sprintf("%s:%s", declFileName, funcName)
							if _, exists := ctx.ProjectAnalysis.CallGraph[simpleKey]; exists {
								callSite.CalleeFuncKey = simpleKey
							}
						}
						break
					}
				}
			}
		}

		// Check if callee is async
		sigs := checker.Checker_getSignaturesOfType(ctx.Checker, calleeType, checker.SignatureKindCall)
		if len(sigs) > 0 {
			retType := checker.Checker_getReturnTypeOfSignature(ctx.Checker, sigs[0])
			if retType != nil {
				// Check if return type is Promise-like
				sym := checker.Type_symbol(retType)
				if sym != nil && sym.Name == "Promise" {
					callSite.IsAsync = true
				}
			}
		}
	}

	// Analyse arguments
	if call.Arguments != nil {
		for i, argNode := range call.Arguments.Nodes {
			argInfo := &ArgumentInfo{
				ParamIndex: i,
				Type:       checker.Checker_GetTypeAtLocation(ctx.Checker, argNode),
			}

			// Check if argument is a variable reference
			rootVar := getRootIdentifierName(argNode)
			if rootVar != "" {
				argInfo.RootVariable = rootVar
				// Check if this is one of our parameters
				if _, isParam := paramIndices[rootVar]; isParam {
					// Argument references a parameter - track escape
					if callSite.IsExternal {
						argInfo.EscapeKind = EscapeExternal
					} else {
						argInfo.EscapeKind = EscapeInternal
					}
				}

				// Check if this argument references a validated variable
				if validation, ok := caller.ValidatedVariables[rootVar]; ok {
					// Check if the variable has been dirtied between validation and this call
					if !isVariableDirty(ctx, caller, rootVar, validation.Position, call.Pos()) {
						argInfo.IsValidated = true
						argInfo.ValidationPath = append(argInfo.ValidationPath, validation.Source)
					}
				}
			} else if argNode.Kind == ast.KindCallExpression {
				// Argument is a call expression - check if callee validates its return
				argCallExpr := argNode.AsCallExpression()
				if argCallExpr != nil {
					argCalleeFuncKey := resolveCalleeKey(ctx, argCallExpr)
					if argCalleeFuncKey != "" {
						argCalleeFunc := ctx.ProjectAnalysis.CallGraph[argCalleeFuncKey]
						if argCalleeFunc != nil && argCalleeFunc.ValidatesReturn {
							argInfo.IsValidated = true
							argInfo.ValidationPath = append(argInfo.ValidationPath, "trusted-return")
						}
					}
				}
			}

			callSite.Arguments = append(callSite.Arguments, argInfo)
		}
	}

	// Check if this call is assigned to a variable
	parent := call.Parent
	if parent != nil && parent.Kind == ast.KindVariableDeclaration {
		if vd := parent.AsVariableDeclaration(); vd != nil && vd.Name() != nil {
			// Only handle simple identifier assignments, not destructuring patterns
			if vd.Name().Kind == ast.KindIdentifier {
				if ident := vd.Name().AsIdentifier(); ident != nil {
					callSite.AssignedTo = ident.Text
				}
			}
		}
	}

	return callSite
}

// resolveCalleeKey attempts to resolve a call expression to a function key in the call graph.
func resolveCalleeKey(ctx *AnalysisContext, call *ast.CallExpression) string {
	if call == nil {
		return ""
	}

	calleeType := checker.Checker_GetTypeAtLocation(ctx.Checker, call.Expression)
	if calleeType == nil {
		return ""
	}

	calleeSym := checker.Type_symbol(calleeType)
	if calleeSym == nil {
		return ""
	}

	for _, decl := range calleeSym.Declarations {
		sf := ast.GetSourceFileOfNode(decl)
		if sf == nil {
			continue
		}
		declFileName := sf.FileName()
		if isNodeModules(declFileName) || isDeclarationFile(declFileName) {
			continue
		}

		// This is an internal function - find its key
		funcName := ""
		if calleeSym.Name != "" {
			funcName = calleeSym.Name
		}
		possibleKey := generateFunctionKey(declFileName, funcName, decl.Pos())
		if _, exists := ctx.ProjectAnalysis.CallGraph[possibleKey]; exists {
			return possibleKey
		}
		if funcName != "" {
			simpleKey := fmt.Sprintf("%s:%s", declFileName, funcName)
			if _, exists := ctx.ProjectAnalysis.CallGraph[simpleKey]; exists {
				return simpleKey
			}
		}
	}
	return ""
}

// getRootIdentifierName extracts the root identifier name from an expression.
func getRootIdentifierName(node *ast.Node) string {
	if node == nil {
		return ""
	}
	switch node.Kind {
	case ast.KindIdentifier:
		return node.AsIdentifier().Text
	case ast.KindPropertyAccessExpression:
		pae := node.AsPropertyAccessExpression()
		if pae != nil {
			return getRootIdentifierName(pae.Expression)
		}
	case ast.KindElementAccessExpression:
		eae := node.AsElementAccessExpression()
		if eae != nil {
			return getRootIdentifierName(eae.Expression)
		}
	}
	return ""
}

// analyseParameterMutations checks which parameters might be mutated in each function.
func analyseParameterMutations(ctx *AnalysisContext) {
	for _, funcInfo := range ctx.ProjectAnalysis.CallGraph {
		bodyNode := getFunctionBodyNode(funcInfo.Node)
		if bodyNode == nil {
			continue
		}

		// Build parameter name to index map
		paramIndices := make(map[string]int)
		for i, param := range funcInfo.Parameters {
			if param.Name != "" {
				paramIndices[param.Name] = i
			}
		}

		var visit ast.Visitor
		visit = func(node *ast.Node) bool {
			if node == nil {
				return false
			}
			switch node.Kind {
			case ast.KindBinaryExpression:
				bin := node.AsBinaryExpression()
				if bin != nil && isAssignmentOperator(bin.OperatorToken.Kind) {
					// Check if LHS involves a parameter
					rootVar := getRootIdentifierName(bin.Left)
					if idx, ok := paramIndices[rootVar]; ok {
						// Skip if parameter is primitive and we're assigning to it directly
						if funcInfo.Parameters[idx].IsPrimitive && isDirectIdentifier(bin.Left, rootVar) {
							// Direct assignment to primitive param - doesn't affect caller
						} else {
							funcInfo.MutatesParams[idx] = true
						}
					}
				}

			case ast.KindPrefixUnaryExpression:
				prefix := node.AsPrefixUnaryExpression()
				if prefix != nil && (prefix.Operator == ast.KindPlusPlusToken || prefix.Operator == ast.KindMinusMinusToken) {
					rootVar := getRootIdentifierName(prefix.Operand)
					if idx, ok := paramIndices[rootVar]; ok {
						funcInfo.MutatesParams[idx] = true
					}
				}

			case ast.KindPostfixUnaryExpression:
				postfix := node.AsPostfixUnaryExpression()
				if postfix != nil && (postfix.Operator == ast.KindPlusPlusToken || postfix.Operator == ast.KindMinusMinusToken) {
					rootVar := getRootIdentifierName(postfix.Operand)
					if idx, ok := paramIndices[rootVar]; ok {
						funcInfo.MutatesParams[idx] = true
					}
				}

			case ast.KindCallExpression:
				// If parameter is passed to a non-pure function, conservatively mark as mutated
				call := node.AsCallExpression()
				if call != nil && call.Arguments != nil {
					for _, arg := range call.Arguments.Nodes {
						rootVar := getRootIdentifierName(arg)
						if idx, ok := paramIndices[rootVar]; ok {
							// Skip primitives - they can't be mutated by reference
							if !funcInfo.Parameters[idx].IsPrimitive {
								// Check if this is a known pure function
								if !isPureCall(ctx, call) {
									funcInfo.MutatesParams[idx] = true
								}
							}
						}
					}
				}
			}

			node.ForEachChild(visit)
			return false
		}
		bodyNode.ForEachChild(visit)
	}
}

// isAssignmentOperator returns true if the token is an assignment operator.
func isAssignmentOperator(kind ast.Kind) bool {
	switch kind {
	case ast.KindEqualsToken,
		ast.KindPlusEqualsToken,
		ast.KindMinusEqualsToken,
		ast.KindAsteriskEqualsToken,
		ast.KindSlashEqualsToken,
		ast.KindPercentEqualsToken,
		ast.KindAmpersandEqualsToken,
		ast.KindBarEqualsToken,
		ast.KindCaretEqualsToken:
		return true
	}
	return false
}

// isDirectIdentifier returns true if the node is exactly the given identifier (not a property access).
func isDirectIdentifier(node *ast.Node, name string) bool {
	if node.Kind == ast.KindIdentifier {
		return node.AsIdentifier().Text == name
	}
	return false
}

// isPureCall checks if a call is to a known pure function.
func isPureCall(ctx *AnalysisContext, call *ast.CallExpression) bool {
	funcName := getCallExpressionName(call)
	if funcName == "" {
		return false
	}
	// Check against configured pure functions
	for _, re := range ctx.Config.PureFunctions {
		if re.MatchString(funcName) {
			return true
		}
	}
	return false
}

// getCallExpressionName gets the name of the called function.
func getCallExpressionName(call *ast.CallExpression) string {
	if call == nil || call.Expression == nil {
		return ""
	}
	switch call.Expression.Kind {
	case ast.KindIdentifier:
		return call.Expression.AsIdentifier().Text
	case ast.KindPropertyAccessExpression:
		pae := call.Expression.AsPropertyAccessExpression()
		if pae != nil {
			objName := ""
			if pae.Expression.Kind == ast.KindIdentifier {
				objName = pae.Expression.AsIdentifier().Text
			}
			propName := ""
			if pae.Name() != nil {
				propName = pae.Name().Text()
			}
			if objName != "" && propName != "" {
				return objName + "." + propName
			}
			return propName
		}
	}
	return ""
}

// analyseParameterEscapes checks which parameters escape to external code.
func analyseParameterEscapes(ctx *AnalysisContext) {
	for _, funcInfo := range ctx.ProjectAnalysis.CallGraph {
		// Build parameter name to index map
		paramIndices := make(map[string]int)
		for i, param := range funcInfo.Parameters {
			if param.Name != "" {
				paramIndices[param.Name] = i
			}
		}

		// Check call sites for parameter escapes
		for _, callSite := range funcInfo.CallSites {
			if callSite.IsExternal {
				// Any parameter passed to external call escapes
				for _, arg := range callSite.Arguments {
					if arg.RootVariable != "" {
						if idx, ok := paramIndices[arg.RootVariable]; ok {
							if !funcInfo.Parameters[idx].IsPrimitive {
								funcInfo.EscapesParams[idx] = true
							}
						}
					}
				}
			} else if callSite.CalleeFuncKey != "" {
				// Check if callee escapes the parameter
				callee := ctx.ProjectAnalysis.CallGraph[callSite.CalleeFuncKey]
				if callee != nil {
					for _, arg := range callSite.Arguments {
						if arg.RootVariable != "" {
							if idx, ok := paramIndices[arg.RootVariable]; ok {
								// If callee escapes this param position, we escape too
								if arg.ParamIndex < len(callee.EscapesParams) && callee.EscapesParams[arg.ParamIndex] {
									funcInfo.EscapesParams[idx] = true
								}
							}
						}
					}
				}
			}
		}

		// TODO: Also check for storage in fields, globals, closures
	}
}

// analyseValidatedVariables tracks which variables are validated within each function.
// This is used to determine if arguments at call sites are already validated.
func analyseValidatedVariables(ctx *AnalysisContext) {
	for _, funcInfo := range ctx.ProjectAnalysis.CallGraph {
		if funcInfo.BodyNode == nil {
			continue
		}

		// Mark parameters as validated at function entry (position 0 = start of body)
		if ctx.Config.ValidateParameters {
			for _, param := range funcInfo.Parameters {
				if param.Name != "" && param.Type != nil && !shouldSkipType(param.Type) {
					funcInfo.ValidatedVariables[param.Name] = &VariableValidation{
						Position: funcInfo.BodyStart,
						Type:     param.Type,
						Source:   "parameter",
					}
				}
			}
		}

		// Walk the function body to find other validation points
		var visit ast.Visitor
		visit = func(node *ast.Node) bool {
			if node == nil {
				return false
			}

			switch node.Kind {
			case ast.KindVariableDeclaration:
				varDecl := node.AsVariableDeclaration()
				if varDecl == nil || varDecl.Initializer == nil {
					break
				}

				// Get variable name
				var varName string
				if varDecl.Name() != nil && varDecl.Name().Kind == ast.KindIdentifier {
					varName = varDecl.Name().AsIdentifier().Text
				}
				if varName == "" {
					break
				}

				// Check for cast: const x = expr as T
				if varDecl.Initializer.Kind == ast.KindAsExpression {
					asExpr := varDecl.Initializer.AsAsExpression()
					if asExpr != nil && asExpr.Type != nil {
						castType := checker.Checker_getTypeFromTypeNode(ctx.Checker, asExpr.Type)
						if castType != nil && !shouldSkipType(castType) {
							funcInfo.ValidatedVariables[varName] = &VariableValidation{
								Position: node.Pos(),
								Type:     castType,
								Source:   "cast",
							}
						}
					}
					break
				}

				// Check for JSON.parse: const x: T = JSON.parse(...) or const x = JSON.parse<T>(...)
				if varDecl.Initializer.Kind == ast.KindCallExpression {
					callExpr := varDecl.Initializer.AsCallExpression()
					if callExpr != nil && isJSONParseCall(callExpr) {
						var targetType *checker.Type

						// Check explicit type annotation on variable
						if varDecl.Type != nil {
							targetType = checker.Checker_getTypeFromTypeNode(ctx.Checker, varDecl.Type)
						}

						// Check type argument on call: JSON.parse<T>(...)
						if targetType == nil && callExpr.TypeArguments != nil && len(callExpr.TypeArguments.Nodes) > 0 {
							targetType = checker.Checker_getTypeFromTypeNode(ctx.Checker, callExpr.TypeArguments.Nodes[0])
						}

						if targetType != nil && !shouldSkipType(targetType) {
							funcInfo.ValidatedVariables[varName] = &VariableValidation{
								Position: node.Pos(),
								Type:     targetType,
								Source:   "json-parse",
							}
						}
						break
					}

					// Check for trusted function call
					if len(ctx.Config.TrustedFunctions) > 0 {
						funcName := getCallExpressionName(callExpr)
						for _, re := range ctx.Config.TrustedFunctions {
							if re.MatchString(funcName) {
								// Get variable type
								var targetType *checker.Type
								if varDecl.Type != nil {
									targetType = checker.Checker_getTypeFromTypeNode(ctx.Checker, varDecl.Type)
								} else {
									targetType = checker.Checker_GetTypeAtLocation(ctx.Checker, varDecl.Name())
								}
								if targetType != nil && !shouldSkipType(targetType) {
									funcInfo.ValidatedVariables[varName] = &VariableValidation{
										Position: node.Pos(),
										Type:     targetType,
										Source:   "trusted-call",
									}
								}
								break
							}
						}
					}
				}
			}

			node.ForEachChild(visit)
			return false
		}
		funcInfo.BodyNode.ForEachChild(visit)
	}
}

// extendValidatedVariablesFromCalls marks variables as validated when they're assigned
// from calls to functions that validate their return values.
// This runs after analyseValidatedReturns so we know which functions validate returns.
func extendValidatedVariablesFromCalls(ctx *AnalysisContext) {
	for _, funcInfo := range ctx.ProjectAnalysis.CallGraph {
		if funcInfo.BodyNode == nil {
			continue
		}

		var visit ast.Visitor
		visit = func(node *ast.Node) bool {
			if node == nil {
				return false
			}

			switch node.Kind {
			case ast.KindVariableDeclaration:
				varDecl := node.AsVariableDeclaration()
				if varDecl == nil || varDecl.Initializer == nil {
					node.ForEachChild(visit)
					return false
				}

				// Get variable name
				var varName string
				if varDecl.Name() != nil && varDecl.Name().Kind == ast.KindIdentifier {
					varName = varDecl.Name().AsIdentifier().Text
				}
				if varName == "" {
					node.ForEachChild(visit)
					return false
				}

				// Skip if already marked as validated
				if _, exists := funcInfo.ValidatedVariables[varName]; exists {
					node.ForEachChild(visit)
					return false
				}

				// Check if initialiser is a call to a function that validates its return
				if varDecl.Initializer.Kind == ast.KindCallExpression {
					callExpr := varDecl.Initializer.AsCallExpression()
					if callExpr != nil {
						calleeKey := resolveCalleeKey(ctx, callExpr)
						calleeValidatesReturn := false
						if calleeKey != "" {
							calleeFunc := ctx.ProjectAnalysis.CallGraph[calleeKey]
							if calleeFunc != nil && calleeFunc.ValidatesReturn {
								calleeValidatesReturn = true
								// Get variable type
								var targetType *checker.Type
								if varDecl.Type != nil {
									targetType = checker.Checker_getTypeFromTypeNode(ctx.Checker, varDecl.Type)
								} else {
									targetType = checker.Checker_GetTypeAtLocation(ctx.Checker, varDecl.Name())
								}
								if targetType != nil && !shouldSkipType(targetType) {
									funcInfo.ValidatedVariables[varName] = &VariableValidation{
										Position: node.Pos(),
										Type:     targetType,
										Source:   "validated-return",
									}
								}
							}
						}

						// If function doesn't validate its return, the result needs validation
						if !calleeValidatesReturn {
							// Skip JSON.parse - handled separately
							if isJSONParseCall(callExpr) {
								node.ForEachChild(visit)
								return false
							}

							// Get the return type
							var targetType *checker.Type
							var typeNode *ast.Node
							if varDecl.Type != nil {
								targetType = checker.Checker_getTypeFromTypeNode(ctx.Checker, varDecl.Type)
								typeNode = varDecl.Type
							} else {
								targetType = checker.Checker_GetTypeAtLocation(ctx.Checker, varDecl.Name())
							}

							// Skip primitive types and types we don't validate
							if targetType != nil && !shouldSkipType(targetType) && !isPrimitiveType(targetType) {
								// Only validate if the variable is actually used after assignment
								// If it's never read, no need to validate the returned value
								if isVariableUsedAfter(funcInfo, varName, node.End()) {
									ctx.ProjectAnalysis.UnvalidatedCallResults[varDecl.Initializer.Pos()] = &UnvalidatedCallResult{
										CallPos:  varDecl.Initializer.Pos(),
										CallEnd:  varDecl.Initializer.End(),
										Type:     targetType,
										TypeNode: typeNode,
										VarName:  varName,
									}
									debugf("[DEBUG] UnvalidatedCallResult: var=%s callPos=%d type=%v\n", varName, varDecl.Initializer.Pos(), targetType)

									// Mark variable as validated (since we'll wrap the call)
									funcInfo.ValidatedVariables[varName] = &VariableValidation{
										Position: node.Pos(),
										Type:     targetType,
										Source:   "wrapped-call",
									}
								} else {
									debugf("[DEBUG] Skipping UnvalidatedCallResult: var=%s not used after assignment\n", varName)
								}
							}
						}
					}
				}

			case ast.KindBinaryExpression:
				// Handle reassignments: user4 = step3(user3)
				bin := node.AsBinaryExpression()
				if bin == nil || !isAssignmentOperator(bin.OperatorToken.Kind) {
					node.ForEachChild(visit)
					return false
				}

				// Get variable name from LHS
				var varName string
				if bin.Left.Kind == ast.KindIdentifier {
					varName = bin.Left.AsIdentifier().Text
				}
				if varName == "" {
					node.ForEachChild(visit)
					return false
				}

				// Check if RHS is a call to a function that doesn't validate its return
				if bin.Right.Kind == ast.KindCallExpression {
					callExpr := bin.Right.AsCallExpression()
					if callExpr != nil {
						// Skip JSON.parse - handled separately
						if isJSONParseCall(callExpr) {
							node.ForEachChild(visit)
							return false
						}

						calleeKey := resolveCalleeKey(ctx, callExpr)
						calleeValidatesReturn := false
						if calleeKey != "" {
							calleeFunc := ctx.ProjectAnalysis.CallGraph[calleeKey]
							if calleeFunc != nil && calleeFunc.ValidatesReturn {
								calleeValidatesReturn = true
							}
						}

						// If function doesn't validate its return, the result needs validation
						if !calleeValidatesReturn {
							// Get the type from the variable
							targetType := checker.Checker_GetTypeAtLocation(ctx.Checker, bin.Left)

							// Skip primitive types and types we don't validate
							if targetType != nil && !shouldSkipType(targetType) && !isPrimitiveType(targetType) {
								// Only validate if the variable is actually used after assignment
								if isVariableUsedAfter(funcInfo, varName, node.End()) {
									ctx.ProjectAnalysis.UnvalidatedCallResults[bin.Right.Pos()] = &UnvalidatedCallResult{
										CallPos:  bin.Right.Pos(),
										CallEnd:  bin.Right.End(),
										Type:     targetType,
										TypeNode: nil, // No explicit type node for reassignment
										VarName:  varName,
									}
									debugf("[DEBUG] UnvalidatedCallResult (reassign): var=%s callPos=%d type=%v\n", varName, bin.Right.Pos(), targetType)
								} else {
									debugf("[DEBUG] Skipping UnvalidatedCallResult (reassign): var=%s not used after assignment\n", varName)
								}
							}
						}
					}
				}
			}

			node.ForEachChild(visit)
			return false
		}
		funcInfo.BodyNode.ForEachChild(visit)
	}
}

// isJSONParseCall checks if a call expression is JSON.parse
func isJSONParseCall(call *ast.CallExpression) bool {
	if call.Expression.Kind != ast.KindPropertyAccessExpression {
		return false
	}
	propAccess := call.Expression.AsPropertyAccessExpression()
	if propAccess == nil || propAccess.Expression.Kind != ast.KindIdentifier {
		return false
	}
	if propAccess.Expression.AsIdentifier().Text != "JSON" {
		return false
	}
	nameNode := propAccess.Name()
	return nameNode != nil && nameNode.Text() == "parse"
}

// shouldSkipType checks if a type should be skipped for validation.
func shouldSkipType(t *checker.Type) bool {
	if t == nil {
		return true
	}
	flags := checker.Type_flags(t)
	return flags&checker.TypeFlagsAny != 0 ||
		flags&checker.TypeFlagsUnknown != 0 ||
		flags&checker.TypeFlagsNever != 0 ||
		flags&checker.TypeFlagsVoid != 0 ||
		flags&checker.TypeFlagsTypeParameter != 0 ||
		flags&checker.TypeFlagsConditional != 0 ||
		flags&checker.TypeFlagsIndexedAccess != 0 ||
		flags&checker.TypeFlagsSubstitution != 0 ||
		flags&checker.TypeFlagsIndex != 0
}

// isVariableDirty checks if a variable has been modified between two positions.
// This is used to determine if a validated variable is still valid at a call site.
func isVariableDirty(ctx *AnalysisContext, funcInfo *FunctionInfo, varName string, fromPos, toPos int) bool {
	if funcInfo.BodyNode == nil {
		return false
	}

	// Get the validated type to check if it's primitive
	var validatedType *checker.Type
	if validation, ok := funcInfo.ValidatedVariables[varName]; ok {
		validatedType = validation.Type
	}
	varIsPrimitive := isPrimitiveType(validatedType)

	dirty := false

	var checkDirty func(n *ast.Node) bool
	checkDirty = func(n *ast.Node) bool {
		if dirty {
			return false
		}

		pos := n.Pos()
		// Only check nodes between fromPos and toPos
		if pos < fromPos || pos >= toPos {
			n.ForEachChild(checkDirty)
			return false
		}

		switch n.Kind {
		case ast.KindBinaryExpression:
			bin := n.AsBinaryExpression()
			if bin != nil {
				opKind := bin.OperatorToken.Kind
				if isAssignmentOperator(opKind) {
					// Direct variable reassignment always dirties
					if isIdentifierNamed(bin.Left, varName) {
						dirty = true
						return false
					}

					// For property assignment (x.prop = ...), mark as dirty for non-primitives
					if !varIsPrimitive && getRootIdentifierName(bin.Left) == varName {
						dirty = true
						return false
					}
				}
			}

		case ast.KindCallExpression:
			if varIsPrimitive {
				break
			}
			call := n.AsCallExpression()
			if call != nil && call.Arguments != nil {
				// Check if varName is passed as an argument to a non-pure function
				isPure := false
				funcName := getCallExpressionName(call)
				if funcName != "" && len(ctx.Config.PureFunctions) > 0 {
					for _, re := range ctx.Config.PureFunctions {
						if re.MatchString(funcName) {
							isPure = true
							break
						}
					}
				}

				if !isPure {
					for _, arg := range call.Arguments.Nodes {
						root := getRootIdentifierName(arg)
						if root == varName {
							// Variable passed to a non-pure function - conservatively mark as dirty
							debugf("[DEBUG] isVariableDirtyExported: %s passed to call at pos=%d (toPos=%d)\n", varName, n.Pos(), toPos)
							dirty = true
							return false
						}
					}
				}
			}

		case ast.KindPrefixUnaryExpression:
			prefix := n.AsPrefixUnaryExpression()
			if prefix != nil {
				if prefix.Operator == ast.KindPlusPlusToken || prefix.Operator == ast.KindMinusMinusToken {
					if isIdentifierNamed(prefix.Operand, varName) {
						dirty = true
						return false
					}
				}
			}

		case ast.KindPostfixUnaryExpression:
			postfix := n.AsPostfixUnaryExpression()
			if postfix != nil {
				if postfix.Operator == ast.KindPlusPlusToken || postfix.Operator == ast.KindMinusMinusToken {
					if isIdentifierNamed(postfix.Operand, varName) {
						dirty = true
						return false
					}
				}
			}
		}

		n.ForEachChild(checkDirty)
		return false
	}

	funcInfo.BodyNode.ForEachChild(checkDirty)
	return dirty
}

// isIdentifierNamed checks if a node is an identifier with the given name.
func isIdentifierNamed(node *ast.Node, name string) bool {
	if node == nil || node.Kind != ast.KindIdentifier {
		return false
	}
	return node.AsIdentifier().Text == name
}

// IsVariableValidAtPosition checks if a variable is validated and still valid at a given position.
// This is exported for use by the transform package.
func IsVariableValidAtPosition(pa *ProjectAnalysis, funcKey string, varName string, atPosition int, config Config) bool {
	if pa == nil {
		return false
	}

	funcInfo := pa.GetFunctionInfo(funcKey)
	if funcInfo == nil {
		return false
	}

	validation, exists := funcInfo.ValidatedVariables[varName]
	if !exists {
		return false
	}

	// Check if the variable was dirtied between validation and the given position
	return !isVariableDirtyExported(funcInfo, varName, validation.Position, atPosition, config)
}

// isVariableDirtyExported checks if a variable was dirtied between two positions.
// This version doesn't need AnalysisContext - it uses the config directly.
func isVariableDirtyExported(funcInfo *FunctionInfo, varName string, fromPos, toPos int, config Config) bool {
	if funcInfo.BodyNode == nil {
		return false
	}

	// Get the validated type to check if it's primitive
	var validatedType *checker.Type
	if validation, ok := funcInfo.ValidatedVariables[varName]; ok {
		validatedType = validation.Type
	}
	varIsPrimitive := isPrimitiveType(validatedType)

	dirty := false

	var checkDirtyExported func(n *ast.Node) bool
	checkDirtyExported = func(n *ast.Node) bool {
		if dirty {
			return false
		}

		pos := n.Pos()
		// Only check nodes between fromPos and toPos
		if pos < fromPos || pos >= toPos {
			n.ForEachChild(checkDirtyExported)
			return false
		}

		switch n.Kind {
		case ast.KindBinaryExpression:
			bin := n.AsBinaryExpression()
			if bin != nil {
				opKind := bin.OperatorToken.Kind
				if isAssignmentOperator(opKind) {
					// Direct variable reassignment always dirties
					if isIdentifierNamed(bin.Left, varName) {
						dirty = true
						return false
					}

					// For property assignment (x.prop = ...), mark as dirty for non-primitives
					if !varIsPrimitive && getRootIdentifierName(bin.Left) == varName {
						dirty = true
						return false
					}
				}
			}

		case ast.KindCallExpression:
			if varIsPrimitive {
				break
			}
			call := n.AsCallExpression()
			if call != nil && call.Arguments != nil {
				// Check if varName is passed as an argument to a non-pure function
				isPure := false
				funcName := getCallExpressionName(call)
				if funcName != "" && len(config.PureFunctions) > 0 {
					for _, re := range config.PureFunctions {
						if re.MatchString(funcName) {
							isPure = true
							break
						}
					}
				}

				if !isPure {
					for _, arg := range call.Arguments.Nodes {
						root := getRootIdentifierName(arg)
						if root == varName {
							// Skip if this is the exact argument position we're checking for
							// (we don't want to count the call we're validating for)
							if arg.Pos() == toPos {
								continue
							}
							// Variable passed to a non-pure function - conservatively mark as dirty
							dirty = true
							return false
						}
					}
				}
			}

		case ast.KindPrefixUnaryExpression:
			prefix := n.AsPrefixUnaryExpression()
			if prefix != nil {
				if prefix.Operator == ast.KindPlusPlusToken || prefix.Operator == ast.KindMinusMinusToken {
					if isIdentifierNamed(prefix.Operand, varName) {
						dirty = true
						return false
					}
				}
			}

		case ast.KindPostfixUnaryExpression:
			postfix := n.AsPostfixUnaryExpression()
			if postfix != nil {
				if postfix.Operator == ast.KindPlusPlusToken || postfix.Operator == ast.KindMinusMinusToken {
					if isIdentifierNamed(postfix.Operand, varName) {
						dirty = true
						return false
					}
				}
			}
		}

		n.ForEachChild(checkDirtyExported)
		return false
	}

	funcInfo.BodyNode.ForEachChild(checkDirtyExported)
	return dirty
}

// isVariableUsedAfter checks if a variable is read/accessed after a given position.
// This is used to determine if we need to validate a call result - only if the result is used.
func isVariableUsedAfter(funcInfo *FunctionInfo, varName string, afterPos int) bool {
	if funcInfo.BodyNode == nil {
		return false
	}

	used := false

	var checkUsed func(n *ast.Node) bool
	checkUsed = func(n *ast.Node) bool {
		if used {
			return false
		}

		pos := n.Pos()
		// Only check nodes after afterPos
		if pos <= afterPos {
			n.ForEachChild(checkUsed)
			return false
		}

		switch n.Kind {
		case ast.KindIdentifier:
			ident := n.AsIdentifier()
			if ident != nil && ident.Text == varName {
				// Check if this is a read context (not the left side of an assignment)
				parent := n.Parent
				if parent != nil && parent.Kind == ast.KindBinaryExpression {
					bin := parent.AsBinaryExpression()
					if bin != nil && isAssignmentOperator(bin.OperatorToken.Kind) {
						// Check if this identifier is the left side of assignment
						if bin.Left == n {
							// This is a write, not a read
							break
						}
					}
				}
				// This is a read of the variable
				used = true
				return false
			}

		case ast.KindPropertyAccessExpression:
			// Check if accessing a property of the variable (e.g., user4.name)
			propAccess := n.AsPropertyAccessExpression()
			if propAccess != nil && propAccess.Expression.Kind == ast.KindIdentifier {
				ident := propAccess.Expression.AsIdentifier()
				if ident != nil && ident.Text == varName {
					used = true
					return false
				}
			}

		case ast.KindElementAccessExpression:
			// Check if accessing an element of the variable (e.g., user4[0])
			elemAccess := n.AsElementAccessExpression()
			if elemAccess != nil && elemAccess.Expression.Kind == ast.KindIdentifier {
				ident := elemAccess.Expression.AsIdentifier()
				if ident != nil && ident.Text == varName {
					used = true
					return false
				}
			}
		}

		n.ForEachChild(checkUsed)
		return false
	}

	funcInfo.BodyNode.ForEachChild(checkUsed)
	return used
}

// analyseValidatedReturns determines which functions validate their return values.
func analyseValidatedReturns(ctx *AnalysisContext) {
	for _, funcInfo := range ctx.ProjectAnalysis.CallGraph {
		// A function validates its return if:
		// 1. It has a return type annotation
		// 2. ValidateReturns is enabled in config
		if funcInfo.HasReturnTypeAnnotation && ctx.Config.ValidateReturns {
			funcInfo.ValidatesReturn = true
			ctx.ProjectAnalysis.ValidatedReturns[funcInfo.Key] = true
		}
	}
}

// propagateValidation performs fixed-point iteration to propagate validation info through the call graph.
func propagateValidation(ctx *AnalysisContext) {
	// Iterate until no changes
	changed := true
	iterations := 0
	maxIterations := 100

	for changed && iterations < maxIterations {
		changed = false
		iterations++

		for _, funcInfo := range ctx.ProjectAnalysis.CallGraph {
			// Skip exported functions - they can't skip param validation
			if funcInfo.IsExported {
				continue
			}

			// For each parameter, check if all callers pre-validate it
			for paramIdx := range funcInfo.Parameters {
				if funcInfo.CanSkipParamValidation[paramIdx] {
					continue // Already determined can skip
				}

				// Find all call sites to this function
				allCallersValidate := true
				callerCount := 0

				for _, otherFunc := range ctx.ProjectAnalysis.CallGraph {
					for _, callSite := range otherFunc.CallSites {
						if callSite.CalleeFuncKey == funcInfo.Key {
							callerCount++
							// Check if the argument at this position is validated
							if paramIdx < len(callSite.Arguments) {
								arg := callSite.Arguments[paramIdx]
								if !arg.IsValidated {
									allCallersValidate = false
									break
								}
							} else {
								// Optional param not provided - treated as validated
							}
						}
					}
					if !allCallersValidate {
						break
					}
				}

				// If all callers validate this param, we can skip validation
				if callerCount > 0 && allCallersValidate {
					funcInfo.CanSkipParamValidation[paramIdx] = true
					changed = true
				}
			}
		}
	}
}
