import "server-only";
import { Transform, type TransformCallback } from "node:stream";
import { MS } from "@/config/policy";

/**
 * Passes bytes through at most `bytesPerSecond` (the "Busy · slower downloads" level when
 * Nginx is not serving files; with Nginx, X-Accel-Limit-Rate does the same).
 */
export class Throttle extends Transform {
  private readonly started = Date.now();
  private sent = 0;

  constructor(private readonly bytesPerSecond: number) {
    super();
  }

  override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
    this.sent += chunk.length;
    const due = this.started + (this.sent / this.bytesPerSecond) * MS.second;
    const wait = Math.max(0, due - Date.now());
    setTimeout(() => done(null, chunk), wait);
  }
}
