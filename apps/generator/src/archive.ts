import { FetchSource, PMTiles, type RangeResponse } from "pmtiles";

export const NETWORK_TIMEOUT_MS = 20_000;

export function networkSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(NETWORK_TIMEOUT_MS);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

/** One cache per operation: failed/aborted header promises never poison retries. */
export function createArchive(url: string, operationSignal?: AbortSignal): PMTiles {
  class OperationSource extends FetchSource {
    override getBytes(offset: number, length: number, signal?: AbortSignal, etag?: string): Promise<RangeResponse> {
      const signals = [operationSignal, signal].filter((item): item is AbortSignal => !!item);
      const bounded = networkSignal(signals.length ? AbortSignal.any(signals) : undefined);
      bounded.throwIfAborted();
      // Includes headers, directories, and response bodies, even when PMTiles
      // does not forward the caller's signal to a shared cache request.
      return super.getBytes(offset, length, bounded, etag);
    }
  }
  return new PMTiles(new OperationSource(url));
}
