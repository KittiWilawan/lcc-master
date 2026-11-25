import limits from '../config/bodyScan.json';
import type { Body } from './bodyPose';

export interface EnrollmentFrame { id: number; jpeg: string }

// At most one frame is awaited. A response from a retired camera cannot settle a new request.
export class EnrollmentFrameRequest {
  private sequence = 0;
  private current?: { id: number; finish: (bodies: Body[] | null) => void };
  constructor(private readonly publish: (frame: EnrollmentFrame) => void) {}

  analyze(jpeg: string, signal: AbortSignal): Promise<Body[]> {
    if (signal.aborted) return Promise.reject(new Error('Scan ended'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => this.receive(id, null), limits.analysisTimeoutMs);
      const abort = () => {
        clearTimeout(timeout);
        if (this.current?.id === id) this.current = undefined;
        reject(new Error('Scan ended'));
      };
      const finish = (bodies: Body[] | null) => {
        clearTimeout(timeout);
        signal.removeEventListener('abort', abort);
        this.current = undefined;
        if (bodies === null) reject(new Error('Cannot analyze frame'));
        else resolve(bodies);
      };
      this.current?.finish(null);
      this.current = { id, finish };
      signal.addEventListener('abort', abort, { once: true });
      this.publish({ id, jpeg });
    });
  }

  receive(id: number, bodies: Body[] | null) {
    if (this.current?.id !== id) return false;
    this.current.finish(bodies);
    return true;
  }
}
