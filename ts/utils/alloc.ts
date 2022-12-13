const POOL_SIZE = 8192;

let poolSize: number, poolOffset: number, allocPool: ArrayBuffer;

function createPool() {
  poolSize = POOL_SIZE;
  allocPool = new ArrayBuffer(poolSize);
  poolOffset = 0;
}
createPool();

/**
 * Allocate a new buffer of the given size.
 *
 * @param size Size of the buffer in bytes.
 */
export function alloc(size: number): Uint8Array {
  if (size <= 0) {
    return new Uint8Array(0);
  }

  if (size < POOL_SIZE >>> 1) {
    if (size > poolSize - poolOffset) {
      createPool();
    }

    const buf = new Uint8Array(allocPool, poolOffset, size);
    poolOffset += size;

    // Ensure that the pool is aligned to 8 bytes.
    if (poolOffset & 0x7) {
      poolOffset |= 0x7;
      poolOffset++;
    }

    return buf;
  }

  return new Uint8Array(size);
}
