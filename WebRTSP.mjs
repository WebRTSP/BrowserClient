import * as Method from "./RtspMethod.mjs"
import Session from "./RtspSession.mjs"
import * as Serialize from "./RtspSerialize.mjs"
import * as Parse from "./RtspParse.mjs"
import * as StatusCode from "./RtspStatusCode.mjs"
import { ParseOptions, ParseParameters, ContentType } from "./RtspParse.mjs";


class ClientSession extends Session
{

constructor(sendRequest, sendResponse, events, iceServers) {
    super(sendRequest, sendResponse);

    this._events = events;

    this._streamerName = null;
    this._encodedStreamerName = null;
    this._options = null;
    this._session = null;
    this._iceCandidates = [];

    Object.defineProperty(this, "peerConnection", {
        value: new RTCPeerConnection({ iceServers }),
        writable: false
    })

    this.peerConnection.onicecandidate =
        (event) => { this._onIceCandidate(event); };
    this.peerConnection.onicegatheringstatechange =
        (event) => { this._onIceGatheringStateChange(event); };
    this.peerConnection.oniceconnectionstatechange =
        (event) => { this._onIceConnectionStateChange(event); };
}

get streamerName() {
    return this._streamerName;
}

set streamerName(name) {
    if(this._streamerName === name) return;

    this._streamerName = name;
    this._encodedStreamerName = name ? encodeURI(name) : null;
    this._options = null;
}

onConnected()
{
    this.requestOptions(this._encodedStreamerName || "*");
}

handleMessage(message)
{
    if(Parse.IsRequest(message)) {
        const request = Parse.ParseRequest(message);
        if(!request) {
            console.error(`Failed to parse message:\n${message}`)
            this.disconnect();
            return;
        }

        if(!this.handleRequest(request)) {
            console.error(`Failed to handle message:\n${message}\nDisconnecting...`)
            this.disconnect();
            return;
        }
    } else {
        const response = Parse.ParseResponse(message);
        if(!response) {
            console.error(`Failed to parse message:\n${message}`)
            this.disconnect();
            return;
        }

        if(response.statusCode == StatusCode.Unauthorized) {
            this._events.dispatchEvent(new CustomEvent("unauthorized"));
            console.error("Got \"Unauthorized\" response. Disconnecting...")
            this.disconnect();
        } else if(!this.handleResponse(response)) {
            console.error(`Failed to handle message:\n${message}\nDisconnecting...`)
            this.disconnect();
        }
    }
}

onOptionsResponse(request, response)
{
    const options = ParseOptions(response)
    if(!options)
        return false;

    console.assert((!this.streamerName && request.uri == "*") || this._encodedStreamerName == request.uri,
        "Streamer name was changed during request to server");

    this._options = options;

    if(!this.streamerName && options.has(Method.LIST)) {
        this.requestList("*");
    } else {
        if(!this.streamerName)
            this.streamerName = "*";

        this.requestDescribe(this._encodedStreamerName);
    }

    return true;
}

onListResponse(request, response)
{
    if(ContentType(response) != "text/parameters")
        return false;

    const list = ParseParameters(response.body);
    if(!list) {
        console.error("LIST response parsing failed")
        return false;
    }

    this.list = new Map;
    list.forEach((value, key) => {
        this.list.set(decodeURI(key), value);
    })

    if(!this._events.dispatchEvent(new CustomEvent("list", { detail: { list: this.list } })))
        return false;

    if(!this.streamerName) {
        if(list.size > 0)
            this.streamerName = list.keys().next().value;
        else
            this.streamerName = "*";
    }

    console.info(`Requesting "${this._streamerName}" streamer...`);

    this.requestDescribe(this._encodedStreamerName);

    return true;
}

onDescribeResponse(request, response)
{
    if(StatusCode.OK != response.statusCode)
        return false;

    if(!response.session)
        return false;

    this._session = response.session;

    const offer = response.body;
    const promise =
        this.peerConnection.setRemoteDescription(
            { type : "offer", sdp : offer });
    promise
        .then(() => {
            this._sendPlay();
        }).
        catch((event) => {
            // FIXME! disconnect, or send TEARDOWN request
            console.error("setRemoteDescription fail", event);
        });

    return true;
}

handleSetupRequest(request)
{
    const contentType = request.headerFields.get("content-type");
    if(!contentType || contentType != "application/x-ice-candidate")
        return false;

    const iceCandidate = request.body;
    if(!iceCandidate)
        return false;

    const separatorIndex = iceCandidate.indexOf("/");
    if(separatorIndex == -1 || separatorIndex == 0)
        return false;

    const eolIndex = iceCandidate.indexOf("\r\n", separatorIndex);
    if(eolIndex == -1 || eolIndex == 0)
        return false;

    const sdpMLineIndex = iceCandidate.substring(0, separatorIndex);
    let candidate = iceCandidate.substring(separatorIndex + 1, eolIndex);

    if(candidate == "a=end-of-candidates")
        candidate = null;
    else
        candidate = { sdpMLineIndex, candidate };

    if(this.peerConnection.iceGatheringState == "complete")
        this._addIceCandidate(candidate);
    else
        this._iceCandidates.push(candidate);

    this.sendOkResponse(request.cseq, request.session);

    return true;
}

onSetupResponse(request, response)
{
    if(StatusCode.OK != response.statusCode)
        return false;

    return true;
}

onPlayResponse(request, response)
{
    if(StatusCode.OK != response.statusCode)
        return false;

    return true;
}

close() {
    this.peerConnection.close();
}


async _sendPlay()
{
    const answer =
        await this.peerConnection.createAnswer()
            .catch(function (event) {
                console.error("createAnswer fail", event);
            });

    await this.peerConnection.setLocalDescription(answer)
        .catch(function (event) {
            console.error("setLocalDescription fail", event);
        });

    await this.requestPlay(this._encodedStreamerName, this._session, answer.sdp);
}

_onIceCandidate(event)
{
    let candidate;
    if(event.candidate && event.candidate.candidate)
        candidate =
            event.candidate.sdpMLineIndex.toString() + "/" + event.candidate.candidate + "\r\n";
    else
        candidate = "0/a=end-of-candidates\r\n";

    this.requestSetup(
        this._encodedStreamerName,
        "application/x-ice-candidate",
        this._session,
        candidate);
}

_onIceGatheringStateChange()
{
    if(this.peerConnection.iceGatheringState == "complete") {
        this._iceCandidates.forEach(candidate => this._addIceCandidate(candidate));
        this._iceCandidates.length = 0;
    }
}

_addIceCandidate(candidate)
{
    const promise =
        this.peerConnection.addIceCandidate(candidate);
    promise.catch((event) => {
            console.error("addIceCandidate fail", event);
        });
}

_onIceConnectionStateChange()
{
    console.debug(`ICE connection state changed to: ${this.peerConnection.iceConnectionState}`);
}

}

