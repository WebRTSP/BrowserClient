import { InvalidStateError } from "./Error"
import Log from "./Log"

const LP = "[AsyncWebSocket]"

export enum AsyncWebSocketState {
  Disconnected,
  Connecting,
  Connected,
  Disconnecting,
}

import State = AsyncWebSocketState

export class AsyncWebSocket {
  #state = State.Disconnected
  #url: string
  #socket: WebSocket | null = null
  #keepConnection = false
  #reconnectTimeoutId: number | null = null

  #messageHandler: ((message: unknown) => void) | null = null
  #disconnectHandler: (() => void) | null = null

  get state() {
    return this.#state
  }

  set onMessage(handler: (message: unknown) => void | null) {
    this.#messageHandler = handler
  }
  set onDisconnect(handler: () => void | null) {
    this.#disconnectHandler = handler
  }


  constructor(url: string) {
    this.#url = url
  }

  #onSocketOpen(socket: WebSocket) {
    this.#state = State.Connected
    Log.info(LP, "Connected")
  }

  #onSocketError(socket: WebSocket, event: Event) {
    Log.error(LP, event)
  }

  #onSocketClose(socket: WebSocket, event: CloseEvent) {
    this.#state = State.Disconnected
    this.#socket = null

    if(this.#disconnectHandler) {
      this.#disconnectHandler() // FIXME? setTimeout(() => { this.#disconnectHandler() }, 0)
    }

    this.#scheduleReconnect()
  }

  #onSocketMessage(socket: WebSocket, event: MessageEvent) {
    if(this.#messageHandler) {
      this.#messageHandler(event.data)
    }
  }

  #scheduleReconnect() {
    if(!this.#keepConnection) {
      return
    }

    if(this.#reconnectTimeoutId) {
      return
    }

    const reconnectTimout = Math.floor(1000 + 4000 * Math.random())
    this.#reconnectTimeoutId = setTimeout(() => {
        this.#reconnectTimeoutId = null
        if(!this.#keepConnection) {
          return
        }
        if(this.#state == State.Disconnected) {
          this.connect()
        }
    }, reconnectTimout);
    Log.info(LP, `Scheduled reconnect in "${reconnectTimout}" ms...`)
  }

  #cancelReconnect() {
    if(!this.#reconnectTimeoutId) {
      return
    }

    clearTimeout(this.#reconnectTimeoutId)
    this.#reconnectTimeoutId = null
  }

  connect() {
    if(this.#socket) {
      throw new InvalidStateError("Has initialized WebSocket")
    }
    console.assert(this.#state == State.Disconnected)

    this.#cancelReconnect()

    this.#keepConnection = true
    this.#state = State.Connecting

    Log.info(LP, `Connecting to "${this.#url}"...`)

    const socket = new WebSocket(this.#url, "webrtsp")
    this.#socket = socket

    socket.onopen = () => this.#onSocketOpen(socket)
    socket.onclose = (event) => this.#onSocketClose(socket, event)
    socket.onerror = (event) => this.#onSocketError(socket, event)
    socket.onmessage = (event) => this.#onSocketMessage(socket, event)
  }

  async disconnect() {
    if(!this.#socket) {
      throw new InvalidStateError("No initialized WebSocket")
    }

    console.assert(this.state != State.Disconnected)

    if(this.state == State.Disconnecting) {
      return
    }

    // FIXME? what about State.Connecting?

    this.#cancelReconnect()

    this.#keepConnection = false
    this.#state = State.Disconnecting

    this.#socket.close()
  }

  /*
  async waitConnected() {
    switch(this.state) {
      case State.Disconnected:
        throw new InvalidStateError("Doesn't connecting")
      case State.Connected:
        return
    }
  }
  */
}