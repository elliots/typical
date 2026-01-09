//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/elliots/typical/packages/compiler/internal/wasmapi"
)

func main() {
	// Create the WASM API
	api := wasmapi.New()

	// Export functions to JavaScript
	js.Global().Set("typicalTransformSource", js.FuncOf(func(this js.Value, args []js.Value) (result any) {
		// Recover from panics and return error
		defer func() {
			if r := recover(); r != nil {
				result = errorResult(fmt.Sprintf("panic: %v", r))
			}
		}()

		if len(args) < 2 {
			return errorResult("typicalTransformSource requires at least 2 arguments: fileName, source")
		}

		fileName := args[0].String()
		source := args[1].String()

		var options wasmapi.TransformOptions
		if len(args) >= 3 && args[2].Type() == js.TypeString {
			optionsStr := args[2].String()
			if optionsStr != "" && optionsStr != "{}" {
				if err := json.Unmarshal([]byte(optionsStr), &options); err != nil {
					return errorResult("failed to parse options: " + err.Error())
				}
			}
		}

		transformResult, err := api.TransformSource(fileName, source, &options)
		if err != nil {
			return errorResult(err.Error())
		}

		return successResult(transformResult)
	}))

	// Keep the Go runtime alive
	<-make(chan struct{})
}

func errorResult(msg string) string {
	result := map[string]any{
		"error": msg,
	}
	data, _ := json.Marshal(result)
	return string(data)
}

func successResult(result *wasmapi.TransformResult) string {
	data, _ := json.Marshal(map[string]any{
		"code":      result.Code,
		"sourceMap": result.SourceMap,
	})
	return string(data)
}
