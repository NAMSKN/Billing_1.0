import type { IpcResult, IpcError } from '@shared/ipc';

/**
 * Thin wrapper that unwraps the IpcResult envelope from window.api calls,
 * throwing a typed ApiError on failure so screens can use async/await and
 * try/catch naturally. Field-level issues (validation) are preserved.
 */
export class ApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly issues?: IpcError['issues'],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function unwrap<T>(promise: Promise<IpcResult<unknown>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.data as T;
  throw new ApiError(result.error.code, result.error.message, result.error.issues);
}
