// Based on https://github.com/evanw/source-map-visualization (ported to lit/typescript)

import { LitElement, html, css, PropertyValues } from "lit";
import { customElement, property, state } from "lit/decorators.js";

interface SourceMapData {
  version: number;
  sources: string[];
  sourcesContent?: string[];
  names?: string[];
  mappings: string;
}

interface ParsedSource {
  name: string;
  content: string;
  data: Int32Array;
  dataLength: number;
}

interface ParsedSourceMap {
  sources: ParsedSource[];
  names: string[];
  data: Int32Array;
}

interface TextArea {
  sourceIndex: number | null;
  bounds: () => { x: number; y: number; width: number; height: number };
  updateAfterWrapChange: () => void;
  getHoverRect: () => [number, number, number, number] | null;
  onwheel: (e: WheelEvent) => void;
  onmousemove: (e: MouseEvent) => void;
  onmousedown: (e: MouseEvent) => void;
  scrollTo: (index: number, line: number) => void;
  draw: (bodyStyle: CSSStyleDeclaration) => void;
}

interface Hover {
  sourceIndex: number | null;
  lineIndex: number;
  row: number;
  column: number;
  index: number;
  mapping: {
    generatedLine: number;
    generatedColumn: number;
    originalSource: number;
    originalLine: number;
    originalColumn: number;
    originalName: number;
  } | null;
}

