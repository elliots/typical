/**
 * Performance instrumentation for tracking build times
 */
export class BuildTimer {
  private timings = new Map<string, number[]>()
  private starts = new Map<string, number>()

  start(stage: string): void {
    this.starts.set(stage, performance.now())
  }

  end(stage: string): void {
    const start = this.starts.get(stage)
    if (start !== undefined) {
      const duration = performance.now() - start
      const existing = this.timings.get(stage) ?? []
      existing.push(duration)
      this.timings.set(stage, existing)
      this.starts.delete(stage)
    }
  }

  reset(): void {
    this.timings.clear()
    this.starts.clear()
  }

  report(): void {
    console.log('\n[unplugin-typical] Build Performance Report:')
    console.log('─'.repeat(60))

    // Sort stages by total time (descending) for better readability
    const sortedStages = Array.from(this.timings.entries()).sort(([, a], [, b]) => b.reduce((x, y) => x + y, 0) - a.reduce((x, y) => x + y, 0))

    let totalTime = 0
    for (const [stage, times] of sortedStages) {
      const total = times.reduce((a, b) => a + b, 0)
      const avg = total / times.length
      const min = Math.min(...times)
      const max = Math.max(...times)
      const count = times.length
      totalTime += total

      console.log(`${stage}:`)
      console.log(`  Count: ${count}`)
      console.log(`  Total: ${total.toFixed(2)}ms`)
      console.log(`  Avg:   ${avg.toFixed(2)}ms`)
      console.log(`  Min:   ${min.toFixed(2)}ms`)
      console.log(`  Max:   ${max.toFixed(2)}ms`)
    }

    console.log('─'.repeat(60))
    console.log(`Total transform time: ${totalTime.toFixed(2)}ms`)
    console.log('')
  }

  getTimings(): Map<string, { count: number; total: number; avg: number; min: number; max: number }> {
    const result = new Map()
    for (const [stage, times] of this.timings) {
      const total = times.reduce((a, b) => a + b, 0)
      result.set(stage, {
        count: times.length,
        total,
        avg: total / times.length,
        min: Math.min(...times),
        max: Math.max(...times),
      })
    }
    return result
  }
}

// Singleton instance for use across the plugin
export const buildTimer = new BuildTimer()
