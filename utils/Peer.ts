import EventEmitter from 'eventemitter3';
import { initSocket, registerMessageHandler } from './socket';

const BUFFERED_AMOUNT_LOW_THRESHOLD = 256 * 1024;
const BUF_WAITING_THRESHOLD = 1024 * 1024;

const ws = initSocket();
export default class Peer extends EventEmitter {
  targetId: string | null
  pc: RTCPeerConnection | null
  dc: RTCDataChannel | null
  waitingCallback: any
  isCaller: any
  constructor() {
    super();
    this.targetId = null;
    this.pc = null; // RTCPeerConnection
    this.dc = null; // RTCDataChannel
    this.waitingCallback = null;
    this.isCaller = null;

    this.onIceCandidate = this.onIceCandidate.bind(this);
    this.onDescription = this.onDescription.bind(this);
    this.connectPeer = this.connectPeer.bind(this);
    this.onConnectionStateChange = this.onConnectionStateChange.bind(this);
    this.onRTCMessage = this.onRTCMessage.bind(this);
    this.onChannelOpen = this.onChannelOpen.bind(this);
    this.onChannelClose = this.onChannelClose.bind(this);
    this.onBufferedAmountLow = this.onBufferedAmountLow.bind(this);

    this.onS2cSignal = this.onS2cSignal.bind(this);
    registerMessageHandler('s2c_signal', this.onS2cSignal);
  }

  onS2cSignal(payload: any) {
    if (!this.isCaller) {
      this.targetId = payload.sourceClientId;
    }
    if (!this.pc) {
      this.createRTCConnection(false);
    }
    if (payload.sdp) {
      this.pc?.setRemoteDescription(new RTCSessionDescription(payload.sdp))
      .then(_ => {
        if (payload.sdp.type === 'offer') {
          return this.makeAnswer();
        }
      });
    } else if (payload.ice) {
      this.pc?.addIceCandidate(new RTCIceCandidate(payload.ice));
    }
  }

  onDescription(description: any) {
    this.pc?.setLocalDescription(description)
    .then(() => {
      console.log(this.targetId, 'onDescription')
      ws.send({
        type: 'c2s_signal',
        payload: {
          clientId: this.targetId,
          sdp: description,
        },
      });
    })
    .catch(e => console.log('onDescription error: ', e));
  }

  onConnectionStateChange() {
    if (this.pc?.connectionState === 'disconnected') {
      if (this.dc) {
        this.dc.close();
      }
      if (this.waitingCallback) {
        this.waitingCallback(new Error('peer disconnected, cannot send'));
        this.waitingCallback = null;
      }
      this.emit('disconnected');
    } else if (this.pc?.connectionState === 'connected') {
      this.emit('connected');
    } else if (this.pc?.connectionState === 'connecting') {
      this.emit('connecting');
    } else if (this.pc?.connectionState === 'failed') {
      this.emit('connectFailed');
    }
    console.log('onConnectionStateChange: ', this.pc?.connectionState);
  }

  onRTCMessage(e: any) {
    console.log(e, 'onRTCMessage')
    this.emit('data', e.data);
  }

  createRTCConnection(isCaller: any) {
    // const config = {
    //   iceServers: [
    //     {
    //       urls: 'stun:deershare.com',
    //     },
    //     {
    //       urls: 'turn:0.peerjs.com:3478',
    //       username: 'peerjs',
    //       credential: 'peerjsp',
    //     },
    //   ],
    // };
    const pc = new RTCPeerConnection();
    this.pc = pc;
    pc.onconnectionstatechange = e => this.onConnectionStateChange();
    pc.onicecandidate = this.onIceCandidate;

    this.isCaller = isCaller;

    if (isCaller) {
      const dc = pc.createDataChannel('file-transfer', { ordered: true });
      this.setupDataChannel(dc);
      this.makeOffer();
    } else {
      this.pc.ondatachannel = e => {
        const dc = e.channel || e.target;
        this.setupDataChannel(dc);
      };
    }
  }

  setupDataChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.bufferedAmountLowThreshold = BUFFERED_AMOUNT_LOW_THRESHOLD;
    dc.binaryType = 'arraybuffer';
    dc.onopen = this.onChannelOpen;
    dc.onclose = this.onChannelClose;
    dc.onerror = this.onChannelError;
    dc.onbufferedamountlow = this.onBufferedAmountLow;
  }

  makeOffer() {
    this.pc?.createOffer()
    .then(description => {
      return this.onDescription(description);
    });
  }

  makeAnswer() {
    return this.pc?.createAnswer()
    .then(d => this.onDescription(d));
  }

  connectPeer(targetId: string) {
    this.targetId = targetId;
    this.createRTCConnection(true);
  }

  destroy() {
    this.targetId = null;
    this.waitingCallback = null;
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    if (this.dc) {
      this.dc.close();
      this.dc = null;
    }
    this.removeAllListeners();
  }

  onIceCandidate(e: any) {
    if (!e.candidate) {
      return;
    }
    console.log(this.targetId, 'onIceCandidate')

    ws.send({
      type: 'c2s_signal',
      payload: {
        clientId: this.targetId,
        ice: e.candidate,
      },
    });
  }

  onChannelOpen(e: any) {
    this.emit('channelOpen');
    this.dc!.onmessage = this.onRTCMessage;
  }

  onChannelClose(e: any) {
    console.log('## channel close: ', e);
  }

  onChannelError(e: any) {
    console.log('## channel error: ', e);
  }

  onBufferedAmountLow() {
    if (this.waitingCallback) {
      this.waitingCallback();
      this.waitingCallback = null;
    }
  }

  send(data: any) {
    return new Promise<void>((resolve, reject) => {
      if (this.dc?.readyState === 'open') {
        if (this.dc.bufferedAmount >= BUF_WAITING_THRESHOLD) {
          this.waitingCallback = (err: any) => {
            if (err) {
              reject(err);
            } else {
              this.dc?.send(data);
              resolve();
            }
          };
        } else {
          try {
            this.dc.send(data);
            resolve();
          } catch (e) {
            console.error('send error: ', e);
            reject(e);
          }
        }
      } else {
        const errMsg = 'send but channel is not open, now state is: ' + this.dc?.readyState;
        console.error(errMsg);
        reject(new Error(errMsg));
      }
    });
  }

}
