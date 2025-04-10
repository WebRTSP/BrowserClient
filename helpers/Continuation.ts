export class Continuation<T = void> {
  resume: (value: T) => void
  resumeWithError: (error: unknown) => void

  constructor(
    resolve: (value: T) => void,
    reject: (reason: unknown) => void) 
  {
    this.resume = resolve
    this.resumeWithError = reject
  }
}

export function withContinuation<T = void>(executor: (continuation: Continuation<T>) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const continuation = new Continuation<T>(resolve, reject)
    executor(continuation)
  })
}
