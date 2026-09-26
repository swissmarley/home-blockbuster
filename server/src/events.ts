import { EventEmitter } from 'node:events';
import type { ScanProgress, ServerEvent } from './shared/types.js';

/** Fan-out of server events to SSE clients, with throttling for chatty event types. */
export class EventBus {
  private readonly emitter = new EventEmitter();
  private libraryTimer: NodeJS.Timeout | null = null;
  private librariesTimer: NodeJS.Timeout | null = null;
  private scanTimer: NodeJS.Timeout | null = null;
  private pendingScan: ScanProgress | null = null;
  private lastScanEmit = 0;

  constructor() {
    this.emitter.setMaxListeners(0);
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  emit(event: ServerEvent): void {
    this.emitter.emit('event', event);
  }

  /** Titles/files changed. Coalesced to at most one event per 1.5 s. */
  libraryChanged(): void {
    if (this.libraryTimer) return;
    this.libraryTimer = setTimeout(() => {
      this.libraryTimer = null;
      this.emit({ type: 'library', at: Date.now() });
    }, 1500);
  }

  /** Library list / status changed. */
  librariesChanged(): void {
    if (this.librariesTimer) return;
    this.librariesTimer = setTimeout(() => {
      this.librariesTimer = null;
      this.emit({ type: 'libraries', at: Date.now() });
    }, 250);
  }

  /** Scan progress, throttled to ~4 events per second (the final state is always delivered). */
  scanProgress(progress: ScanProgress): void {
    this.pendingScan = { ...progress, queue: [...progress.queue] };
    const now = Date.now();
    const wait = Math.max(0, 250 - (now - this.lastScanEmit));
    if (this.scanTimer) return;
    this.scanTimer = setTimeout(() => {
      this.scanTimer = null;
      this.lastScanEmit = Date.now();
      if (this.pendingScan) this.emit({ type: 'scan', progress: this.pendingScan });
      this.pendingScan = null;
    }, wait);
  }
}
