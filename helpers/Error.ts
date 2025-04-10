export class InvalidStateError implements Error {
  name: string
  message: string

  constructor(message: string) {
    this.name = this.constructor.name
    this.message = message
  }
}