export class WebRTSP
{

constructor(videoElement, iceServers, { debug })
{
    Object.defineProperty(this, "events", {
        value: new EventTarget(),
        writable: false
    })

    this._debug = debug;

    this._iceServers = iceServers;

    this._url = null;
    this._streamerName = null;

    this._video = videoElement;

    this._socket = null;
    this._session = null;

    this._enableReconnect = true;

    this._reconnectTimeoutId = null;

    this.events.addEventListener("unauthorized", (event) => {
        this._enableReconnect = false;
        setTimeout(() => { window.location.reload(); });
    });
}

_onSocketOpen()
{
    console.info("Connected.");

    this._session =
        new ClientSession(
            (request) => { this._sendRequest(request); },
            (response) => { this._sendResponse(response); },
            this.events,
            this._iceServers
        );

    this._session.streamerName = this._streamerName;

    this._session.peerConnection.ontrack =
        (event) => { this._onTrack(event); };

    this._session.onConnected();
}

_onTrack(event)
{
    this._video.srcObject = event.streams[0];
}

_tryScheduleReconnect()
{
    if(!this._enableReconnect || !this._url || !this._streamerName)
        return;

    if(this._reconnectTimeoutId)
        return;

    const reconnectTimout = 1 + Math.floor(Math.random() * 5);

    console.info(`Scheduling reconnect in ${reconnectTimout} seconds...`);

    this._reconnectTimeoutId =
        setTimeout(
            () => {
                this._reconnectTimeoutId = null;
                this.reconnect();
            }, reconnectTimout * 1000);
}

_onSocketClose(socket)
{
    console.info("Disconnected.");

    if(socket == this._socket) {
        this._close();

        this._tryScheduleReconnect();
    }

    socket.onopen = undefined;
    socket.onclose = undefined;
    socket.onerror = undefined;
    socket.onmessage = undefined;

    this.events.dispatchEvent(new Event("disconnected"));
}

_onSocketError(socket, error)
{
    if(error.message)
        console.error(error.message);

    if(socket == this._socket) {
        this._close();

        this._tryScheduleReconnect();
    }
}

_onSocketMessage(event)
{
    if(this._debug)
        console.debug(event.data);

    this._session.handleMessage(event.data);
}

_close()
{
    if(this._session) {
        this._session.peerConnection.ontrack = undefined;
        this._session.close();
        this._session = null;
    }

    if(this._socket) {
        this._socket.close();
        this._socket = null;
    }
}

_sendRequest(request)
{
    if(!request) {
        this._close();
        return;
    }

    const requestMessage = Serialize.SerializeRequest(request);

    if(!requestMessage) {
        this._close();
        return;
    }

    if(this._debug)
        console.debug(requestMessage);

    this._socket.send(requestMessage);
}

_sendResponse(response)
{
    if(!response) {
        this._close();
        return;
    }

    const responseMessage = Serialize.SerializeResponse(response);

    if(!responseMessage) {
        this._close();
        return;
    }

    if(this._debug)
        console.debug(responseMessage);

    this._socket.send(responseMessage);
}

get session() {
    return this._session;
}

connect(url, streamerName)
{
    this._close();

    if(streamerName)
        console.info(`Connecting to ${url} [${streamerName}]...`);
    else
        console.info(`Connecting to ${url}...`);

    this._url = url;
    this._streamerName = streamerName;

    const socket = new WebSocket(url, "webrtsp");

    socket.onopen = () => this._onSocketOpen();
    socket.onclose = (event) => this._onSocketClose(socket, event);
    socket.onerror = (error) => this._onSocketError(socket, error);
    socket.onmessage = (event) => this._onSocketMessage(event);

    this._socket = socket
}

get streamerName() {
    if(this._session)
        return this._session.streamerName;
    else
        return this._streamerName;
}

set streamerName(name) {
    this._streamerName = name;
    if(this._session)
        this._session.streamerName = name;
}

reconnect()
{
    console.assert(!this._socket);

    if(!this._url || !this._streamerName)
        return;

    this.connect(this._url, this._streamerName);
}

}
