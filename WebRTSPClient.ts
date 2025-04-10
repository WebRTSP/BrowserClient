import { AsyncWebSocket } from "./helpers/AsyncWebSocket"

export namespace WebRTSP {

export class Client {
  #socket: AsyncWebSocket

  constructor(url: string) {
    this.#socket = new AsyncWebSocket(url)
    this.#socket.onMessage = (message) => { this.#onMessage(message) }
    this.#socket.onDisconnect = () => { this.#onDisconnect() }
  }

  #onMessage(message: unknown) {
  }

  #onDisconnect() {
  }

  connect() {
    this.#socket.connect()
  }
}

}