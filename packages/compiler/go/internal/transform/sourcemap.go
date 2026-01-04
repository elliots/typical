package transform

import (
	"path/filepath"
	"sort"
	"strings"
)

// RawSourceMap represents a v3 source map
type RawSourceMap struct {
	Version        int       `json:"version"`
	File           string    `json:"file"`
	SourceRoot     string    `json:"sourceRoot,omitempty"`
	Sources        []string  `json:"sources"`
	Names          []string  `json:"names"`
	Mappings       string    `json:"mappings"`
	SourcesContent []*string `json:"sourcesContent,omitempty"`
}

// computeLineStarts returns byte positions where each line starts (0-indexed)
func computeLineStarts(text string) []int {
	starts := []int{0}
	for i := 0; i < len(text); i++ {
		if text[i] == '\n' {
			starts = append(starts, i+1)
		}
	}
	return starts
}

// posToLineCol converts a byte position to 0-based line and column
func posToLineCol(pos int, lineStarts []int) (line, col int) {
	line = sort.Search(len(lineStarts), func(i int) bool {
		return lineStarts[i] > pos
	}) - 1
	if line < 0 {
		line = 0
	}
	col = pos - lineStarts[line]
	return
}

// encodeVLQ encodes an integer using Base64 VLQ encoding for source maps
func encodeVLQ(value int) string {
	var result strings.Builder

	// Convert to unsigned with sign in LSB
	if value < 0 {
		value = ((-value) << 1) | 1
	} else {
		value = value << 1
	}

	const base64Chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

	for {
		digit := value & 0x1f
		value >>= 5
		if value > 0 {
			digit |= 0x20 // continuation bit
		}
		result.WriteByte(base64Chars[digit])
		if value == 0 {
			break
		}
	}
	return result.String()
}

// sourceMapBuilder helps build source map mappings
type sourceMapBuilder struct {
	mappings         strings.Builder
	firstOnLine      bool
	lastGenCol       int
	lastSrcLine      int
	lastSrcCol       int
	lastSrcIdx       int
}

func newSourceMapBuilder() *sourceMapBuilder {
	return &sourceMapBuilder{
		firstOnLine: true,
	}
}

// addMapping adds a mapping segment (all values are absolute, will be converted to relative)
func (b *sourceMapBuilder) addMapping(genCol, srcIdx, srcLine, srcCol int) {
	if !b.firstOnLine {
		b.mappings.WriteByte(',')
	}
	b.firstOnLine = false

	// Encode relative values
	b.mappings.WriteString(encodeVLQ(genCol - b.lastGenCol))
	b.mappings.WriteString(encodeVLQ(srcIdx - b.lastSrcIdx))
	b.mappings.WriteString(encodeVLQ(srcLine - b.lastSrcLine))
	b.mappings.WriteString(encodeVLQ(srcCol - b.lastSrcCol))

	b.lastGenCol = genCol
	b.lastSrcIdx = srcIdx
	b.lastSrcLine = srcLine
	b.lastSrcCol = srcCol
}

// newLine marks the start of a new generated line
func (b *sourceMapBuilder) newLine() {
	b.mappings.WriteByte(';')
	b.firstOnLine = true
	b.lastGenCol = 0
}

// String returns the mappings string
func (b *sourceMapBuilder) String() string {
	return b.mappings.String()
}

// buildSourceMap generates a source map from the original text and insertions
func buildSourceMap(fileName, originalText string, insertions []insertion) (string, *RawSourceMap) {
	lineStarts := computeLineStarts(originalText)

	// Sort insertions ascending by position for forward processing
	sorted := make([]insertion, len(insertions))
	copy(sorted, insertions)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].pos < sorted[j].pos
	})

	var result strings.Builder
	builder := newSourceMapBuilder()

	genCol := 0
	srcPos := 0

	for _, ins := range sorted {
		// Copy original text from srcPos to ins.pos
		if ins.pos > srcPos {
			chunk := originalText[srcPos:ins.pos]

			// Write chunk character by character, adding mapping for each line
			chunkSrcPos := srcPos
			for i, ch := range chunk {
				// Add mapping at start of each line (or first char)
				if i == 0 || (i > 0 && chunk[i-1] == '\n') {
					srcLine, srcCol := posToLineCol(chunkSrcPos+i, lineStarts)
					builder.addMapping(genCol, 0, srcLine, srcCol)
				}
				result.WriteRune(ch)
				if ch == '\n' {
					builder.newLine()
					genCol = 0
				} else {
					genCol++
				}
			}
			srcPos = ins.pos
		}

		// Insert validator text - map back to the type annotation that caused it
		if ins.sourcePos >= 0 {
			srcLine, srcCol := posToLineCol(ins.sourcePos, lineStarts)
			builder.addMapping(genCol, 0, srcLine, srcCol)
		}
		for _, ch := range ins.text {
			result.WriteRune(ch)
			if ch == '\n' {
				builder.newLine()
				genCol = 0
				// Re-add mapping after newline if we have a source position
				if ins.sourcePos >= 0 {
					srcLine, srcCol := posToLineCol(ins.sourcePos, lineStarts)
					builder.addMapping(genCol, 0, srcLine, srcCol)
				}
			} else {
				genCol++
			}
		}

		// If this insertion has a skipTo, advance srcPos to skip original text
		if ins.skipTo > srcPos {
			srcPos = ins.skipTo
		}
	}

	// Copy remaining original text
	if srcPos < len(originalText) {
		chunk := originalText[srcPos:]
		// Write remaining chunk with per-line mappings
		for i, ch := range chunk {
			if i == 0 || (i > 0 && chunk[i-1] == '\n') {
				srcLine, srcCol := posToLineCol(srcPos+i, lineStarts)
				builder.addMapping(genCol, 0, srcLine, srcCol)
			}
			result.WriteRune(ch)
			if ch == '\n' {
				builder.newLine()
				genCol = 0
			} else {
				genCol++
			}
		}
	}

	// Build the source map
	// File: the generated file this map is for (will be set by the build tool)
	// Sources: the original source file(s)
	content := originalText
	baseName := filepath.Base(fileName)
	sourceMap := &RawSourceMap{
		Version:        3,
		File:           baseName, // Generated output filename (same as source for in-place transform)
		Sources:        []string{baseName},
		SourcesContent: []*string{&content},
		Names:          []string{},
		Mappings:       builder.String(),
	}

	return result.String(), sourceMap
}