@customElement("source-map-visualizer")
export class SourceMapVisualizer extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
      height: 100%;
      position: relative;
      overflow: hidden;
    }

    .container {
      width: 100%;
      height: 100%;
      position: relative;
      background: var(--smv-bg, #1e1e1e);
    }

    canvas {
      display: block;
      position: absolute;
      top: 0;
      left: 0;
    }

    .toolbar {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      background: rgba(45, 45, 45, 0.95);
      border-bottom: 1px solid #3d3d3d;
      z-index: 10;
    }

    .toolbar-section {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .toolbar-label {
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #888;
    }

    .file-select {
      background: #333;
      border: 1px solid #555;
      border-radius: 4px;
      color: #ccc;
      font-size: 12px;
      padding: 2px 8px;
      max-width: 200px;
    }

    .wrap-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: #888;
      cursor: pointer;
    }

    .wrap-label:hover {
      color: #ccc;
    }

    .status-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 12px;
      background: rgba(45, 45, 45, 0.95);
      border-top: 1px solid #3d3d3d;
      z-index: 10;
    }

    .status-section {
      display: flex;
      align-items: center;
      gap: 24px;
    }

    .status-text {
      font-size: 11px;
      color: #888;
    }

    .loading {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(30, 30, 30, 0.9);
      color: #ccc;
      font-size: 14px;
      z-index: 20;
    }

    .error {
      position: absolute;
      inset: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(30, 30, 30, 0.9);
      color: #f48771;
      font-size: 14px;
      padding: 20px;
      text-align: center;
      z-index: 20;
    }
  `;

  @property({ type: String }) originalCode = "";
  @property({ type: String }) generatedCode = "";
  @property({ attribute: false }) sourceMap: SourceMapData | null = null;

  @state() private loading = false;
  @state() private error = "";
  @state() private wrap = true;
  @state() private selectedSource = 0;

  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private animationFrameId: number | null = null;

  private isInvalid = true;
  private originalTextArea: TextArea | null = null;
  private generatedTextArea: TextArea | null = null;
  private hover: Hover | null = null;
  private parsedSourceMap: ParsedSourceMap | null = null;

  // Constants
  private readonly toolbarHeight = 32;
  private readonly statusBarHeight = 0;
  private readonly splitterWidth = 6;
  private readonly rowHeight = 21;
  private readonly margin = 64;
  private readonly monospaceFont = "14px monospace";

  // Colours
  private readonly originalLineColors = [
    "rgba(25, 133, 255, 0.3)",
    "rgba(174, 97, 174, 0.3)",
    "rgba(255, 97, 106, 0.3)",
    "rgba(250, 192, 61, 0.3)",
    "rgba(115, 192, 88, 0.3)",
  ];

  // VLQ decoding table
  private readonly vlqTable = new Uint8Array(128);
  private readonly vlqChars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

  constructor() {
    super();
    // Initialize VLQ table
    for (let i = 0; i < this.vlqTable.length; i++) this.vlqTable[i] = 0xff;
    for (let i = 0; i < this.vlqChars.length; i++) this.vlqTable[this.vlqChars.charCodeAt(i)] = i;
  }

  connectedCallback() {
    super.connectedCallback();
    this.resizeObserver = new ResizeObserver(() => {
      this.handleResize();
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.resizeObserver?.disconnect();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
  }

  protected firstUpdated() {
    this.canvas = this.shadowRoot?.querySelector("canvas") ?? null;
    if (this.canvas) {
      this.ctx = this.canvas.getContext("2d");
      this.resizeObserver?.observe(this.canvas.parentElement!);
      this.setupEventListeners();
      this.handleResize();
      this.startDrawLoop();
    }

    if (this.sourceMap && this.generatedCode) {
      this.loadSourceMap();
    }
  }

  protected updated(changedProperties: PropertyValues) {
    if (
      changedProperties.has("sourceMap") ||
      changedProperties.has("generatedCode") ||
      changedProperties.has("originalCode")
    ) {
      if (this.sourceMap && this.generatedCode) {
        this.loadSourceMap();
      }
    }
  }

  private setupEventListeners() {
    if (!this.canvas) return;

    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.originalTextArea?.onwheel(e);
        this.generatedTextArea?.onwheel(e);
      },
      { passive: false },
    );

    this.canvas.addEventListener("mousemove", (e) => {
      const oldHover = this.hover;
      this.hover = null;

      this.originalTextArea?.onmousemove(e);
      this.generatedTextArea?.onmousemove(e);

      if (JSON.stringify(this.hover) !== JSON.stringify(oldHover)) {
        this.isInvalid = true;
      }
    });

    this.canvas.addEventListener("mousedown", (e) => {
      this.originalTextArea?.onmousedown(e);
      this.generatedTextArea?.onmousedown(e);
    });

    this.canvas.addEventListener("mouseleave", () => {
      if (this.hover) {
        this.hover = null;
        this.isInvalid = true;
      }
    });
  }

  private handleResize() {
    if (!this.canvas || !this.ctx) return;

    const container = this.canvas.parentElement;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    const ratio = devicePixelRatio;

    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.canvas.width = Math.round(width * ratio);
    this.canvas.height = Math.round(height * ratio);
    this.ctx.scale(ratio, ratio);
    this.isInvalid = true;
  }

  private startDrawLoop() {
    const draw = () => {
      this.animationFrameId = requestAnimationFrame(draw);
      if (!this.isInvalid) return;
      this.isInvalid = false;
      this.draw();
    };
    draw();
  }

  private draw() {
    if (!this.ctx || !this.canvas) return;

    const rect = this.canvas.parentElement?.getBoundingClientRect();
    if (!rect) return;

    const width = rect.width;
    const height = rect.height;

    this.ctx.clearRect(0, 0, width, height);
    if (!this.generatedTextArea) return;

    // Use a fake body style for colours
    const bodyStyle = {
      color: "#d4d4d4",
      backgroundColor: "#1e1e1e",
    } as CSSStyleDeclaration;

    if (this.originalTextArea) this.originalTextArea.draw(bodyStyle);
    this.generatedTextArea.draw(bodyStyle);

    // Draw the splitter
    this.ctx.fillStyle = "rgba(127, 127, 127, 0.2)";
    this.ctx.fillRect(
      (width >>> 1) - (this.splitterWidth >> 1),
      this.toolbarHeight,
      this.splitterWidth,
      height - this.toolbarHeight - this.statusBarHeight,
    );

    // Draw the arrow between the two hover areas
    if (
      this.hover?.mapping &&
      this.originalTextArea &&
      this.originalTextArea.sourceIndex === this.hover.mapping.originalSource
    ) {
      const originalHoverRect = this.originalTextArea.getHoverRect();
      const generatedHoverRect = this.generatedTextArea.getHoverRect();
      if (originalHoverRect && generatedHoverRect) {
        const textColor = bodyStyle.color;
        const originalBounds = this.originalTextArea.bounds();
        const generatedBounds = this.generatedTextArea.bounds();
        const originalArrowHead = this.hover.sourceIndex === this.generatedTextArea.sourceIndex;
        const generatedArrowHead = this.hover.sourceIndex === this.originalTextArea.sourceIndex;
        const [ox, oy, ow, oh] = originalHoverRect;
        const [gx, gy, , gh] = generatedHoverRect;
        const x1 =
          Math.min(ox + ow, originalBounds.x + originalBounds.width) + (originalArrowHead ? 10 : 2);
        const x2 = Math.max(gx, generatedBounds.x + this.margin) - (generatedArrowHead ? 10 : 2);
        const y1 = oy + oh / 2;
        const y2 = gy + gh / 2;

        const c = this.ctx;
        c.save();
        c.beginPath();
        c.rect(0, this.toolbarHeight, width, height - this.toolbarHeight - this.statusBarHeight);
        c.clip();

        // Draw the curve
        c.beginPath();
        c.moveTo(x1, y1);
        c.bezierCurveTo(
          (x1 + 2 * x2) / 3 + this.margin / 2,
          y1,
          (x1 * 2 + x2) / 3 - this.margin / 2,
          y2,
          x2,
          y2,
        );
        c.strokeStyle = textColor;
        c.lineWidth = 2;
        c.stroke();

        // Draw the arrow heads
        c.beginPath();
        if (originalArrowHead) {
          c.moveTo(x1 - 10, y1);
          c.lineTo(x1, y1 + 5);
          c.lineTo(x1, y1 - 5);
        }
        if (generatedArrowHead) {
          c.moveTo(x2 + 10, y2);
          c.lineTo(x2, y2 + 5);
          c.lineTo(x2, y2 - 5);
        }
        c.fillStyle = textColor;
        c.fill();

        c.restore();
      }
    }
  }

  private async loadSourceMap() {
    if (!this.sourceMap || !this.ctx) return;

    this.loading = true;
    this.error = "";

    try {
      const sm = this.parseSourceMap(this.sourceMap);
      this.parsedSourceMap = sm;

      // Helper to get current dimensions dynamically
      const getDimensions = () => {
        const rect = this.canvas?.parentElement?.getBoundingClientRect();
        return { width: rect?.width ?? 0, height: rect?.height ?? 0 };
      };

      // Create original text area (if there are sources)
      if (sm.sources.length > 0) {
        this.originalTextArea = await this.createTextArea({
          sourceIndex: 0,
          text: sm.sources[0].content,
          mappings: sm.sources[0].data,
          mappingsOffset: 3,
          otherSource: (index) => (index === -1 ? null : sm.sources[index].name),
          originalName: (index) => sm.names[index],
          bounds: () => {
            const { width, height } = getDimensions();
            return {
              x: 0,
              y: this.toolbarHeight,
              width: (width >>> 1) - (this.splitterWidth >> 1),
              height: height - this.toolbarHeight - this.statusBarHeight,
            };
          },
        });
      }

      // Create generated text area
      this.generatedTextArea = await this.createTextArea({
        sourceIndex: null,
        text: this.generatedCode,
        mappings: sm.data,
        mappingsOffset: 0,
        otherSource: (index) => (index === -1 ? null : sm.sources[index].name),
        originalName: (index) => sm.names[index],
        bounds: () => {
          const { width, height } = getDimensions();
          const x = (width >> 1) + ((this.splitterWidth + 1) >> 1);
          return {
            x,
            y: this.toolbarHeight,
            width: width - x,
            height: height - this.toolbarHeight - this.statusBarHeight,
          };
        },
      });

      this.isInvalid = true;
    } catch (e) {
      this.error = e instanceof Error ? e.message : String(e);
    } finally {
      this.loading = false;
    }
  }

  private parseSourceMap(json: SourceMapData): ParsedSourceMap {
    if (json.version !== 3) {
      throw new Error("Invalid source map version");
    }

    const { sources, sourcesContent, names, mappings } = json;
    const emptyData = new Int32Array(0);
    const parsedSources: ParsedSource[] = sources.map((name, i) => ({
      name,
      content: sourcesContent?.[i] || "",
      data: emptyData,
      dataLength: 0,
    }));

    const data = this.decodeMappings(mappings, sources.length, names?.length ?? 0);
    this.generateInverseMappings(parsedSources, data);

    return { sources: parsedSources, names: names ?? [], data };
  }

  private decodeMappings(mappings: string, sourcesCount: number, namesCount: number): Int32Array {
    const n = mappings.length;
    let data = new Int32Array(1024);
    let dataLength = 0;
    let generatedLine = 0;
    let generatedLineStart = 0;
    let generatedColumn = 0;
    let originalSource = 0;
    let originalLine = 0;
    let originalColumn = 0;
    let originalName = 0;
    let needToSortGeneratedColumns = false;
    let i = 0;

    const decodeError = (text: string) => {
      throw new Error(`Invalid VLQ data at index ${i}: ${text}`);
    };

    const decodeVLQ = (): number => {
      let shift = 0;
      let vlq = 0;

      while (true) {
        if (i >= mappings.length) decodeError("Unexpected early end of mapping data");
        const c = mappings.charCodeAt(i);
        if ((c & 0x7f) !== c)
          decodeError(`Invalid mapping character: ${JSON.stringify(String.fromCharCode(c))}`);
        const index = this.vlqTable[c & 0x7f];
        if (index === 0xff)
          decodeError(`Invalid mapping character: ${JSON.stringify(String.fromCharCode(c))}`);
        i++;

        vlq |= (index & 31) << shift;
        shift += 5;

        if ((index & 32) === 0) break;
      }

      return vlq & 1 ? -(vlq >> 1) : vlq >> 1;
    };

    while (i < n) {
      let c = mappings.charCodeAt(i);

      if (c === 59 /* ; */) {
        if (needToSortGeneratedColumns) {
          for (let j = generatedLineStart + 6; j < dataLength; j += 6) {
            const genL = data[j];
            const genC = data[j + 1];
            const origS = data[j + 2];
            const origL = data[j + 3];
            const origC = data[j + 4];
            const origN = data[j + 5];
            let k = j - 6;
            for (; k >= generatedLineStart && data[k + 1] > genC; k -= 6) {
              data[k + 6] = data[k];
              data[k + 7] = data[k + 1];
              data[k + 8] = data[k + 2];
              data[k + 9] = data[k + 3];
              data[k + 10] = data[k + 4];
              data[k + 11] = data[k + 5];
            }
            data[k + 6] = genL;
            data[k + 7] = genC;
            data[k + 8] = origS;
            data[k + 9] = origL;
            data[k + 10] = origC;
            data[k + 11] = origN;
          }
        }

        generatedLine++;
        generatedColumn = 0;
        generatedLineStart = dataLength;
        needToSortGeneratedColumns = false;
        i++;
        continue;
      }

      if (c === 44 /* , */) {
        i++;
        continue;
      }

      const generatedColumnDelta = decodeVLQ();
      if (generatedColumnDelta < 0) needToSortGeneratedColumns = true;
      generatedColumn += generatedColumnDelta;
      if (generatedColumn < 0) decodeError(`Invalid generated column: ${generatedColumn}`);

      let isOriginalSourceMissing = true;
      let isOriginalNameMissing = true;
      if (i < n) {
        c = mappings.charCodeAt(i);
        if (c === 44 /* , */) {
          i++;
        } else if (c !== 59 /* ; */) {
          isOriginalSourceMissing = false;

          const originalSourceDelta = decodeVLQ();
          originalSource += originalSourceDelta;
          if (originalSource < 0 || originalSource >= sourcesCount)
            decodeError(
              `Original source index ${originalSource} is invalid (there are ${sourcesCount} sources)`,
            );

          const originalLineDelta = decodeVLQ();
          originalLine += originalLineDelta;
          if (originalLine < 0) decodeError(`Invalid original line: ${originalLine}`);

          const originalColumnDelta = decodeVLQ();
          originalColumn += originalColumnDelta;
          if (originalColumn < 0) decodeError(`Invalid original column: ${originalColumn}`);

          if (i < n) {
            c = mappings.charCodeAt(i);
            if (c === 44 /* , */) {
              i++;
            } else if (c !== 59 /* ; */) {
              isOriginalNameMissing = false;

              const originalNameDelta = decodeVLQ();
              originalName += originalNameDelta;
              if (originalName < 0 || originalName >= namesCount)
                decodeError(
                  `Original name index ${originalName} is invalid (there are ${namesCount} names)`,
                );

              if (i < n) {
                c = mappings.charCodeAt(i);
                if (c === 44 /* , */) {
                  i++;
                } else if (c !== 59 /* ; */) {
                  decodeError(
                    `Invalid character after mapping: ${JSON.stringify(String.fromCharCode(c))}`,
                  );
                }
              }
            }
          }
        }
      }

      if (dataLength + 6 > data.length) {
        const newData = new Int32Array(data.length << 1);
        newData.set(data);
        data = newData;
      }
      data[dataLength] = generatedLine;
      data[dataLength + 1] = generatedColumn;
      if (isOriginalSourceMissing) {
        data[dataLength + 2] = -1;
        data[dataLength + 3] = -1;
        data[dataLength + 4] = -1;
      } else {
        data[dataLength + 2] = originalSource;
        data[dataLength + 3] = originalLine;
        data[dataLength + 4] = originalColumn;
      }
      data[dataLength + 5] = isOriginalNameMissing ? -1 : originalName;
      dataLength += 6;
    }

    return data.subarray(0, dataLength);
  }

  private generateInverseMappings(sources: ParsedSource[], data: Int32Array): void {
    let longestDataLength = 0;

    for (let i = 0, n = data.length; i < n; i += 6) {
      const originalSource = data[i + 2];
      if (originalSource === -1) continue;

      const source = sources[originalSource];
      let inverseData = source.data;
      let j = source.dataLength;

      if (j + 6 > inverseData.length) {
        const newLength = inverseData.length << 1;
        const newData = new Int32Array(newLength > 1024 ? newLength : 1024);
        newData.set(inverseData);
        source.data = inverseData = newData;
      }
      inverseData[j] = data[i];
      inverseData[j + 1] = data[i + 1];
      inverseData[j + 2] = originalSource;
      inverseData[j + 3] = data[i + 3];
      inverseData[j + 4] = data[i + 4];
      inverseData[j + 5] = data[i + 5];
      j += 6;
      source.dataLength = j;
      if (j > longestDataLength) longestDataLength = j;
    }

    // Sort the mappings for each individual source
    const temp = new Int32Array(longestDataLength);
    for (const source of sources) {
      const sourceData = source.data.subarray(0, source.dataLength);

      let isSorted = false;
      Object.defineProperty(source, "data", {
        get() {
          if (!isSorted) {
            temp.set(sourceData);
            topDownSplitMerge(temp, 0, sourceData.length, sourceData);
            isSorted = true;
          }
          return sourceData;
        },
      });
    }

    function topDownSplitMerge(B: Int32Array, iBegin: number, iEnd: number, A: Int32Array) {
      if (iEnd - iBegin <= 6) return;

      let isAlreadySorted = true;
      for (let i = iBegin + 3, j = i + 6; j < iEnd; i = j, j += 6) {
        if (A[i] < A[j] || (A[i] === A[j] && A[i + 1] <= A[j + 1])) continue;
        isAlreadySorted = false;
        break;
      }
      if (isAlreadySorted) return;

      const iMiddle = (((iEnd / 6 + iBegin / 6) >> 1) * 6) | 0;
      topDownSplitMerge(A, iBegin, iMiddle, B);
      topDownSplitMerge(A, iMiddle, iEnd, B);
      topDownMerge(B, iBegin, iMiddle, iEnd, A);
    }

    function topDownMerge(
      A: Int32Array,
      iBegin: number,
      iMiddle: number,
      iEnd: number,
      B: Int32Array,
    ) {
      let ii = iBegin,
        jj = iMiddle;
      for (let k = iBegin; k < iEnd; k += 6) {
        if (
          ii < iMiddle &&
          (jj >= iEnd ||
            A[ii + 3] < A[jj + 3] ||
            (A[ii + 3] === A[jj + 3] && A[ii + 4] <= A[jj + 4]))
        ) {
          B[k] = A[ii];
          B[k + 1] = A[ii + 1];
          B[k + 2] = A[ii + 2];
          B[k + 3] = A[ii + 3];
          B[k + 4] = A[ii + 4];
          B[k + 5] = A[ii + 5];
          ii += 6;
        } else {
          B[k] = A[jj];
          B[k + 1] = A[jj + 1];
          B[k + 2] = A[jj + 2];
          B[k + 3] = A[jj + 3];
          B[k + 4] = A[jj + 4];
          B[k + 5] = A[jj + 5];
          jj += 6;
        }
      }
    }
  }

  private async createTextArea(options: {
    sourceIndex: number | null;
    text: string;
    mappings: Int32Array;
    mappingsOffset: number;
    otherSource: (index: number) => string | null;
    originalName: (index: number) => string;
    bounds: () => { x: number; y: number; width: number; height: number };
  }): Promise<TextArea> {
    const { sourceIndex, text, mappings, mappingsOffset, otherSource, originalName, bounds } =
      options;
    const c = this.ctx!;

    const scrollbarThickness = 16;
    const textPaddingX = 5;
    const textPaddingY = 1;
    const hoverBoxLineThickness = 2;

    // Parse text into lines and runs
    const textData = await this.splitTextIntoLinesAndRuns(text);
    const { lines, longestColumnForLine, runData } = textData;
    let longestLineInColumns = textData.longestLineInColumns;

    const run_whitespace = (index: number) => runData[index] & 0xff;
    const run_isSingleChunk = (index: number) => runData[index] & 0x100;
    const run_startIndex = (index: number) => runData[index + 1];
    const run_endIndex = (index: number) => runData[index + 2];
    const run_startColumn = (index: number) => runData[index + 3];
    const run_endColumn = (index: number) => runData[index + 4];

    let scrollX = 0;
    let scrollY = 0;
    let lastLineIndex = lines.length - 1;
    let animate: (() => void) | null = null;

    // Extend scroll area for out-of-bounds mappings
    for (let i = 0, n = mappings.length; i < n; i += 6) {
      let line = mappings[i + mappingsOffset];
      let column = mappings[i + mappingsOffset + 1];
      if (line < lines.length) {
        const { endColumn } = lines[line];
        if (column > endColumn) {
          column = column - lines[line].endIndex + endColumn;
        }
      } else if (line > lastLineIndex) {
        lastLineIndex = line;
      }
      if (column > longestLineInColumns) {
        longestLineInColumns = column;
      }
    }

    const wrappedRowsCache = new Map<number, Int32Array>();

    const computeColumnsAcross = (width: number, columnWidth: number) => {
      if (!this.wrap) return Infinity;
      return Math.max(
        1,
        Math.floor((width - this.margin - textPaddingX - scrollbarThickness) / columnWidth),
      );
    };

    const wrappedRowsForColumns = (columnsAcross: number) => {
      let result = wrappedRowsCache.get(columnsAcross);
      if (!result) {
        result = new Int32Array(lastLineIndex + 2);
        let rows = 0;
        const n = lastLineIndex + 1;
        if (columnsAcross === Infinity) {
          for (let i = 0; i <= n; i++) {
            result[i] = i;
          }
        } else {
          for (let i = 0; i < n; i++) {
            result[i] = rows;
            rows +=
              Math.ceil((longestColumnForLine[i] ?? longestLineInColumns) / columnsAcross) || 1;
          }
          result[n] = rows;
        }
        wrappedRowsCache.set(columnsAcross, result);
      }
      return result;
    };

    const computeScrollbarsAndClampScroll = () => {
      const { width, height } = bounds();
      c.font = "14px monospace";
      const columnWidth = c.measureText(" ".repeat(64)).width / 64;
      const columnsAcross = computeColumnsAcross(width, columnWidth);
      const wrappedRows = wrappedRowsForColumns(columnsAcross);

      let scrollbarX = null as { trackLength: number; thumbLength: number } | null;
      let scrollbarY = null as { trackLength: number; thumbLength: number } | null;
      let maxScrollX: number;
      let maxScrollY: number;

      if (this.wrap) {
        maxScrollX = 0;
        maxScrollY =
          (wrappedRowsForColumns(computeColumnsAcross(width, columnWidth))[lastLineIndex + 1] - 1) *
          this.rowHeight;
      } else {
        maxScrollX = Math.round(
          longestLineInColumns * columnWidth +
            textPaddingX * 2 +
            this.margin +
            scrollbarThickness -
            width,
        );
        maxScrollY = lastLineIndex * this.rowHeight;
      }

      scrollX = Math.max(0, Math.min(scrollX, maxScrollX));
      scrollY = Math.max(0, Math.min(scrollY, maxScrollY));

      if (maxScrollX > 0) {
        const trackLength = width - this.margin - scrollbarThickness / 2;
        scrollbarX = {
          trackLength,
          thumbLength: Math.max(
            scrollbarThickness * 2,
            trackLength / (1 + maxScrollX / trackLength),
          ),
        };
      }

      if (maxScrollY > 0) {
        const trackLength = height - scrollbarThickness / 2;
        scrollbarY = {
          trackLength,
          thumbLength: Math.max(
            scrollbarThickness * 2,
            trackLength / (1 + maxScrollY / trackLength),
          ),
        };
      }

      return {
        columnWidth,
        columnsAcross,
        wrappedRows,
        maxScrollX,
        maxScrollY,
        scrollbarX,
        scrollbarY,
      };
    };

    const lineIndexForRow = (wrappedRows: Int32Array, row: number) => {
      let n = lastLineIndex + 1;
      if (row > wrappedRows[n]) {
        return n + row - wrappedRows[n];
      }
      let lineIndex = 0;
      while (n > 0) {
        const step = n >> 1;
        const it = lineIndex + step;
        if (wrappedRows[it + 1] <= row) {
          lineIndex = it + 1;
          n -= step + 1;
        } else {
          n = step;
        }
      }
      return lineIndex;
    };

    const emptyLine = {
      raw: "",
      runBase: 0,
      runCount: 0,
      runText: {} as Record<number, string>,
      endIndex: 0,
      endColumn: 0,
    };

    const analyzeLine = (
      line: number,
      column: number,
      fractionalColumn: number,
      tabStopBehavior: "round" | "floor",
    ) => {
      let index = column;
      let firstRun = 0;
      let nearbyRun = 0;
      const lineData = line < lines.length ? lines[line] : emptyLine;
      const { raw, runBase, runCount, runText } = lineData;
      let runLimit = runCount;
      let endOfLineIndex = 0;
      let endOfLineColumn = 0;
      let beforeNewlineIndex = 0;
      let hasTrailingNewline = false;

      if (runLimit > 0) {
        const lastRun = runBase + 5 * (runLimit - 1);
        endOfLineIndex = run_endIndex(lastRun);
        endOfLineColumn = run_endColumn(lastRun);
        beforeNewlineIndex = run_startIndex(lastRun);
        hasTrailingNewline = run_whitespace(lastRun) === 0x0a;

        firstRun = 0;
        while (runLimit > 0) {
          const step = runLimit >> 1;
          const it = firstRun + step;
          if (run_endColumn(runBase + 5 * it) < column) {
            firstRun = it + 1;
            runLimit -= step + 1;
          } else {
            runLimit = step;
          }
        }

        if (firstRun >= runCount) firstRun--;

        nearbyRun = firstRun;
        while (run_startColumn(runBase + 5 * nearbyRun) > column && nearbyRun > 0) nearbyRun--;
        while (run_endColumn(runBase + 5 * nearbyRun) < column && nearbyRun + 1 < runCount)
          nearbyRun++;
        const run = runBase + 5 * nearbyRun;
        if (run_isSingleChunk(run) && column <= run_endColumn(run)) {
          if (
            (tabStopBehavior === "round" &&
              fractionalColumn >= (run_startColumn(run) + run_endColumn(run)) / 2) ||
            (tabStopBehavior === "floor" && fractionalColumn >= run_endColumn(run))
          ) {
            index = run_endIndex(run);
            column = run_endColumn(run);
          } else {
            index = run_startIndex(run);
            column = run_startColumn(run);
          }
        } else {
          index = run_startIndex(run) + column - run_startColumn(run);
        }
      }

      let firstMapping = 0;
      let mappingCount = mappings.length;
      while (mappingCount > 0) {
        const step = ((mappingCount / 6) >> 1) * 6;
        const it = firstMapping + step;
        const mappingLine = mappings[it + mappingsOffset];
        if (
          mappingLine < line ||
          (mappingLine === line && mappings[it + mappingsOffset + 1] < index)
        ) {
          firstMapping = it + 6;
          mappingCount -= step + 6;
        } else {
          mappingCount = step;
        }
      }

      if (
        firstMapping > 0 &&
        mappings[firstMapping - 6 + mappingsOffset] === line &&
        (firstMapping >= mappings.length ||
          mappings[firstMapping + mappingsOffset] > line ||
          mappings[firstMapping + mappingsOffset + 1] > index)
      ) {
        firstMapping -= 6;
      }

      const current = mappings[firstMapping + mappingsOffset + 1];
      while (
        firstMapping > 0 &&
        mappings[firstMapping - 6 + mappingsOffset] === line &&
        mappings[firstMapping - 6 + mappingsOffset + 1] === current
      ) {
        firstMapping -= 6;
      }

      const columnToIndex = (col: number) => {
        let idx = col;
        if (runCount > 0) {
          while (run_startColumn(runBase + 5 * nearbyRun) > col && nearbyRun > 0) nearbyRun--;
          while (run_endColumn(runBase + 5 * nearbyRun) < col && nearbyRun + 1 < runCount)
            nearbyRun++;
          const run = runBase + 5 * nearbyRun;
          idx =
            col === run_endColumn(run)
              ? run_endIndex(run)
              : run_startIndex(run) + col - run_startColumn(run);
        }
        return idx;
      };

      const indexToColumn = (idx: number) => {
        let col = idx;
        if (runCount > 0) {
          while (run_startIndex(runBase + 5 * nearbyRun) > idx && nearbyRun > 0) nearbyRun--;
          while (run_endIndex(runBase + 5 * nearbyRun) < idx && nearbyRun + 1 < runCount)
            nearbyRun++;
          const run = runBase + 5 * nearbyRun;
          col =
            idx === run_endIndex(run)
              ? run_endColumn(run)
              : run_startColumn(run) + idx - run_startIndex(run);
        }
        return col;
      };

      const rangeOfMapping = (map: number) => {
        if (mappings[map + mappingsOffset] !== line) return null;
        let startIndex = mappings[map + mappingsOffset + 1];
        let endIndex =
          startIndex > endOfLineIndex
            ? startIndex
            : hasTrailingNewline && startIndex < beforeNewlineIndex
              ? beforeNewlineIndex
              : endOfLineIndex;
        let isLastMappingInLine = false;

        if (
          map > 0 &&
          mappings[map - 6 + mappingsOffset] === line &&
          mappings[map - 6 + mappingsOffset + 1] === startIndex
        ) {
          return null;
        }

        while (
          map + 6 < mappings.length &&
          mappings[map + 6 + mappingsOffset] === line &&
          mappings[map + 6 + mappingsOffset + 1] === startIndex
        ) {
          map += 6;
        }

        if (map + 6 < mappings.length && mappings[map + 6 + mappingsOffset] === line) {
          endIndex = mappings[map + 6 + mappingsOffset + 1];
        } else if (endIndex === startIndex) {
          isLastMappingInLine = true;
        }

        return {
          startIndex,
          startColumn: indexToColumn(startIndex),
          endIndex,
          endColumn: indexToColumn(endIndex),
          isLastMappingInLine,
        };
      };

      return {
        raw,
        index,
        column,
        firstRun,
        runBase,
        runCount,
        runText,
        firstMapping,
        endOfLineIndex,
        endOfLineColumn,
        columnToIndex,
        indexToColumn,
        rangeOfMapping,
      };
    };

    const boxForRange = (
      dx: number,
      dy: number,
      columnWidth: number,
      range: { startColumn: number; endColumn: number },
    ): [number, number, number, number] => {
      const x1 = Math.round(dx + range.startColumn * columnWidth + 1);
      const x2 = Math.round(
        dx +
          (range.startColumn === range.endColumn
            ? range.startColumn * columnWidth + 4
            : range.endColumn * columnWidth) -
          1,
      );
      const y1 = Math.round(dy + 2);
      const y2 = Math.round(dy + this.rowHeight - 2);
      return [x1, y1, x2, y2];
    };

    const textArea: TextArea = {
      sourceIndex,
      bounds,

      updateAfterWrapChange: () => {
        scrollX = 0;
        computeScrollbarsAndClampScroll();
      },

      getHoverRect: () => {
        if (!this.hover?.mapping) return null;
        const lineIndex =
          sourceIndex === null ? this.hover.mapping.generatedLine : this.hover.mapping.originalLine;
        const index =
          sourceIndex === null
            ? this.hover.mapping.generatedColumn
            : this.hover.mapping.originalColumn;
        const column = analyzeLine(lineIndex, index, index, "floor").indexToColumn(index);
        const { firstMapping, rangeOfMapping } = analyzeLine(lineIndex, column, column, "floor");
        const range = rangeOfMapping(firstMapping);
        if (!range) return null;
        const { x, y } = bounds();
        const { columnWidth, columnsAcross, wrappedRows } = computeScrollbarsAndClampScroll();

        const rowDelta = this.wrap ? Math.floor(column / columnsAcross) : 0;
        const row = wrappedRows[lineIndex] + rowDelta;
        const dx = x - scrollX + this.margin + textPaddingX;
        const dy = y - scrollY + textPaddingY + row * this.rowHeight;

        let { startColumn, endColumn } = range;
        if (this.wrap) {
          const columnAdjustment = rowDelta * columnsAcross;
          startColumn -= columnAdjustment;
          endColumn -= columnAdjustment;
        }

        const [x1, y1, x2, y2] = boxForRange(dx, dy, columnWidth, {
          startColumn,
          endColumn,
        });
        return [x1, y1, x2 - x1, y2 - y1] as [number, number, number, number];
      },

      onwheel: (e: WheelEvent) => {
        const { x, y, width, height } = bounds();
        const rect = this.canvas?.getBoundingClientRect();
        const pageX = e.clientX - (rect?.left ?? 0);
        const pageY = e.clientY - (rect?.top ?? 0);
        if (pageX >= x && pageX < x + width && pageY >= y && pageY < y + height) {
          scrollX = Math.round(scrollX + e.deltaX);
          scrollY = Math.round(scrollY + e.deltaY);
          computeScrollbarsAndClampScroll();
          this.isInvalid = true;
          textArea.onmousemove(e as unknown as MouseEvent);
        }
      },

      onmousemove: (e: MouseEvent) => {
        const { x, y, width, height } = bounds();
        const rect = this.canvas?.getBoundingClientRect();
        const pageX = e.clientX - (rect?.left ?? 0);
        const pageY = e.clientY - (rect?.top ?? 0);

        if (
          pageX >= x + this.margin &&
          pageX < x + width - scrollbarThickness &&
          pageY >= y &&
          pageY < y + height
        ) {
          const { columnWidth, columnsAcross, wrappedRows } = computeScrollbarsAndClampScroll();
          let fractionalColumn = (pageX - x - this.margin - textPaddingX + scrollX) / columnWidth;
          let roundedColumn = Math.round(fractionalColumn);

          if (roundedColumn >= 0) {
            const row = Math.floor((pageY - y - textPaddingY + scrollY) / this.rowHeight);

            if (row >= 0) {
              const lineIndex = lineIndexForRow(wrappedRows, row);
              const firstColumn =
                this.wrap && lineIndex < wrappedRows.length
                  ? (row - wrappedRows[lineIndex]) * columnsAcross
                  : 0;
              fractionalColumn += firstColumn;
              roundedColumn += firstColumn;

              const flooredColumn = Math.floor(fractionalColumn);
              const { index: snappedRoundedIndex, column: snappedRoundedColumn } = analyzeLine(
                lineIndex,
                roundedColumn,
                fractionalColumn,
                "round",
              );
              const {
                index: snappedFlooredIndex,
                firstMapping,
                rangeOfMapping,
              } = analyzeLine(lineIndex, flooredColumn, fractionalColumn, "floor");

              let mapping = null;
              const range = rangeOfMapping(firstMapping);
              const lastColumn = firstColumn + columnsAcross;
              if (
                range !== null &&
                ((range.isLastMappingInLine && range.startIndex === snappedRoundedIndex) ||
                  (snappedFlooredIndex >= range.startIndex &&
                    snappedFlooredIndex < range.endIndex &&
                    range.startColumn < lastColumn &&
                    range.endColumn > firstColumn))
              ) {
                mapping = {
                  generatedLine: mappings[firstMapping],
                  generatedColumn: mappings[firstMapping + 1],
                  originalSource: mappings[firstMapping + 2],
                  originalLine: mappings[firstMapping + 3],
                  originalColumn: mappings[firstMapping + 4],
                  originalName: mappings[firstMapping + 5],
                };
              }

              this.hover = {
                sourceIndex,
                lineIndex,
                row,
                column: snappedRoundedColumn,
                index: snappedRoundedIndex,
                mapping,
              };
            }
          }
        }
      },

      onmousedown: (e: MouseEvent) => {
        const { x, y, width, height } = bounds();
        const rect = this.canvas?.getBoundingClientRect();
        const pageX = e.clientX - (rect?.left ?? 0);
        const pageY = e.clientY - (rect?.top ?? 0);
        const px = pageX - x;
        const py = pageY - y;

        if (px < 0 || py < 0 || px >= width || py >= height) return;
        const { maxScrollX, maxScrollY, scrollbarX, scrollbarY } =
          computeScrollbarsAndClampScroll();

        let mousemove: ((e: MouseEvent) => void) | null = null;
        if (scrollbarX && py > height - scrollbarThickness) {
          const originalScrollX = scrollX;
          mousemove = (e: MouseEvent) => {
            const newPageX = e.clientX - (rect?.left ?? 0);
            scrollX = Math.round(
              originalScrollX +
                ((newPageX - x - px) * maxScrollX) /
                  (scrollbarX.trackLength - scrollbarX.thumbLength),
            );
            computeScrollbarsAndClampScroll();
            this.isInvalid = true;
          };
        } else if (scrollbarY && px > width - scrollbarThickness) {
          const originalScrollY = scrollY;
          mousemove = (e: MouseEvent) => {
            const newPageY = e.clientY - (rect?.top ?? 0);
            scrollY = Math.round(
              originalScrollY +
                ((newPageY - y - py) * maxScrollY) /
                  (scrollbarY.trackLength - scrollbarY.thumbLength),
            );
            computeScrollbarsAndClampScroll();
            this.isInvalid = true;
          };
        } else {
          if (this.hover?.mapping) {
            if (sourceIndex !== null) {
              this.generatedTextArea?.scrollTo(
                this.hover.mapping.generatedColumn,
                this.hover.mapping.generatedLine,
              );
            } else {
              this.originalTextArea?.scrollTo(
                this.hover.mapping.originalColumn,
                this.hover.mapping.originalLine,
              );
            }
          }
          return;
        }

        const mouseup = () => {
          document.removeEventListener("mousemove", mousemove!);
          document.removeEventListener("mouseup", mouseup);
        };
        document.addEventListener("mousemove", mousemove);
        document.addEventListener("mouseup", mouseup);
        e.preventDefault();
      },

      scrollTo: (index: number, line: number) => {
        const start = Date.now();
        const startX = scrollX;
        const startY = scrollY;
        const { width, height } = bounds();
        const { columnWidth, columnsAcross, wrappedRows } = computeScrollbarsAndClampScroll();
        const { indexToColumn } = analyzeLine(line, index, index, "floor");
        const column = indexToColumn(index);
        const { firstMapping, rangeOfMapping } = analyzeLine(line, column, column, "floor");
        const range = rangeOfMapping(firstMapping);
        const targetColumn = range
          ? range.startColumn +
            Math.min(
              (range.endColumn - range.startColumn) / 2,
              (width - this.margin) / 4 / columnWidth,
            )
          : column;
        const endX = Math.max(
          0,
          Math.round(targetColumn * columnWidth - (width - this.margin) / 2),
        );
        const row = this.wrap ? wrappedRows[line] + Math.floor(column / columnsAcross) : line;
        const endY = Math.max(0, Math.round((row + 0.5) * this.rowHeight - height / 2));
        if (startX === endX && startY === endY) return;
        const duration = 250;
        animate = () => {
          this.isInvalid = true;
          const current = Date.now();
          let t = (current - start) / duration;
          if (t >= 1) {
            scrollX = endX;
            scrollY = endY;
            animate = null;
          } else {
            t *= t * (3 - 2 * t);
            scrollX = startX + (endX - startX) * t;
            scrollY = startY + (endY - startY) * t;
          }
        };
        animate();
      },

      draw: (bodyStyle: CSSStyleDeclaration) => {
        if (animate) animate();

        const { x, y, width, height } = bounds();
        const textColor = bodyStyle.color;
        const backgroundColor = bodyStyle.backgroundColor;
        const {
          columnWidth,
          columnsAcross,
          wrappedRows,
          maxScrollX,
          maxScrollY,
          scrollbarX,
          scrollbarY,
        } = computeScrollbarsAndClampScroll();

        const firstColumn = Math.max(0, Math.floor((scrollX - textPaddingX) / columnWidth));
        const lastColumn = Math.max(
          0,
          Math.ceil(
            (scrollX - textPaddingX + width - this.margin - (this.wrap ? scrollbarThickness : 0)) /
              columnWidth,
          ),
        );
        const firstRow = Math.max(0, Math.floor((scrollY - textPaddingY) / this.rowHeight));
        const lastRow = Math.max(0, Math.ceil((scrollY - textPaddingY + height) / this.rowHeight));
        const firstLineIndex = lineIndexForRow(wrappedRows, firstRow);

        const hoverBoxes: { color: number; rect: [number, number, number, number] }[] = [];
        const hoveredMapping = this.hover?.mapping ?? null;
        const mappingBatches: number[][] = [];
        const badMappingBatches: number[][] = [];
        const whitespaceBatch: (string | number)[] = [];
        const textBatch: (string | number)[] = [];
        let hoveredName: { text: string; x: number; y: number } | null = null;
        let lineIndex = firstLineIndex;
        let lineRow = wrappedRows[lineIndex];

        for (let i = 0; i < this.originalLineColors.length; i++) {
          mappingBatches.push([]);
          badMappingBatches.push([]);
        }

        const drawRow = (
          dx: number,
          dy: number,
          lineIdx: number,
          firstCol: number,
          lastCol: number,
        ) => {
          const {
            raw,
            firstRun,
            runBase,
            runCount,
            runText,
            firstMapping: fm,
            endOfLineColumn,
            rangeOfMapping,
            columnToIndex,
          } = analyzeLine(lineIdx, firstCol, firstCol, "floor");
          const lastIndex = columnToIndex(lastCol);

          if (firstRun < runCount) {
            let lastRun = firstRun;
            while (
              lastRun + 1 < runCount &&
              run_startColumn(runBase + 5 * (lastRun + 1)) < lastCol
            ) {
              lastRun++;
            }

            const dyForText = dy + 0.7 * this.rowHeight;
            let currentColumn = firstCol;
            for (let i = firstRun; i <= lastRun; i++) {
              const run = runBase + 5 * i;
              let startColumn = run_startColumn(run);
              let endColumn = run_endColumn(run);
              const whitespace = run_whitespace(run);
              let text = runText[i];

              if (text === undefined) {
                text = runText[i] = !whitespace
                  ? raw.slice(run_startIndex(run), run_endIndex(run))
                  : whitespace === 0x20
                    ? "\u00B7".repeat(run_endIndex(run) - run_startIndex(run))
                    : whitespace === 0x0a
                      ? lineIdx === lines.length - 1
                        ? "\u2205"
                        : "\u21B5"
                      : "\u2192";
              }

              if (!run_isSingleChunk(run)) {
                if (startColumn < currentColumn) {
                  text = text.slice(currentColumn - startColumn);
                  startColumn = currentColumn;
                }
                if (endColumn > lastCol) {
                  text = text.slice(0, lastCol - startColumn);
                  endColumn = lastCol;
                }
              }

              (whitespace ? whitespaceBatch : textBatch).push(
                text,
                dx + startColumn * columnWidth,
                dyForText,
              );
              currentColumn = endColumn;
            }
          }

          for (let map = fm; map < mappings.length; map += 6) {
            if (
              mappings[map + mappingsOffset] !== lineIdx ||
              mappings[map + mappingsOffset + 1] >= lastIndex
            )
              break;
            if (mappings[map + 2] === -1) continue;

            const range = rangeOfMapping(map);
            if (range === null) continue;
            const { startColumn, endColumn } = range;
            const color = mappings[map + 3] % this.originalLineColors.length;
            const [x1, y1, x2, y2] = boxForRange(dx, dy, columnWidth, range);

            let isHovered = false;
            if (hoveredMapping) {
              const isGenerated = sourceIndex === null;
              const hoverIsGenerated = this.hover!.sourceIndex === null;
              const matchesGenerated =
                mappings[map] === hoveredMapping.generatedLine &&
                mappings[map + 1] === hoveredMapping.generatedColumn;
              const matchesOriginal =
                mappings[map + 2] === hoveredMapping.originalSource &&
                mappings[map + 3] === hoveredMapping.originalLine &&
                mappings[map + 4] === hoveredMapping.originalColumn;
              isHovered =
                isGenerated !== hoverIsGenerated
                  ? matchesGenerated || matchesOriginal
                  : isGenerated
                    ? matchesGenerated
                    : matchesOriginal;
              if (
                isGenerated &&
                matchesGenerated &&
                hoveredMapping.originalName !== -1 &&
                !hoveredName
              ) {
                hoveredName = {
                  text: originalName(hoveredMapping.originalName),
                  x: Math.round(dx + range.startColumn * columnWidth - hoverBoxLineThickness),
                  y: Math.round(dy + 1.2 * this.rowHeight),
                };
              }
            }

            if (isHovered) {
              hoverBoxes.push({
                color,
                rect: [x1 - 2, y1 - 2, x2 - x1 + 4, y2 - y1 + 4],
              });
            } else if (lineIdx >= lines.length || startColumn > endOfLineColumn) {
              badMappingBatches[color].push(x1, y1, x2 - x1, y2 - y1);
            } else if (endColumn > endOfLineColumn) {
              const x12 = Math.round(x1 + (endOfLineColumn - startColumn) * columnWidth);
              mappingBatches[color].push(x1, y1, x12 - x1, y2 - y1);
              badMappingBatches[color].push(x12, y1, x2 - x12, y2 - y1);
            } else {
              mappingBatches[color].push(x1, y1, x2 - x1, y2 - y1);
            }
          }
        };

        for (let row = firstRow; row <= lastRow; row++) {
          const dx = x - scrollX + this.margin + textPaddingX;
          const dy = y - scrollY + textPaddingY + row * this.rowHeight;
          const columnAdjustment = this.wrap ? (row - lineRow) * columnsAcross : 0;
          drawRow(
            dx - columnAdjustment * columnWidth,
            dy,
            lineIndex,
            columnAdjustment + firstColumn,
            columnAdjustment + Math.max(firstColumn + 1, lastColumn - 1),
          );
          if (lineIndex + 1 >= wrappedRows.length) {
            lineIndex++;
            lineRow++;
          } else if (row + 1 >= wrappedRows[lineIndex + 1]) {
            lineIndex++;
            lineRow = wrappedRows[lineIndex];
          }
        }

        c.save();
        c.beginPath();
        c.rect(x, y, width, height);
        c.clip();

        // Draw mappings
        for (let i = 0; i < mappingBatches.length; i++) {
          let batch = mappingBatches[i];
          if (batch.length > 0) {
            c.fillStyle = this.originalLineColors[i];
            for (let j = 0; j < batch.length; j += 4) {
              c.fillRect(batch[j], batch[j + 1], batch[j + 2], batch[j + 3]);
            }
          }
          batch = badMappingBatches[i];
          if (batch.length > 0) {
            c.fillStyle = this.originalLineColors[i].replace(" 0.3)", " 0.15)");
            for (let j = 0; j < batch.length; j += 4) {
              c.fillRect(batch[j], batch[j + 1], batch[j + 2], batch[j + 3]);
            }
          }
        }

        // Draw hover boxes
        if (hoverBoxes.length > 0) {
          c.shadowBlur = 20;
          c.fillStyle = "black";
          for (const {
            rect: [rx, ry, rw, rh],
            color,
          } of hoverBoxes) {
            c.shadowColor = this.originalLineColors[color].replace(" 0.3)", " 1)");
            c.fillRect(rx - 1, ry - 1, rw + 2, rh + 2);
          }
          c.shadowColor = "transparent";

          for (const {
            rect: [rx, ry, rw, rh],
          } of hoverBoxes) {
            c.clearRect(rx, ry, rw, rh);
          }
          c.strokeStyle = textColor;
          c.lineWidth = hoverBoxLineThickness;
          for (const {
            rect: [rx, ry, rw, rh],
          } of hoverBoxes) {
            c.strokeRect(rx, ry, rw, rh);
          }
          for (const {
            rect: [rx, ry, rw, rh],
          } of hoverBoxes) {
            c.clearRect(rx + 2, ry + 1, rw - 4, rh - 2);
          }
        } else if (this.hover && this.hover.sourceIndex === sourceIndex) {
          const column =
            this.hover.column -
            (this.wrap && this.hover.lineIndex < wrappedRows.length
              ? columnsAcross * (this.hover.row - wrappedRows[this.hover.lineIndex])
              : 0);
          const caretX = Math.round(
            x - scrollX + this.margin + textPaddingX + column * columnWidth,
          );
          const caretY = Math.round(y - scrollY + textPaddingY + this.hover.row * this.rowHeight);
          c.fillStyle = textColor;
          c.globalAlpha = 0.5;
          c.fillRect(caretX, caretY, 1, this.rowHeight);
          c.globalAlpha = 1;
        }

        // Draw text
        const wrapLeft = x + this.margin + textPaddingX;
        const wrapRight = wrapLeft + columnsAcross * columnWidth;
        c.textBaseline = "alphabetic";
        c.textAlign = "left";
        c.font = this.monospaceFont;

        if (this.wrap) {
          c.save();
          c.beginPath();
          c.rect(wrapLeft, y, wrapRight - wrapLeft, height);
          c.clip();
        }

        if (whitespaceBatch.length > 0) {
          c.fillStyle = "rgba(150, 150, 150, 0.4)";
          for (let j = 0; j < whitespaceBatch.length; j += 3) {
            c.fillText(
              whitespaceBatch[j] as string,
              whitespaceBatch[j + 1] as number,
              whitespaceBatch[j + 2] as number,
            );
          }
        }
        if (textBatch.length > 0) {
          c.fillStyle = textColor;
          for (let j = 0; j < textBatch.length; j += 3) {
            c.fillText(
              textBatch[j] as string,
              textBatch[j + 1] as number,
              textBatch[j + 2] as number,
            );
          }
        }

        if (this.wrap) {
          c.restore();
        }

        // Draw hovered name tooltip
        if (hoveredName) {
          const { text: nameText, x: nameX, y: nameY } = hoveredName;
          const w = 2 * textPaddingX + c.measureText(nameText).width;
          const h = this.rowHeight;
          const r = 4;
          c.beginPath();
          c.arc(nameX + r, nameY + r, r, -Math.PI, -Math.PI / 2, false);
          c.arc(nameX + w - r, nameY + r, r, -Math.PI / 2, 0, false);
          c.arc(nameX + w - r, nameY + h - r, r, 0, Math.PI / 2, false);
          c.arc(nameX + r, nameY + h - r, r, Math.PI / 2, Math.PI, false);
          c.save();
          c.shadowColor = "rgba(0, 0, 0, 0.5)";
          c.shadowOffsetY = 3;
          c.shadowBlur = 10;
          c.fillStyle = textColor;
          c.fill();
          c.restore();
          c.fillStyle = backgroundColor;
          c.fillText(nameText, nameX + textPaddingX, nameY + 0.7 * this.rowHeight);
        }

        // Draw margin
        c.fillStyle = backgroundColor;
        c.fillRect(x, y, this.margin, height);
        c.fillStyle = "rgba(127, 127, 127, 0.1)";
        c.fillRect(x, y, this.margin, height);
        c.fillStyle = "rgba(127, 127, 127, 0.5)";
        c.fillRect(x + this.margin - 1, y, 1, height);
        c.textAlign = "right";
        c.fillStyle = textColor;
        c.font = "11px monospace";
        for (let i = firstLineIndex, n = wrappedRows.length; i <= lastLineIndex; i++) {
          const row = i < n ? wrappedRows[i] : wrappedRows[n - 1] + (i - (n - 1));
          if (row > lastRow) break;
          const lineDx = x + this.margin - textPaddingX;
          const lineDy = y - scrollY + textPaddingY + (row + 0.6) * this.rowHeight;
          c.globalAlpha = i < lines.length ? 0.625 : 0.25;
          c.fillText((i + 1).toString(), lineDx, lineDy);
        }
        c.font = this.monospaceFont;
        c.globalAlpha = 1;

        // Draw scrollbars
        if (scrollbarX) {
          const sbdx =
            x +
            this.margin +
            (scrollX / maxScrollX) * (scrollbarX.trackLength - scrollbarX.thumbLength);
          const sbdy = y + height - scrollbarThickness;
          c.fillStyle = "rgba(127, 127, 127, 0.5)";
          c.beginPath();
          c.arc(
            sbdx + scrollbarThickness / 2,
            sbdy + scrollbarThickness / 2,
            scrollbarThickness / 4,
            Math.PI / 2,
            (Math.PI * 3) / 2,
            false,
          );
          c.arc(
            sbdx + scrollbarX.thumbLength - scrollbarThickness / 2,
            sbdy + scrollbarThickness / 2,
            scrollbarThickness / 4,
            -Math.PI / 2,
            Math.PI / 2,
            false,
          );
          c.fill();
        }
        if (scrollbarY) {
          const sbdx = x + width - scrollbarThickness;
          const sbdy =
            y + (scrollY / maxScrollY) * (scrollbarY.trackLength - scrollbarY.thumbLength);
          c.fillStyle = "rgba(127, 127, 127, 0.5)";
          c.beginPath();
          c.arc(
            sbdx + scrollbarThickness / 2,
            sbdy + scrollbarThickness / 2,
            scrollbarThickness / 4,
            -Math.PI,
            0,
            false,
          );
          c.arc(
            sbdx + scrollbarThickness / 2,
            sbdy + scrollbarY.thumbLength - scrollbarThickness / 2,
            scrollbarThickness / 4,
            0,
            Math.PI,
            false,
          );
          c.fill();
        }

        c.restore();
      },
    };

    return textArea;
  }

  private async splitTextIntoLinesAndRuns(text: string) {
    const c = this.ctx!;
    c.font = this.monospaceFont;
    const spaceWidth = c.measureText(" ").width;
    const spacesPerTab = 2;
    const parts = text.split(/(\r\n|\r|\n)/g);
    const unicodeWidthCache = new Map<string, number>();
    const lines: {
      raw: string;
      runBase: number;
      runCount: number;
      runText: Record<number, string>;
      endIndex: number;
      endColumn: number;
    }[] = [];
    let longestColumnForLine = new Int32Array(1024);
    let runData = new Int32Array(1024);
    let runDataLength = 0;
    let longestLineInColumns = 0;
    let lineStartOffset = 0;

    for (let part = 0; part < parts.length; part++) {
      const raw = parts[part];
      if (part & 1) {
        lineStartOffset += raw.length;
        continue;
      }

      const runBase = runDataLength;
      const n = raw.length + 1;
      let i = 0;
      let column = 0;

      while (i < n) {
        const startIndex = i;
        const startColumn = column;
        let whitespace = 0;
        let isSingleChunk = false;

        while (i < n) {
          let c1 = raw.charCodeAt(i);
          let c2;

          if (c1 === 0x09) {
            if (i > startIndex) break;
            isSingleChunk = true;
            column += spacesPerTab;
            column -= column % spacesPerTab;
            i++;
            whitespace = c1;
            break;
          }

          if (c1 !== c1) {
            if (i > startIndex) break;
            isSingleChunk = true;
            column++;
            i++;
            whitespace = 0x0a;
            break;
          }

          if (c1 < 0x20 || c1 > 0x7e) {
            if (i > startIndex) break;
            isSingleChunk = true;
            i++;

            if (
              i < n &&
              c1 >= 0xd800 &&
              c1 <= 0xdbff &&
              (c2 = raw.charCodeAt(i)) >= 0xdc00 &&
              c2 <= 0xdfff
            ) {
              i++;
            }

            while (i < n) {
              c1 = raw.charCodeAt(i);

              if ((c1 & ~0xf) === 0xfe00) {
                i++;
              } else if (
                c1 === 0xd83c &&
                i + 1 < n &&
                (c2 = raw.charCodeAt(i + 1)) >= 0xdffb &&
                c2 <= 0xdfff
              ) {
                i += 2;
              } else if (c1 === 0x200c) {
                i++;
                break;
              } else if (c1 === 0x200d) {
                i++;
                if (i < n) {
                  c1 = raw.charCodeAt(i);
                  i++;
                  if (
                    c1 >= 0xd800 &&
                    c1 <= 0xdbff &&
                    i < n &&
                    (c2 = raw.charCodeAt(i)) >= 0xdc00 &&
                    c2 <= 0xdfff
                  ) {
                    i++;
                  }
                }
              } else {
                break;
              }
            }

            const key = raw.slice(startIndex, i);
            let width = unicodeWidthCache.get(key);
            if (width === undefined) {
              width = Math.round(c.measureText(key).width / spaceWidth);
              if (width < 1) width = 1;
              unicodeWidthCache.set(key, width);
            }
            column += width;
            break;
          }

          if (c1 === 0x20) {
            if (i === startIndex) whitespace = c1;
            else if (!whitespace) break;
          } else {
            if (whitespace) break;
          }

          column++;
          i++;
        }

        if (runDataLength + 5 > runData.length) {
          const newData = new Int32Array(runData.length << 1);
          newData.set(runData);
          runData = newData;
        }
        runData[runDataLength] = whitespace | (isSingleChunk ? 0x100 : 0);
        runData[runDataLength + 1] = startIndex;
        runData[runDataLength + 2] = i;
        runData[runDataLength + 3] = startColumn;
        runData[runDataLength + 4] = column;
        runDataLength += 5;
      }

      const lineIndex = lines.length;
      if (lineIndex >= longestColumnForLine.length) {
        const newData = new Int32Array(longestColumnForLine.length << 1);
        newData.set(longestColumnForLine);
        longestColumnForLine = newData;
      }
      longestColumnForLine[lineIndex] = column;

      const runCount = (runDataLength - runBase) / 5;
      lines.push({
        raw,
        runBase,
        runCount,
        runText: {},
        endIndex: i,
        endColumn: column,
      });
      longestLineInColumns = Math.max(longestLineInColumns, column);
      lineStartOffset += raw.length;
    }

    return {
      lines,
      longestColumnForLine,
      longestLineInColumns,
      runData: runData.subarray(0, runDataLength),
    };
  }

  private handleSourceChange(e: Event) {
    const select = e.target as HTMLSelectElement;
    this.selectedSource = select.selectedIndex;

    if (this.parsedSourceMap && this.parsedSourceMap.sources[this.selectedSource]) {
      const source = this.parsedSourceMap.sources[this.selectedSource];
      this.createTextArea({
        sourceIndex: this.selectedSource,
        text: source.content,
        mappings: source.data,
        mappingsOffset: 3,
        otherSource: (index) => (index === -1 ? null : this.parsedSourceMap!.sources[index].name),
        originalName: (index) => this.parsedSourceMap!.names[index],
        bounds: () => {
          const rect = this.canvas?.parentElement?.getBoundingClientRect();
          const width = rect?.width ?? 0;
          const height = rect?.height ?? 0;
          return {
            x: 0,
            y: this.toolbarHeight,
            width: (width >>> 1) - (this.splitterWidth >> 1),
            height: height - this.toolbarHeight - this.statusBarHeight,
          };
        },
      }).then((textArea) => {
        this.originalTextArea = textArea;
        this.isInvalid = true;
      });
    }
  }

  private handleWrapChange(e: Event) {
    const checkbox = e.target as HTMLInputElement;
    this.wrap = checkbox.checked;
    this.originalTextArea?.updateAfterWrapChange();
    this.generatedTextArea?.updateAfterWrapChange();
    this.isInvalid = true;
  }

  render() {
    return html`
      <div class="container">
        <canvas></canvas>

        <div class="toolbar">
          <div class="toolbar-section">
            <span class="toolbar-label">Original code</span>
            ${
              this.parsedSourceMap && this.parsedSourceMap.sources.length > 0
                ? html`
                  <select
                    class="file-select"
                    @change=${this.handleSourceChange}
                  >
                    ${this.parsedSourceMap.sources.map(
                      (s, i) => html`<option value=${i}>${i}: ${s.name}</option>`,
                    )}
                  </select>
                `
                : html`<span style="color: #666; font-size: 12px;"
                  >(no original code)</span
                >`
            }
          </div>
          <div class="toolbar-section">
            <span class="toolbar-label">Generated code</span>
            <label class="wrap-label">
              <input
                type="checkbox"
                .checked=${this.wrap}
                @change=${this.handleWrapChange}
              />
              Wrap
            </label>
          </div>
        </div>

        ${this.loading ? html`<div class="loading">Loading...</div>` : ""}
        ${this.error ? html`<div class="error">${this.error}</div>` : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "source-map-visualizer": SourceMapVisualizer;
  }
}
