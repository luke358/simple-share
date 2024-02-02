import io, { Socket } from 'socket.io-client';
import randomstring from 'randomstring'
let socket: Socket;
const messageHandlers = new Map<string, ((...args: any[]) => void)[]>();


function getRandomString(len: number) {
  randomstring.generate({ charset: 'numeric', length: len });
}

export function registerMessageHandler(type: string, handler: (...args: any[]) => void) {
  const handlers = messageHandlers.get(type) || [];
  handlers.push(handler);
  messageHandlers.set(type, handlers);
}

export function removeMessageHandler(type: string, handler: (...args: any[]) => void) {
  const handlers = messageHandlers.get(type) || [];
  const newHandlers = handlers.filter(h => h !== handler);
  if (newHandlers.length === 0) {
    messageHandlers.delete(type);
  } else {
    messageHandlers.set(type, newHandlers);
  }
}

function handleMessage(event: any) {
  console.log(event, 'handleMessage')
  const {
    type,
    payload,
  } = event;
  const handlers = messageHandlers.get(type);
  if (!handlers) {
    return;
  }
  for (var i = 0; i < handlers.length; i++) {
    const handler = handlers[i];
    try {
      handler(payload);
    } catch (err) {
      console.error('websocket message handler error: ', err);
    }
  }
}

export function prepareSend(files: any) {
  socket.send({
    type: 'c2s_prepare_send',
    payload: {
      files,
    },
  });
}


export function deleteRecvCode(recvCode: string) {
  socket.send({
    type: 'c2s_delete_recv_code',
    payload: {
      recvCode,
    },
  });
}

export function prepareRecv(recvCode: string) {
  socket.send({
    type: 'c2s_prepare_recv',
    payload: {
      recvCode,
    },
  });
}

export const initSocket = () => {
  if (!socket) {
    socket = io(process.env.NEXT_PUBLIC_SOCKET_IO_URL!, {
      // 你可能需要的Socket.IO客户端选项
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('Connected to server');
    });

    socket.on('disconnect', () => {
      console.log('Disconnected from server');
    });

    socket.on('message', handleMessage)

    // 监听其他事件...
  }

  return socket;
};
