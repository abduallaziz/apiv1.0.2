import { ITransport } from '../adapter.types';

// Test-only implementation of ITransport — simulates a hardware
// connection in memory so the Adapter Framework's contract (connect ->
// receive -> produce ScanEvent) can be exercised without physical
// hardware. Never used in production code paths.
export class MockTransport implements ITransport {
  private open_ = false;
  private handler: ((chunk: string) => void) | null = null;
  public failOnOpen = false;

  open(): Promise<void> {
    if (this.failOnOpen)
      return Promise.reject(new Error('simulated connection failure'));
    this.open_ = true;
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.open_ = false;
    return Promise.resolve();
  }

  isOpen(): boolean {
    return this.open_;
  }

  onData(handler: (chunk: string) => void): void {
    this.handler = handler;
  }

  // Test helper — simulates the hardware pushing a raw chunk.
  emit(chunk: string): void {
    this.handler?.(chunk);
  }
}
