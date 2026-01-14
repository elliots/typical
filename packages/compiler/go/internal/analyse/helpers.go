// Package analyse provides helpers shared across analysis and transformation.
package analyse

import (
	"github.com/microsoft/typescript-go/shim/ast"
	"github.com/microsoft/typescript-go/shim/checker"
)

// ShouldSkipType checks if a type should be skipped for validation.
func ShouldSkipType(t *checker.Type) bool {
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

// IsPrimitiveType returns true if the type is a primitive type.
func IsPrimitiveType(t *checker.Type) bool {
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

// GetRootIdentifierName extracts the root identifier name from an expression.
// For example: user.name.first -> "user", arr[0] -> "arr"
func GetRootIdentifierName(node *ast.Node) string {
	if node == nil {
		return ""
	}
	switch node.Kind {
	case ast.KindIdentifier:
		return node.AsIdentifier().Text
	case ast.KindPropertyAccessExpression:
		pae := node.AsPropertyAccessExpression()
		if pae != nil {
			return GetRootIdentifierName(pae.Expression)
		}
	case ast.KindElementAccessExpression:
		eae := node.AsElementAccessExpression()
		if eae != nil {
			return GetRootIdentifierName(eae.Expression)
		}
	}
	return ""
}

// IsIdentifierNamed checks if a node is an identifier with the given name.
func IsIdentifierNamed(node *ast.Node, name string) bool {
	if node == nil || node.Kind != ast.KindIdentifier {
		return false
	}
	return node.AsIdentifier().Text == name
}

// IsAssignmentOperator checks if an operator kind is an assignment operator.
func IsAssignmentOperator(kind ast.Kind) bool {
	switch kind {
	case ast.KindEqualsToken,
		ast.KindPlusEqualsToken,
		ast.KindMinusEqualsToken,
		ast.KindAsteriskEqualsToken,
		ast.KindSlashEqualsToken,
		ast.KindPercentEqualsToken,
		ast.KindAsteriskAsteriskEqualsToken,
		ast.KindLessThanLessThanEqualsToken,
		ast.KindGreaterThanGreaterThanEqualsToken,
		ast.KindGreaterThanGreaterThanGreaterThanEqualsToken,
		ast.KindAmpersandEqualsToken,
		ast.KindBarEqualsToken,
		ast.KindCaretEqualsToken,
		ast.KindBarBarEqualsToken,
		ast.KindAmpersandAmpersandEqualsToken,
		ast.KindQuestionQuestionEqualsToken:
		return true
	}
	return false
}

// GetParamName extracts parameter name from AST.
func GetParamName(param *ast.ParameterDeclaration) string {
	if param == nil {
		return ""
	}
	nameNode := param.Name()
	if nameNode == nil {
		return ""
	}
	if nameNode.Kind == ast.KindIdentifier {
		return nameNode.AsIdentifier().Text
	}
	return ""
}

// GetJSONMethodName checks if a call expression is JSON.parse or JSON.stringify.
// Returns the method name ("parse" or "stringify") and true if it's a JSON method,
// or empty string and false otherwise.
func GetJSONMethodName(callExpr *ast.CallExpression) (string, bool) {
	if callExpr == nil || callExpr.Expression == nil {
		return "", false
	}
	if callExpr.Expression.Kind != ast.KindPropertyAccessExpression {
		return "", false
	}
	propAccess := callExpr.Expression.AsPropertyAccessExpression()
	if propAccess == nil || propAccess.Expression == nil {
		return "", false
	}
	if propAccess.Expression.Kind != ast.KindIdentifier {
		return "", false
	}
	objName := propAccess.Expression.AsIdentifier().Text
	if objName != "JSON" {
		return "", false
	}
	nameNode := propAccess.Name()
	if nameNode == nil {
		return "", false
	}
	methodName := nameNode.Text()
	if methodName == "parse" || methodName == "stringify" {
		return methodName, true
	}
	return "", false
}

// FunctionLike provides a common interface for function-like nodes.
type FunctionLike struct {
	Node *ast.Node
}

// GetFunctionLike wraps a function-like node in a FunctionLike struct.
func GetFunctionLike(node *ast.Node) *FunctionLike {
	if node == nil {
		return nil
	}
	switch node.Kind {
	case ast.KindFunctionDeclaration,
		ast.KindFunctionExpression,
		ast.KindArrowFunction,
		ast.KindMethodDeclaration:
		return &FunctionLike{Node: node}
	}
	return nil
}

// Parameters returns the parameters of a function-like node.
func (f *FunctionLike) Parameters() []*ast.ParameterDeclaration {
	if f == nil || f.Node == nil {
		return nil
	}
	var list *ast.NodeList
	switch f.Node.Kind {
	case ast.KindFunctionDeclaration:
		list = f.Node.AsFunctionDeclaration().Parameters
	case ast.KindFunctionExpression:
		list = f.Node.AsFunctionExpression().Parameters
	case ast.KindArrowFunction:
		list = f.Node.AsArrowFunction().Parameters
	case ast.KindMethodDeclaration:
		list = f.Node.AsMethodDeclaration().Parameters
	}
	return nodeListToParams(list)
}

// Type returns the return type annotation of a function-like node.
func (f *FunctionLike) Type() *ast.Node {
	if f == nil || f.Node == nil {
		return nil
	}
	switch f.Node.Kind {
	case ast.KindFunctionDeclaration:
		return f.Node.AsFunctionDeclaration().Type
	case ast.KindFunctionExpression:
		return f.Node.AsFunctionExpression().Type
	case ast.KindArrowFunction:
		return f.Node.AsArrowFunction().Type
	case ast.KindMethodDeclaration:
		return f.Node.AsMethodDeclaration().Type
	}
	return nil
}

// Body returns the body of a function-like node.
func (f *FunctionLike) Body() *ast.Node {
	if f == nil || f.Node == nil {
		return nil
	}
	switch f.Node.Kind {
	case ast.KindFunctionDeclaration:
		return f.Node.AsFunctionDeclaration().Body
	case ast.KindFunctionExpression:
		return f.Node.AsFunctionExpression().Body
	case ast.KindArrowFunction:
		return f.Node.AsArrowFunction().Body
	case ast.KindMethodDeclaration:
		return f.Node.AsMethodDeclaration().Body
	}
	return nil
}

// IsAsync returns true if the function has the async modifier.
func (f *FunctionLike) IsAsync() bool {
	if f == nil || f.Node == nil {
		return false
	}
	switch f.Node.Kind {
	case ast.KindFunctionDeclaration:
		return HasAsyncModifier(f.Node.AsFunctionDeclaration().Modifiers())
	case ast.KindFunctionExpression:
		return HasAsyncModifier(f.Node.AsFunctionExpression().Modifiers())
	case ast.KindArrowFunction:
		return HasAsyncModifier(f.Node.AsArrowFunction().Modifiers())
	case ast.KindMethodDeclaration:
		return HasAsyncModifier(f.Node.AsMethodDeclaration().Modifiers())
	}
	return false
}

// Name returns the function name (empty string for anonymous functions).
func (f *FunctionLike) Name() string {
	if f == nil || f.Node == nil {
		return ""
	}
	switch f.Node.Kind {
	case ast.KindFunctionDeclaration:
		fd := f.Node.AsFunctionDeclaration()
		if fd != nil && fd.Name() != nil {
			return fd.Name().Text()
		}
	case ast.KindMethodDeclaration:
		md := f.Node.AsMethodDeclaration()
		if md != nil && md.Name() != nil {
			if md.Name().Kind == ast.KindIdentifier {
				return md.Name().AsIdentifier().Text
			}
		}
	}
	return ""
}

// HasAsyncModifier checks if a modifier list contains the async keyword.
func HasAsyncModifier(modifiers *ast.ModifierList) bool {
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

// nodeListToParams converts a NodeList to a slice of ParameterDeclarations.
func nodeListToParams(list *ast.NodeList) []*ast.ParameterDeclaration {
	if list == nil {
		return nil
	}
	var params []*ast.ParameterDeclaration
	for _, node := range list.Nodes {
		if param := node.AsParameterDeclaration(); param != nil {
			params = append(params, param)
		}
	}
	return params
}

// IsDeclarationFile checks if a filename is a TypeScript declaration file.
func IsDeclarationFile(fileName string) bool {
	return len(fileName) > 5 && fileName[len(fileName)-5:] == ".d.ts"
}

// IsNodeModulesPath checks if a path is in node_modules.
func IsNodeModulesPath(path string) bool {
	return len(path) >= 12 && (path[:12] == "node_modules" ||
		(len(path) >= 13 && path[:13] == "/node_modules") ||
		contains(path, "/node_modules/") ||
		contains(path, "\\node_modules\\"))
}

// contains is a simple string contains check.
func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// GetCallExpressionName gets the name of the called function.
func GetCallExpressionName(call *ast.CallExpression) string {
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

// GetEntityName extracts the full name from an entity name (identifier or qualified name).
// For qualified names like `React.FormEvent`, it returns the full dotted path.
func GetEntityName(node *ast.Node) string {
	if node == nil {
		return ""
	}

	switch node.Kind {
	case ast.KindIdentifier:
		return node.AsIdentifier().Text
	case ast.KindQualifiedName:
		qn := node.AsQualifiedName()
		if qn != nil {
			left := GetEntityName(qn.Left)
			right := ""
			if qn.Right != nil {
				right = qn.Right.Text()
			}
			if left != "" && right != "" {
				return left + "." + right
			}
			if right != "" {
				return right
			}
			return left
		}
	case ast.KindPropertyAccessExpression:
		pa := node.AsPropertyAccessExpression()
		if pa != nil {
			left := GetEntityName(pa.Expression)
			right := ""
			if pa.Name() != nil {
				right = pa.Name().AsIdentifier().Text
			}
			if left != "" && right != "" {
				return left + "." + right
			}
		}
	}

	return ""
}
