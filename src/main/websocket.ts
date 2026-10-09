import { WebSocket, WebSocketServer as WSServer } from 'ws';

interface Client {
  conn: WebSocket;
  id: string;
  isServer: boolean;
}

export class WebSocketServer {
  private wss: WSServer | null = null;
  private clients: Map<WebSocket, Client> = new Map();
  private nextId = 1;
  private debug: boolean;
  private authToken: string;
  private stopping: Promise<void> | null = null;

  /**
   * 启动 WebSocket 服务器
   * @param port 端口号
   * @param authToken 认证令牌
   * @param debug 是否启用调试模式
   */
  public start(port = 9696, host = 'localhost', authToken = '', debug = false): Promise<void> {
    if (this.wss || this.stopping) return Promise.reject(new Error('WebSocket服务器已启动或正在关闭'));
    this.debug = debug;
    this.authToken = authToken;

    return new Promise((resolve, reject) => {
      try {
        const server = new WSServer({
          port,
          host,
          clientTracking: true,
          perMessageDeflate: {
            zlibDeflateOptions: {
              chunkSize: 1024,
              memLevel: 7,
              level: 3,
            },
            zlibInflateOptions: {
              chunkSize: 10 * 1024,
            },
          },
        });

        this.wss = server;
        let started = false;
        server.once('listening', () => {
          started = true;
          resolve();
        });
        server.on('error', error => {
          this.log(`服务错误: ${error.message}`);
          if (!started) {
            if (this.wss === server) this.wss = null;
            reject(error);
          }
        });
        server.once('close', () => {
          if (!started) reject(new Error('WebSocket服务器在启动完成前关闭'));
        });
        this.setupEventHandlers();
      } catch (error) {
        this.log(`服务启动失败: ${error}`);
        reject(error);
      }
    });
  }

  /**
   * 停止 WebSocket 服务器
   */
  public stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const server = this.wss;
    if (!server) return Promise.resolve();
    this.clients.clear();
    this.stopping = new Promise<void>(resolve => {
      for (const socket of server.clients) socket.close();
      // A stalled peer may never acknowledge the close frame.
      const timer = setTimeout(() => {
        for (const socket of server.clients) socket.terminate();
      }, 500);
      timer.unref();
      server.close(() => {
        clearTimeout(timer);
        if (this.wss === server) this.wss = null;
        this.log('WebSocket 服务器已停止');
        resolve();
      });
    }).finally(() => {
      this.stopping = null;
    });
    return this.stopping;
  }

  /**
   * 设置事件处理器
   */
  private setupEventHandlers(): void {
    if (!this.wss) return;

    this.wss.on('connection', (ws: WebSocket, req) => {
      // 解析子协议
      const protocol = (req.headers['sec-websocket-protocol'] as string) || '';
      const { role, password } = this.parseSubprotocol(protocol);
      const isServer = role === 'laplace-event-bridge-role-server';

      // 认证检查
      if (this.authToken && password !== this.authToken) {
        this.log(`认证失败: ${isServer ? '服务器' : '客户端'}连接使用了无效的令牌`);
        ws.close(1008, 'Unauthorized');
        return;
      }

      // 创建客户端
      const clientId = `${isServer ? 'server' : 'client'}-${this.nextId++}`;
      const client: Client = { conn: ws, id: clientId, isServer };

      this.clients.set(ws, client);

      this.log(`客户端已连接: ${clientId}${isServer ? ' (laplace-chat 服务器)' : ''}`);

      // 发送欢迎消息
      this.sendJSON(ws, {
        type: 'established',
        clientId,
        isServer,
        message: 'Connected to LAPLACE Event bridge',
      });

      // 设置消息处理器
      ws.on('message', (data: Buffer) => {
        this.handleMessage(ws, data);
      });

      // 处理连接关闭
      ws.on('close', () => {
        this.handleClose(ws);
      });

      // 处理错误
      ws.on('error', (error: Error) => {
        this.handleError(ws, error);
      });
    });
  }

  /**
   * 处理接收到的消息
   */
  private handleMessage(ws: WebSocket, data: Buffer): void {
    const client = this.clients.get(ws);
    if (!client) return;

    const clientID = client.id;
    const isServer = client.isServer;
    let parsed: Record<string, unknown>;
    const broadcast: Record<string, unknown> = {};

    try {
      // 尝试解析为JSON
      parsed = JSON.parse(data.toString());

      if (this.debug) {
        this.log(`从 ${clientID} 收到 ${parsed.type || '未知类型'} 消息: ${JSON.stringify(parsed)}`);
      } else if (parsed.type) {
        this.log(`从 ${clientID} 收到 ${parsed.type} 消息`);
      } else {
        this.log(`从 ${clientID} 收到 JSON 消息`);
      }

      // 复制所有属性到广播消息
      Object.assign(broadcast, parsed);
      broadcast.source = clientID;
    } catch (error) {
      // 如果不是JSON则视为纯文本
      const text = data.toString();
      this.log(`从 ${clientID} 收到文本消息: ${text}`);

      Object.assign(broadcast, {
        type: 'unknown-message',
        text,
        source: clientID,
        timestamp: Date.now(),
      });
    }

    const broadcastStr = JSON.stringify(broadcast);

    if (isServer) {
      // 向除发送者外的所有客户端广播
      this.clients.forEach((info, conn) => {
        if (conn === ws) return;

        if (conn.readyState === WebSocket.OPEN) {
          conn.send(broadcastStr);
          if (this.debug) {
            this.log(`已发送消息到 ${info.id}`);
          }
        }
      });

      // 向服务器发送确认
      this.sendJSON(ws, {
        type: 'broadcast-success',
        clientCount: this.getClientCount() - 1,
        timestamp: Date.now(),
      });
    } else {
      // 向客户端回发确认
      this.sendJSON(ws, {
        type: 'client-message-received',
        message: 'Message received (client-to-server messages are not relayed)',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * 处理连接关闭
   */
  private handleClose(ws: WebSocket): void {
    const client = this.clients.get(ws);
    if (client) {
      this.clients.delete(ws);
      this.log(`客户端已断开: ${client.id}${client.isServer ? ' (laplace-chat server)' : ''}`);
    }
  }

  /**
   * 处理错误
   */
  private handleError(ws: WebSocket, error: Error): void {
    const client = this.clients.get(ws);
    this.log(`客户端错误 [${client?.id || 'unknown'}]: ${error.message}`);
  }

  /**
   * 广播消息给所有客户端
   */
  private getClientCount(): number {
    return this.clients.size;
  }

  /**
   * 发送 JSON 消息
   */
  private sendJSON(ws: WebSocket, data: Record<string, unknown>): void {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(JSON.stringify(data));
      } catch (error) {
        this.log(`Error sending message: ${error}`);
      }
    }
  }

  /**
   * 解析 WebSocket 子协议
   */
  private parseSubprotocol(header: string): { role: string; password: string } {
    if (!header) return { role: '', password: '' };
    const parts = header.split(',').map(part => part.trim());
    return {
      role: parts[0] || '',
      password: parts[1] || '',
    };
  }

  private log(message: string): void {
    console.log(message);
  }
}

// Export singleton instance
export const wsServer = new WebSocketServer();
