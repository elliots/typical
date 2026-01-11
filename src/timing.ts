/**
 * Simple build timing utility for debugging performance.
 */

export class BuildTimer {
  private timings: Map<string, { start: number; total: number; count: number }> = new Map()

  /**
   * Reset all timing data.
   */
  reset(): void {
    this.timings.clear()
  }

  /**
   * Start timing a named section.
   */
  start(name: string): void {
    const existing = this.timings.get(name)
    if (existing) {
      existing.start = performance.now()
    } else {
      this.timings.set(name, { start: performance.now(), total: 0, count: 0 })
    }
  }

  /**
   * End timing a named section.
   */
  end(name: string): void {
    const timing = this.timings.get(name)
    if (timing && timing.start > 0) {
      timing.total += performance.now() - timing.start
      timing.count++
      timing.start = 0
    }
  }

  /**
   * Print a timing report to console.
   */
  report(prefix: string = '[typical]'): void {
    if (this.timings.size === 0) {
      return
    }

    console.log(`${prefix} Timing report:`)
    for (const [name, timing] of this.timings) {
      const avg = timing.count > 0 ? timing.total / timing.count : 0
      console.log(`  ${name}: ${timing.total.toFixed(2)}ms total, ${timing.count} calls, ${avg.toFixed(2)}ms avg`)
    }
  }
}

/**
 * Shared build timer instance.
 */
export const buildTimer = new BuildTimer()
