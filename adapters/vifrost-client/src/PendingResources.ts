const DEFAULT_DEBOUNCE_MS = 50

/**
 * Collects the resources whose records changed and hands them over together once no more
 * changes arrive for a moment, so a burst of events refreshes each watched query once.
 */
export class PendingResources {
  private resources = new Set<string>()
  private timer: ReturnType<typeof setTimeout> | null = null

  /**
   * @param {(resources: Set<string>) => Promise<void>} onFlush receives the resources that changed
   * @param {number} [debounceMs] milliseconds to wait for more changes
   */
  constructor(
    private readonly onFlush: (resources: Set<string>) => Promise<void>,
    private readonly debounceMs = DEFAULT_DEBOUNCE_MS
  ) {}

  /**
   * @param {string} resource
   * @returns {void}
   */
  add(resource: string): void {
    this.resources.add(resource)
    if (this.timer !== null) {
      return
    }
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, this.debounceMs)
  }

  /**
   * Hands over the collected resources now instead of waiting.
   *
   * @returns {Promise<void>}
   */
  async flush(): Promise<void> {
    this.clearTimer()
    const resources = this.resources
    this.resources = new Set()
    await this.onFlush(resources)
  }

  /**
   * Forgets the collected resources without handing them over.
   *
   * @returns {void}
   */
  dispose(): void {
    this.clearTimer()
    this.resources = new Set()
  }

  /**
   * @returns {void}
   */
  private clearTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }
}
