"use client";
import { v4 } from "uuid";
import { ChangeEvent, useEffect, useRef, useState } from "react";
import { prepareSend, registerMessageHandler } from "@/utils/socket";
import Peer from "@/utils/Peer";
import FileChunker from "@/utils/FileChunker";

type UidFile = File & { uid: string }

const peer = new Peer()
let lastPeerRecvBytes = 0
let sendSizes: Record<string, number> = {}

export default function Home() {
  const hiddenFileInput = useRef<HTMLInputElement>(null);

  const [selectedFiles, setSelectedFiles] = useState<UidFile[]>([]);
  const [curFileId, setCurFileId] = useState<string>()
  const [waitingPrepareSend, setWaitingPrepareSend] = useState(true);
  const [recvCode, setRecvCode] = useState<string>()
  const [peerState, setPeerState] = useState('initial');
  const [bps, setBps] = useState(0)

  const handleClick = () => {
    hiddenFileInput.current?.click();
  };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const fileUploaded = event.target.files?.[0];
    console.log(fileUploaded)
    if (fileUploaded) {
      (fileUploaded as UidFile).uid = v4()
      setSelectedFiles([...selectedFiles, fileUploaded as UidFile])
    }
  };

  const handleS2CPrepareSend = (payload: any) => {
    const { recvCode } = payload;
    console.log(payload, 'handleS2CPrepareSend')
    setRecvCode(recvCode)
    setWaitingPrepareSend(false);
  }


  useEffect(() => {
    registerMessageHandler('s2c_prepare_send', handleS2CPrepareSend)
  }, [])
  const handleSelectDone = async () => {
    setWaitingPrepareSend(true)
    const files = selectedFiles.map(f => {
      return {
        uid: f.uid,
        name: f.name,
        size: f.size,
        type: f.type,
      };
    });

    prepareSend(files);

    peer.on('connecting', () => {
      setPeerState('connecting')
    });

    peer.on('connected', () => {
      setPeerState('connected')
    });

    peer.on('connectFailed', () => {
      setPeerState('connectFailed')

      alert('连接失败');
    });

    peer.on('disconnected', async () => {
      setPeerState('disconnected')
    });

    peer.on('channelOpen', async () => {
      setPeerState('transfer')

      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        const fileId = file.uid;
        await peer.send(JSON.stringify({
          type: 'fileStart',
          fileId,
        }));
        setCurFileId(fileId)

        const chunker = new FileChunker(file);
        let done = false;
        lastPeerRecvBytes = 0;
        while (!done) {
          const result: any = await chunker.getNextChunk();
          done = result.done;
          const {
            chunk,
          } = result;
          try {
            await peer.send(chunk);
          } catch (err) {
            alert('传输错误：' + err);
            break;
          }
        }
        if (done) {
          await peer.send(JSON.stringify({
            type: 'fileEnd',
            fileId,
          }));
        }
      }
    });
    peer.on('data', onRecvPeerData);

  }

  const handlePeerMsg = (msg: any) => {
    const {
      type,
      payload,
    } = msg;

    if (type === 'chunkReceived') {
      const {
        fileId,
        recvBytes,
      } = payload;
      sendSizes[fileId] = recvBytes;
      setBps(bps + recvBytes - lastPeerRecvBytes);
      lastPeerRecvBytes = recvBytes;
    }
  }
  const onRecvPeerData = (data: any) => {
    if (typeof data === 'string') {
      const msg = JSON.parse(data);
      handlePeerMsg(msg);
    }
  }

  return (

    <div className='flex items-center justify-center h-full'>
      <input ref={hiddenFileInput} onChange={handleChange} type="file" name="" id="" style={{ display: 'none' }} />
      <div className='flex flex-col w-[45%] bg-[#fdfdfd] h-[500px]'>
        <div className='text-center mt-4'>发送文件</div>
        <div className="file-box flex-1">
          <div className="file-list">
            {selectedFiles.map((file) => (
              <div
                key={file.uid}
                className="file-item flex justify-between px-20"
              >
                <div className="file-name">{file.name}</div>
                <div className="file-remove">x</div>
              </div>))
            }
          </div>
        </div>
        {recvCode ? <div className="h-[50px] pb-20 text-center">
          <div>打开 http://localhost:3000/recv</div>
          <div>
            输入取件码：{recvCode}
          </div>
        </div> : null}
        <div className="flex justify-between px-20 pb-4">
          <button disabled={!waitingPrepareSend || peerState !== 'initial'} onClick={handleClick} className="p-2 bg-[#71cecf] rounded-md text-white">选择文件</button>
          <button onClick={handleSelectDone} className="p-2 bg-[#71cecf] rounded-md text-white">开始发送</button>
        </div>
      </div>
    </div>
    // <div>
    //   <input ref={hiddenFileInput} onChange={handleChange} type="file" name="" id="" style={{ display: 'none' }} />
    //   <button onClick={handleClick}>添加文件</button>
    //   peedState:{peerState}
    //   <br />
    //   waitingPrepareSend:{waitingPrepareSend ? 'true' : 'false'}
    //   {selectedFiles.length}
    //   {selectedFiles.map(file => <li key={file.uid}>{file.name}</li>)}
    //   {selectedFiles.length > 0 ? <button onClick={handleSelectDone}>选好了</button> : null}
    // </div>
  );
}
