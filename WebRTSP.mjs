import Session from "./RtspSession.mjs"
import * as Serialize from "./RtspSerialize.mjs"
import * as Parse from "./RtspParse.mjs"
import * as StatusCode from "./RtspStatusCode.mjs"
import { ParseOptions } from "./RtspParse.mjs";

class ClientSession extends Session
{

constructor(sendRequest, sendResponse, events, iceServers) {
    super(sendRequest, sendResponse);

    this._events = events;

    this._streamerName = null;
    this._session = null;

    Object.defineProperty(this, "peerConnection", {
        value: new RTCPeerConnection({ iceServers }),
        writable: false
    })

    this.peerConnection.onicecandidate =
        (event) => { this._onIceCandidate(event); };
}

get streamerName() {
    return this._streamerName;
}

set streamerName(name) {
    this._streamerName = name;
}

onConnected()
{
    this.requestOptions(this._streamerName)
}

handleMessage(message)
{
    if(Parse.IsRequest(message)) {
        const request = Parse.ParseRequest(message);
        if(!request) {
            this.disconnect();
            return;
        }

        if(!this.handleRequest(request)) {
            this.disconnect();
            return;
        }
    } else {
        const response = Parse.ParseResponse(message);
        if(!response) {
            this.disconnect();
            return;
        }

        if(!this.handleResponse(response)) {
            this.disconnect();
            return;
        }
    }
}

onOptionsResponse(request, response)
{
    const options = ParseOptions(response)
    if(!options)
        return false;

    this.options = options;

    this.requestDescribe(this._streamerName);

    return true;
}

onDescribeResponse(request, response)
{
    // console.log("onDescribeResponse");

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
            this._sendAnswer();
        }).
        catch((event) => {
            console.error("setRemoteDescription fail", event);
        });

    return true;
}

handleSetupRequest(request)
{
    // console.log("handleSetupRequest");

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
    const candidate = iceCandidate.substring(separatorIndex + 1, eolIndex);

    if("a=end-of-candidates" == candidate) {
        const promise =
            this.peerConnection.addIceCandidate(
                { sdpMLineIndex, candidate: "" });
        promise.catch((event) => {
                console.error("addIceCandidate fail", event);
            });
    } else {
        const promise =
            this.peerConnection.addIceCandidate(
                { sdpMLineIndex, candidate } );
        promise.catch((event) => {
                console.error("addIceCandidate fail", event);
            });
    }

    this.sendOkResponse(request.cseq, request.session);

    return true;
}

onSetupResponse(request, response)
{
    // console.log("onSetupResponse");

    if(StatusCode.OK != response.statusCode)
        return false;

    const contentType = request.headerFields.get("Content-Type");
    if(contentType == "application/sdp")
        this.requestPlay(this._streamerName, this._session)

    return true;
}

onPlayResponse(request, response)
{
    // console.log("onPlayResponse");

    if(StatusCode.OK != response.statusCode)
        return false;

    return true;
}


async _sendAnswer()
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

    await this.requestSetup(this._streamerName, "application/sdp", this._session, answer.sdp);
}

async _onIceCandidate(event)
{
    // console.log("_onIceCandidate", event.candidate);

    let candidate;
    if(event.candidate && event.candidate.candidate)
        candidate =
            event.candidate.sdpMLineIndex.toString() + "/" + event.candidate.candidate + "\r\n";
    else
        candidate =
            "0/a=end-of-candidates\r\n";

    await this.requestSetup(
        this._streamerName,
        "application/x-ice-candidate",
        this._session,
        candidate);
}

}

export class WebRTSP
{

constructor(videoElement, iceServers)
{
    Object.defineProperty(this, "events", {
        value: new EventTarget(),
        writable: false
    })

    this._iceServers = iceServers;

    this._url = null;
    this._streamerName = null;

    this._video = videoElement;

    this._socket = null;
    this._session = null;

    this._reconnectTimeoutId = null;
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
    // console.log("_onTrack");

    this._video.srcObject = event.streams[0];
}

_scheduleReconnect()
{
    if(this._reconnectTimeoutId)
        return;

    const reconnectTimout = 3;

    console.info(`Scheduling reconnect in ${reconnectTimout} seconds...`);

    this._reconnectTimeoutId =
        setTimeout(
            () => {
                this._reconnectTimeoutId = null;
                this.reconnect();
            }, reconnectTimout * 1000);
}

_onSocketClose()
{
    console.info("Disconnected.");

    this._close();

    if(this._url && this._streamerName)
        this._scheduleReconnect();
}

_onSocketError(error)
{
    console.error(error.message);

    this._close();
}

_onSocketMessage(event)
{
    // console.log(event.data);

    this._session.handleMessage(event.data);
}

_close()
{
    this._session = null;

    if(this._socket) {
        this._socket.onopen = undefined;
        this._socket.onclose = undefined;
        this._socket.onerror = undefined;
        this._socket.onmessage = undefined;
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

    this._socket.send(responseMessage);
}

connect(url, streamerName)
{
    this._close();

    console.info(`Connecting to ${url} [${streamerName}]...`);

    this._url = url;
    this._streamerName = streamerName;

    this._socket = new WebSocket(url, "webrtsp");

    this._socket.onopen = () => this._onSocketOpen();
    this._socket.onclose = (event) => this._onSocketClose(event);
    this._socket.onerror = (error) => this._onSocketError(error);
    this._socket.onmessage = (event) => this._onSocketMessage(event);
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
    if(!this._url || !this._streamerName)
        return;

    this.connect(this._url, this._streamerName);
}

}
