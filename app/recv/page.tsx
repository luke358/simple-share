"use client";
import Peer from '@/utils/Peer';
import { prepareRecv, registerMessageHandler } from '@/utils/socket'
import FileSaver from 'file-saver';
import React, { useEffect, useState } from 'react'

let timer: NodeJS.Timeout | null = null
let recvSizes: Record<string, number> = {}
let recvBuffer: BlobPart[] = []
const peer = new Peer()
export default function Receive() {
  const [targetClientId, setTargetClientId] = useState<string | null>(null);
  const [curFileId, setCurFileId] = useState('')
  const [recvCode, setRecvCode] = useState<string>('');
  const [recvFiles, setRecvFiles] = useState<{
    uid: string; name: string, size: number,
    type: string,
    downloadUrl?: string
  }[]>([])
  const [bps, setBps] = useState(0)
  const [peerState, setPeerState] = useState('initial');
  const [started, setStarted] = useState(false);

  const handleS2CPrepareRecv = (payload: any) => {
    console.log(payload, 'handleS2CPrepareRecv')
    const { clientId, files } = payload
    setTargetClientId(clientId);
    setRecvFiles(files);
  }


  const onPrepareRecv = () => {
    prepareRecv(recvCode);
  }
  const onStartRecv = () => {
    setStarted(true)
    peer.on('connecting', () => {
      setPeerState('connecting')
    });

    peer.on('connected', () => {
      setPeerState('connected')
    });

    peer.on('disconnected', () => {
      setPeerState('disconnected')
    });

    peer.on('connectFailed', () => {
      alert('连接失败，请重试');
      setPeerState('connectFailed')
    });

    peer.on('channelOpen', () => {
      setPeerState('transfer')
      // 收件码只能使用一次，一旦开始接收就使其失效
      // deleteRecvCode(this.props.recvCode || this.props.match.params.recvCode);
    });


    peer.on('data', onRecvPeerData);
    peer.connectPeer(targetClientId!);
  }

  const handlePeerMsg = (msg: any) => {
    if (msg.type === 'fileStart') {
      setCurFileId(msg.fileId)
    } else if (msg.type === 'fileEnd') {
      const fileId = msg.fileId;
      const file = recvFiles?.find(f => f.uid === fileId);
      const blob = new Blob(recvBuffer, {
        type: file?.type
      });
      const url = URL.createObjectURL(blob);
      console.log(url, 'url')
      setRecvFiles(recvFiles?.map(item => {
        if (item.uid === fileId) {
          item.downloadUrl = url
        }
        return item
      }))
    }
  }
  const onRecvPeerData = (data: any) => {
    // 传过来的是自定义数据
    if (typeof data === 'string') {
      const msg = JSON.parse(data)
      handlePeerMsg(msg)
    } else {
      // 传过来的是文件
      recvBuffer.push(data)
      const curRecvSize = recvSizes[curFileId] || 0
      const totalRecvSize = curRecvSize + data.byteLength

      setBps(bps + data.byteLength)
      recvSizes[curFileId] = totalRecvSize

      // 告诉对方我收到了这个文件
      peer.send(JSON.stringify({
        type: 'chunkReceived',
        payload: {
          fileId: curFileId,
          recvSize: totalRecvSize,
        },
      }))
    }
  }
  useEffect(() => {
    registerMessageHandler('s2c_prepare_recv', handleS2CPrepareRecv)
    timer = setInterval(() => {

    }, 1000)
    return () => { timer && clearInterval(timer) }
  }, [])
  return (
    <div>
      <input onChange={e => setRecvCode(e.target.value)} type="text" placeholder='6位取件码' />
      <button onClick={onPrepareRecv}>接收文件</button>
      <button onClick={onStartRecv}>下载文件</button>
      <div>
        {JSON.stringify(recvFiles)}
        {recvFiles?.length > 0 && <div>文件如下</div>}
        {recvFiles?.map(item => <div key={item.uid} className='flex'>
          <div className=''>{item.name}</div>
          {item.downloadUrl ? <div onClick={() => FileSaver.saveAs(item.downloadUrl!, item.name)} className=''>下载</div> : null}
        </div>)
        }

      </div>
    </div>
  )
}
