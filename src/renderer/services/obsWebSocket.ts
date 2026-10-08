import { OBSWebSocket } from 'obs-websocket-js';
import { Song } from '../store/songStore';
import { getInitialOBSConfig } from '../store/settingStore';
import { configureOBSStreamConnection } from './obsStreaming';

// OBS WebSocket 配置接口
interface OBSConfig {
  address: string;
  port: number;
  password?: string;
  textTemplate?: string;
  playlistTemplate?: string;
}

// OBS 源信息接口
interface OBSSource {
  sourceName: string;
  sourceType: string;
  sourceKind: string;
}

class OBSWebSocketService {
  private obs: OBSWebSocket;
  private config: OBSConfig;
  private isConnected = false;
  private sourceName = '锤子播放状态';

  constructor() {
    this.obs = new OBSWebSocket();
    this.config = getInitialOBSConfig();
  }

  // 设置OBS配置
  setConfig(config: Partial<OBSConfig>) {
    this.config = { ...this.config, ...config };
  }

  // 连接到OBS
  async connect(): Promise<{
    on: (event: string, fn: (...args: unknown[]) => void) => void;
    once: (event: string, fn: (...args: unknown[]) => void) => void;
    off: (event: string, fn: (...args: unknown[]) => void) => void;
  }> {
    if (this.isConnected) {
      return { on: this.obs.on.bind(this.obs), once: this.obs.once.bind(this.obs), off: this.obs.off.bind(this.obs) };
    }
    await this.obs.connect(`ws://${this.config.address}:${this.config.port}`, this.config.password);
    this.isConnected = true;

    this.obs.once('ConnectionClosed', () => {
      console.log('OBS ConnectionClosed');
      this.isConnected = false;
    });

    return { on: this.obs.on.bind(this.obs), once: this.obs.once.bind(this.obs), off: this.obs.off.bind(this.obs) };
  }

  // 断开连接
  async disconnect(): Promise<void> {
    await this.obs.disconnect();
  }

  // 检查连接状态
  isConnectedToOBS(): boolean {
    return this.isConnected;
  }

  async configureStream(server: string, streamKey: string): Promise<void> {
    // 推流设置使用短连接，不影响点歌机已有的OBS连接与订阅。
    const connection = new OBSWebSocket();
    await configureOBSStreamConnection(
      connection,
      `ws://${this.config.address}:${this.config.port}`,
      this.config.password,
      server,
      streamKey
    );
  }

  // 获取当前场景名称
  private async getCurrentSceneName(): Promise<string> {
    const response = await this.obs.call('GetCurrentProgramScene');
    return response.currentProgramSceneName;
  }

  // 获取场景中的源列表
  private async getSceneSources(sceneName: string): Promise<OBSSource[]> {
    const response = await this.obs.call('GetSceneItemList', { sceneName });
    return response.sceneItems.map((item: { sourceName: string; sourceType: string; sourceKind: string }) => ({
      sourceName: item.sourceName,
      sourceType: item.sourceType,
      sourceKind: item.sourceKind,
    }));
  }

  // 检查场景中是否存在指定名称的源
  private async hasSourceInScene(sceneName: string, sourceName: string): Promise<boolean> {
    const sources = await this.getSceneSources(sceneName);
    return sources.some(source => source.sourceName === sourceName);
  }

  // 获取可用的输入源类型
  private async getAvailableInputKinds(): Promise<string[]> {
    const response = await this.obs.call('GetInputKindList');
    return response.inputKinds;
  }

  // 从可用源类型中选择文字源
  private selectTextSourceKind(availableKinds: string[]): string {
    // 优先选择的文字源类型（按优先级排序）
    const textSourceKinds = [
      'text_gdiplus', // Windows GDI+ 文字源
      'text_ft2_source', // FreeType 2 文字源
    ];

    // 查找第一个可用的文字源类型
    for (const kind of textSourceKinds) {
      if (availableKinds.includes(kind)) {
        return kind;
      }
    }

    // 如果没有找到预定义的文字源类型，查找包含 "text" 的源类型
    const textKinds = availableKinds.filter(kind => kind.toLowerCase().includes('text'));

    if (textKinds.length > 0) {
      console.warn(`未找到预定义的文字源类型，使用: ${textKinds[0]}`);
      return textKinds[0];
    }

    // 如果都没有找到，抛出错误
    throw new Error('未找到可用的文字源类型');
  }

  // 创建文字源
  private async createTextSource(sourceName: string, text = ''): Promise<void> {
    // 获取可用的输入源类型
    const availableKinds = await this.getAvailableInputKinds();

    // 选择文字源类型
    const textSourceKind = this.selectTextSourceKind(availableKinds);

    console.log(`使用文字源类型: ${textSourceKind}`);

    await this.obs.call('CreateInput', {
      sceneName: await this.getCurrentSceneName(),
      inputName: sourceName,
      inputKind: textSourceKind,
      inputSettings: {
        text: text,
      },
    });
    console.log(`文字源 "${sourceName}" 创建成功`);
  }

  // 更新文字源内容
  private async updateTextSource(sourceName: string, text: string): Promise<void> {
    await this.obs.call('SetInputSettings', {
      inputName: sourceName,
      inputSettings: {
        text: text,
      },
    });
    console.log(`文字源 "${sourceName}" 内容更新成功`);
  }

  // 渲染模板
  private renderTemplate(songInfo: Song, requestList: Song[], template: string, playlistTemplate: string): string {
    const artist = Array.isArray(songInfo.artist) ? songInfo.artist.join(' / ') : songInfo.artist;

    // 渲染点歌列表
    let playlistText = '';
    if (requestList.length > 0) {
      playlistText = requestList
        .map((song, index) => {
          const songArtist = Array.isArray(song.artist) ? song.artist.join(' / ') : song.artist;
          return playlistTemplate
            .replace(/{序号}/g, (index + 1).toString())
            .replace(/{歌曲名}/g, song.name || '[未知歌曲]')
            .replace(/{歌手}/g, songArtist || '[未知歌手]')
            .replace(/{点歌者}/g, song.requester || '[系统]');
        })
        .join('\n');
    } else {
      playlistText = '暂无点歌';
    }

    // 渲染主模板
    return template
      .replace(/{歌曲名}/g, songInfo.name || '[未知歌曲]')
      .replace(/{歌手}/g, artist || '[未知歌手]')
      .replace(/{点歌者}/g, songInfo.requester || '[系统]')
      .replace(/{点歌列表}/g, playlistText);
  }

  // 更新点歌机文字源内容
  async updateSongRequestText(songInfo: Song, requestList: Song[]): Promise<void> {
    const template = this.config.textTemplate;
    const defaultPlaylistTemplate = this.config.playlistTemplate;
    const text = this.renderTemplate(songInfo, requestList, template, defaultPlaylistTemplate);

    await this.updateTextSource(this.sourceName, text);
  }

  // 为当前场景配置点歌机源
  async configureSongRequestSource(): Promise<boolean> {
    const currentScene = await this.getCurrentSceneName();

    // 检查是否已存在点歌机源
    const hasSource = await this.hasSourceInScene(currentScene, this.sourceName);
    if (hasSource) {
      // 如果源已存在，将其设置为可见
      const sceneResponse = await this.obs.call('GetSceneItemList', { sceneName: currentScene });
      const sceneItem = sceneResponse.sceneItems.find(
        (item: { sourceName: string; sceneItemId: number }) => item.sourceName === this.sourceName
      );
      if (sceneItem) {
        await this.obs.call('SetSceneItemEnabled', {
          sceneName: currentScene,
          sceneItemId: sceneItem.sceneItemId as number,
          sceneItemEnabled: true,
        });
        console.log(`点歌机文字源已设置为可见`);
      }
      return true;
    }

    // 创建点歌机源
    await this.createTextSource(this.sourceName);

    console.log(`已在场景 "${currentScene}" 中创建点歌机源`);
    return true;
  }

  // 隐藏点歌机文字源
  async hideSongRequestSource(): Promise<void> {
    const currentScene = await this.getCurrentSceneName();
    const sceneResponse = await this.obs.call('GetSceneItemList', { sceneName: currentScene });

    const sceneItem = sceneResponse.sceneItems.find(
      (item: { sourceName: string; sceneItemId: number }) => item.sourceName === this.sourceName
    );
    if (sceneItem) {
      await this.obs.call('SetSceneItemEnabled', {
        sceneName: currentScene,
        sceneItemId: sceneItem.sceneItemId as number,
        sceneItemEnabled: false,
      });
      console.log(`点歌机文字源已隐藏`);
    }
  }
}

// 创建单例实例
export const obsWebSocketService = new OBSWebSocketService();
