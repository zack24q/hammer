import React, { useEffect, useRef, useState } from 'react';
import { useGetState } from 'ahooks';
import { useToast } from '../context/ToastContext';
import { useSongStore, Song, MUSIC_SOURCES, MusicSourceValue } from '../store/songStore';
import { useSettingStore } from '../store/settingStore';
import {
  Text,
  Button,
  Flex,
  Box,
  Select,
  TextField,
  TextArea,
  Separator,
  Spinner,
  Tabs,
  IconButton,
  Tooltip,
  Badge,
  Popover,
  ScrollArea,
  BadgeProps,
  Dialog,
} from '@radix-ui/themes';
import {
  MagnifyingGlassIcon,
  PlayIcon,
  TrackNextIcon,
  PlusIcon,
  PinTopIcon,
  TrashIcon,
  UpdateIcon,
  InfoCircledIcon,
} from '@radix-ui/react-icons';
import { LaplaceEventBridgeClient } from '@laplace.live/event-bridge-sdk';
import { obsWebSocketService } from '../services/obsWebSocket';
// @ts-expect-error APlayer types are not available
import APlayer from 'aplayer';
import 'aplayer/dist/APlayer.min.css';
import {
  searchSongs,
  getSongInfo,
  SearchResult,
  getUserPlaylists,
  Playlist,
  getPlaylistDetail,
} from '../services/musicApi';

import {
  parseSongCommand,
  getSkipSongAction,
  selectNextSong,
  resolveSongRequest,
  convertTrackToSong,
  createLatestSongLoader,
} from '../services/songRequestLogic';

// MARK: 点歌机
const SongRequest: React.FC = () => {
  const { showToast } = useToast();

  // 播放器
  const playerRef = useRef<APlayer | null>(null);
  const songLoaderRef = useRef(createLatestSongLoader(getSongInfo));
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState<'request' | 'default'>('default');

  // 点歌列表
  const [requestPlaylist, setRequestPlaylist, getRequestPlaylist] = useGetState<Song[]>([]);

  // 同步歌单相关状态
  const { syncPlaylistId, syncUserId, setSyncPlaylistId, setSyncUserId } = useSettingStore();
  const [syncPlaylists, setSyncPlaylists] = useState<Playlist[]>([]);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isSyncingPlaylist, setIsSyncingPlaylist] = useState(false);
  const [isSyncDialogOpen, setIsSyncDialogOpen] = useState(false);

  // 本地输入状态（用于实时输入，不立即持久化）
  const [localPlaylistId, setLocalPlaylistId] = useState(syncPlaylistId);
  const [localUserId, setLocalUserId] = useState(syncUserId);

  // 默认播放歌单和索引
  const {
    defaultPlaylist,
    getDefaultPlaylist,
    defaultPlaylistIndex,
    getDefaultPlaylistIndex,
    setDefaultPlaylistIndex,
    updateDefaultPlaylist,
  } = useSongStore();

  // 当前播放的歌曲
  const [currentSong, setCurrentSong, getCurrentSong] = useGetState<Song | null>(null);
  // 播放历史
  const [playHistory, setPlayHistory] = useState<Song[]>([]);

  // 弹幕连接
  const clientRef = useRef<LaplaceEventBridgeClient | null>(null);
  const [connectionState, setConnectionState] = useState<'disconnected' | 'connecting' | 'connected' | 'reconnecting'>(
    'disconnected'
  );

  // 前缀配置
  const { prefixConfig, updatePrefixConfig, getPrefixConfig } = useSettingStore();

  // 黑名单关键词配置
  const { blacklist, addToBlacklist, removeFromBlacklist, hasBlacklistedKeyword } = useSettingStore();
  const [newBlacklistItem, setNewBlacklistItem] = useState('');

  // OBS配置相关状态
  const { obsConfig, updateOBSConfig, resetOBSTextTemplate, resetOBSConnection } = useSettingStore();
  const [obsConfiguring, setObsConfiguring] = useState(false);
  const [obsSyncEnabled, setObsSyncEnabled] = useState(false);

  // 添加textarea的ref
  const textTemplateRef = useRef<HTMLTextAreaElement>(null);
  const playlistTemplateRef = useRef<HTMLTextAreaElement>(null);

  // 插入关键字的函数
  const insertKeyword = (ref: React.RefObject<HTMLTextAreaElement>, keyword: string) => {
    const textarea = ref.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const value = textarea.value;
      const newValue = value.substring(0, start) + keyword + value.substring(end);

      // 更新对应的配置
      if (ref === textTemplateRef) {
        updateOBSConfig({ textTemplate: newValue });
      } else if (ref === playlistTemplateRef) {
        updateOBSConfig({ playlistTemplate: newValue });
      }

      // 设置光标位置
      setTimeout(() => {
        textarea.setSelectionRange(start + keyword.length, start + keyword.length);
        textarea.focus();
      }, 0);
    }
  };

  // 歌曲搜索
  const [searchQuery, setSearchQuery] = useState('');
  const [searchSource, setSearchSource] = useState('netease');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isGettingSongInfo, setIsGettingSongInfo] = useState(false);

  // 添加歌曲到点歌列表
  const addSongToRequestPlaylist = (_song: Song, top = false) => {
    const song = {
      ..._song,
      requester: _song.requester || '[系统]',
    };
    setRequestPlaylist(prev => (top ? [song, ...prev] : [...prev, song]));
  };

  // 从点歌列表中移除歌曲
  const removeSongFromRequestPlaylist = (index: number) => {
    setRequestPlaylist(prev => prev.filter((_, i) => i !== index));
  };

  // 添加到播放历史
  const addToPlayHistory = (song: Song) => {
    setPlayHistory(prev => {
      // 添加到开头并限制最多20条
      return [song, ...prev].slice(0, 20);
    });
  };

  // MARK: 播放下一首
  const playNextSong = async (justLoad = false) => {
    // 需要异步一下，防止 requestPlaylist 还未更新
    await Promise.resolve();
    const currentRequestPlaylist = getRequestPlaylist();
    const currentDefaultPlaylist = getDefaultPlaylist();
    const currentSong = getCurrentSong();
    if (currentSong) addToPlayHistory(currentSong);
    const next = selectNextSong(currentRequestPlaylist, currentDefaultPlaylist, getDefaultPlaylistIndex());
    const nextSong = next.song;
    if (next.fromDefault) {
      setDefaultPlaylistIndex(next.index);
      setActiveTab('default');
    } else if (nextSong) {
      setRequestPlaylist(next.requests);
    }

    // 检查是否还有歌曲可播
    if (!nextSong) {
      songLoaderRef.current.cancel();
      setIsGettingSongInfo(false);
      showToast('播放列表为空', 'info');
      setCurrentSong(null);
      return;
    }

    // 更新当前播放歌曲
    setCurrentSong(nextSong);

    // 获取播放链接并播放
    setIsGettingSongInfo(true);
    await songLoaderRef.current.load(nextSong, {
      success: songInfo => {
        if (playerRef.current) {
          playerRef.current.list.clear();
          playerRef.current.list.add(songInfo);
          if (!justLoad) playerRef.current.play();
        }
      },
      error: error => {
        console.error('获取歌曲信息失败:', error);
        showToast('获取歌曲信息失败', 'error');
      },
      finish: () => setIsGettingSongInfo(false),
    });
  };

  // MARK: 开关弹幕点歌
  const { consoleConnected, setConsoleConnected } = useSettingStore();
  const handleToggleDanmu = async () => {
    if (connectionState === 'connecting' || connectionState === 'reconnecting') {
      showToast('弹幕正在连接中', 'info');
      return;
    }

    if (connectionState === 'connected') {
      // 如果已连接，则关闭连接
      if (clientRef.current) {
        clientRef.current.disconnect();
        clientRef.current = null;
        showToast('弹幕连接已关闭', 'info');
      }
      return;
    }

    // 如果控制台弹幕未连接，则自动开启
    if (!consoleConnected) {
      setConsoleConnected(true);
      showToast('已自动开启控制台弹幕连接', 'info');
    }

    // 如果未连接，则创建新的客户端实例
    const client = new LaplaceEventBridgeClient({
      url: 'ws://localhost:9696',
      token: '',
      reconnect: true,
      reconnectInterval: 3000,
      maxReconnectAttempts: 0,
    });

    // 保存客户端实例引用
    clientRef.current = client;

    // MARK: 弹幕消息处理器
    client.on('message', event => {
      const content = event.message;
      if (!content) return;

      const command = parseSongCommand(content, getPrefixConfig());
      if (command?.type === 'skip') {
        handleSkipSongRequest(event.username, event.userType);
      } else if (command?.type === 'request') {
        handleDanmuSongRequest(command.source, command.keyword, event.username);
      }
    });

    // 设置连接状态变化处理器
    client.onConnectionStateChange((state: 'disconnected' | 'connecting' | 'connected' | 'reconnecting') => {
      console.log(`Connection state changed to: ${state}`);
      setConnectionState(state);

      if (state === 'connected') {
        showToast('弹幕连接成功', 'success');
      }
    });

    // 连接服务器
    client.connect().catch(error => {
      console.error('Failed to connect to WebSocket server:', error);
      showToast('弹幕连接失败: ' + error.message, 'error');
    });
  };

  // MARK: 搜索歌曲
  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery) {
      setSearchResults([]);
      return;
    }

    setIsSearching(true);

    try {
      const results = await searchSongs(searchQuery, searchSource);

      setSearchResults(results);

      if (results.length === 0) {
        showToast('未找到相关歌曲', 'info');
      }
    } catch (error) {
      console.error('搜索歌曲出错:', error);
      showToast('搜索歌曲出错', 'error');
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // MARK: 处理弹幕点歌
  const handleDanmuSongRequest = async (source: string, keyword: string, requester = '[匿名]') => {
    try {
      const result = await resolveSongRequest(source, keyword, requester, searchSongs, hasBlacklistedKeyword);
      if (result.song) addSongToRequestPlaylist(result.song);
      showToast(result.message, result.song ? 'info' : 'error');
    } catch (error) {
      console.error('Failed to process danmu song request:', error);
      showToast('弹幕点歌失败', 'error');
    }
  };

  // MARK: 处理切歌请求
  const handleSkipSongRequest = (username: string, userType: number) => {
    const currentRequestPlaylist = getRequestPlaylist();
    const currentSong = getCurrentSong();

    const action = getSkipSongAction(currentSong, currentRequestPlaylist, username, userType);
    if (action.type === 'skip' && currentSong) {
      showToast(`${username}${action.authorized ? '(主播/房管)' : ''}切掉当前歌曲: ${currentSong.name}`, 'info');
      playNextSong();
    } else if (action.type === 'remove') {
      const removedSong = currentRequestPlaylist[action.index];
      removeSongFromRequestPlaylist(action.index);
      showToast(`已切掉${username}在点歌列表中的歌曲: ${removedSong.name}`, 'info');
    }
  };

  // MARK: 添加黑名单关键词
  const handleAddToBlacklist = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newBlacklistItem) {
      return;
    }
    if (blacklist.includes(newBlacklistItem)) {
      showToast('关键词已存在', 'error');
      return;
    }
    addToBlacklist(newBlacklistItem);
    setNewBlacklistItem('');
  };

  // MARK: 开启OBS播放状态同步
  const handleEnableOBSSync = async () => {
    try {
      setObsConfiguring(true);

      try {
        const { once } = await obsWebSocketService.connect();
        once('ConnectionClosed', () => {
          setObsSyncEnabled(false);
        });
      } catch (error) {
        console.error(error);
        showToast('OBS 连接失败', 'error');
        return;
      }

      if (!(await obsWebSocketService.configureSongRequestSource())) {
        showToast('OBS 点歌机源设置失败', 'error');
        return;
      }

      // 开启同步
      setObsSyncEnabled(true);
      showToast('播放状态同步已开启', 'success');
    } catch (error) {
      console.error('开启OBS同步失败:', error);
      showToast('开启播放状态同步失败，请检查 OBS 的服务配置', 'error');
    } finally {
      setObsConfiguring(false);
    }
  };

  // MARK: 关闭OBS播放状态同步
  const handleDisableOBSSync = async () => {
    // 先隐藏点歌机文字源
    await obsWebSocketService.hideSongRequestSource();
    // 然后断开连接
    await obsWebSocketService.disconnect();
    setObsSyncEnabled(false);
    showToast('播放状态同步已关闭', 'info');
  };

  // 同步设置到obs服务中
  useEffect(() => {
    obsWebSocketService.setConfig(obsConfig);
  }, [obsConfig]);

  // 同步播放状态到obs服务中
  useEffect(() => {
    if (obsSyncEnabled) {
      void obsWebSocketService.updateSongRequestText(currentSong, requestPlaylist).catch(error => {
        console.error('同步OBS播放状态失败:', error);
        showToast('同步OBS播放状态失败，请检查OBS连接和文字源', 'error');
      });
    }
  }, [obsSyncEnabled, currentSong, requestPlaylist]);

  // MARK: 同步网易云歌单
  const handleSyncPlaylists = async () => {
    setIsSyncing(true);
    try {
      const playlists = await getUserPlaylists(localUserId);
      // 持久化歌单
      setSyncPlaylists(playlists);
      // 持久化用户ID
      setSyncUserId(localUserId);
      if (playlists.length === 0) {
        showToast('该用户没有公开任何歌单', 'info');
      } else {
        showToast(`成功获取到 ${playlists.length} 个歌单`, 'success');
      }
    } catch (error) {
      console.error('获取用户歌单失败:', error);
      showToast('获取用户歌单失败', 'error');
      setSyncPlaylists([]);
    } finally {
      setIsSyncing(false);
    }
  };

  // MARK: 通过歌单ID同步歌单
  const handleSyncPlaylistById = async (id: string | number) => {
    setIsSyncingPlaylist(true);
    try {
      const playlistDetail = await getPlaylistDetail(id);
      const songs = playlistDetail.tracks.map(convertTrackToSong);

      if (songs.length === 0) {
        showToast('该歌单没有歌曲', 'info');
        return;
      }

      // 更新固定歌单
      updateDefaultPlaylist(songs);
      // 持久化歌单ID
      setSyncPlaylistId(String(id));
      // 关闭模态框
      setIsSyncDialogOpen(false);
      showToast(`成功同步歌单"${playlistDetail.name}"，共${songs.length}首歌曲`, 'success');
    } catch (error) {
      console.error('同步歌单失败:', error);
      showToast('同步歌单失败', 'error');
    } finally {
      setIsSyncingPlaylist(false);
    }
  };

  useEffect(() => {
    // MARK: 初始化播放器
    if (playerContainerRef.current && !playerRef.current) {
      playerRef.current = new APlayer({
        container: playerContainerRef.current,
        audio: [],
        autoplay: false,
        loop: 'none',
        // order: 'random',
        preload: 'auto',
        volume: 0.7,
        mutex: true,
        lrcType: 1,
        listFolded: true,
        listMaxHeight: '0px',
        storageName: 'aplayer-setting',
        theme: '#ff92ad',
      });

      // 监听播放结束事件
      playerRef.current.on('ended', () => {
        console.log('播放结束，切换下一首');
        playNextSong();
      });

      // 如果固定歌单有歌，就先加载第一首
      if (defaultPlaylist.length > 0) {
        addSongToRequestPlaylist(defaultPlaylist[defaultPlaylistIndex]);
        playNextSong(true);
      }
    }

    // 清理函数
    return () => {
      songLoaderRef.current.cancel();
      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }
    };
  }, []);

  // MARK: 渲染播放器区域
  const renderPlayer = () => (
    <Box mb="2">
      <Flex align="center" mb="2">
        <Text size="1" color="gray">
          播放器
        </Text>
        <Separator orientation="horizontal" className="flex-auto ml-2" />
      </Flex>
      <Box position="relative">
        {isGettingSongInfo && (
          <Flex
            position="absolute"
            align="center"
            justify="center"
            width="100%"
            height="100%"
            className="z-1 bg-black/50"
          >
            <Spinner size="3" />
          </Flex>
        )}
        <Box ref={playerContainerRef} className="!m-0" />

        {/* 悬浮的下一首按钮 */}
        <Box position="absolute" top="2" right="2">
          <Tooltip content="下一首">
            <IconButton size="3" color="gray" variant="ghost" onClick={() => playNextSong()}>
              <TrackNextIcon width={16} height={16} />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );

  // MARK: 渲染点歌播放列表项
  const renderRequestPlaylistItem = (song: Song, index: number) => (
    <Flex
      position="relative"
      align="center"
      p="2"
      className="group border-b [border-color:var(--gray-5)]"
      gap="2"
      key={`req-${index}`}
    >
      <Text className="flex-2 w-0" size="2" truncate>
        {song.name}
      </Text>
      <Text className="flex-1 w-0" color="gray" size="1" truncate>
        {Array.isArray(song.artist) ? song.artist.join(' / ') : song.artist}
      </Text>
      <Text className="flex-1 w-0" color="gray" size="1" truncate>
        {song.requester}
      </Text>
      <Box
        position="absolute"
        right="3"
        className="hidden! group-hover:flex! group-hover:[background-color:var(--gray-5)] rounded"
      >
        <Tooltip content="立即播放" side="top">
          <IconButton
            className="!m-0"
            variant="ghost"
            size="2"
            color="ruby"
            onClick={async () => {
              removeSongFromRequestPlaylist(index);
              addSongToRequestPlaylist(song, true);
              playNextSong();
            }}
          >
            <PlayIcon width={14} height={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="置顶" side="top">
          <IconButton
            className="!m-0"
            variant="ghost"
            size="2"
            color="ruby"
            onClick={() => {
              removeSongFromRequestPlaylist(index);
              addSongToRequestPlaylist(song, true);
            }}
          >
            <PinTopIcon width={14} height={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="删除" side="top">
          <IconButton
            className="!m-0"
            variant="ghost"
            size="2"
            color="ruby"
            onClick={() => removeSongFromRequestPlaylist(index)}
          >
            <TrashIcon width={14} height={14} />
          </IconButton>
        </Tooltip>
      </Box>
    </Flex>
  );

  // MARK: 渲染默认播放歌单项
  const renderDefaultPlaylistItem = (song: Song, index: number) => {
    const isCurrent = index === defaultPlaylistIndex;
    return (
      <Flex
        position="relative"
        align="center"
        p="2"
        className="group border-b [border-color:var(--gray-5)]"
        gap="2"
        key={`req-${index}`}
      >
        {isCurrent && <div className="absolute left-0 top-2 bottom-2 w-0.5 bg-[#ff92ad]"></div>}
        <Text className="flex-2 w-0" size="2" truncate>
          {song.name}
        </Text>
        <Text className="flex-1 w-0" color="gray" size="1" truncate>
          {Array.isArray(song.artist) ? song.artist.join(' / ') : song.artist}
        </Text>
        <Box
          position="absolute"
          right="3"
          className="hidden! group-hover:flex! group-hover:[background-color:var(--gray-5)] rounded"
        >
          <Tooltip content="立即播放" side="top">
            <IconButton
              className="!m-0"
              variant="ghost"
              size="2"
              color="ruby"
              onClick={() => {
                addSongToRequestPlaylist(song, true);
                playNextSong();
                setDefaultPlaylistIndex(index);
              }}
            >
              <PlayIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content="置顶点歌" side="top">
            <IconButton
              className="!m-0"
              variant="ghost"
              size="2"
              color="ruby"
              onClick={() => {
                addSongToRequestPlaylist(song, true);
              }}
            >
              <PinTopIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
          <Tooltip content="点歌" side="top">
            <IconButton
              className="!m-0"
              variant="ghost"
              size="2"
              color="ruby"
              onClick={() => {
                addSongToRequestPlaylist(song);
              }}
            >
              <PlusIcon width={14} height={14} />
            </IconButton>
          </Tooltip>
        </Box>
      </Flex>
    );
  };

  // MARK: 渲染播放历史项
  const renderPlayHistoryItem = (song: Song, index: number) => (
    <Flex
      position="relative"
      align="center"
      p="2"
      className="group border-b [border-color:var(--gray-5)]"
      gap="2"
      key={`history-${index}`}
    >
      <Text className="flex-2 w-0" size="2" truncate>
        {song.name}
      </Text>
      <Text className="flex-1 w-0" color="gray" size="1" truncate>
        {Array.isArray(song.artist) ? song.artist.join(' / ') : song.artist}
      </Text>
      <Box
        position="absolute"
        right="3"
        className="hidden! group-hover:flex! group-hover:[background-color:var(--gray-5)] rounded"
      >
        <Tooltip content="立即播放" side="top">
          <IconButton
            className="!m-0"
            variant="ghost"
            size="2"
            color="ruby"
            onClick={() => {
              addSongToRequestPlaylist(song, true);
              playNextSong();
            }}
          >
            <PlayIcon width={14} height={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="置顶点歌" side="top">
          <IconButton
            className="!m-0"
            variant="ghost"
            size="2"
            color="ruby"
            onClick={() => {
              addSongToRequestPlaylist(song, true);
            }}
          >
            <PinTopIcon width={14} height={14} />
          </IconButton>
        </Tooltip>
        <Tooltip content="点歌" side="top">
          <IconButton
            className="!m-0"
            variant="ghost"
            size="2"
            color="ruby"
            onClick={() => {
              addSongToRequestPlaylist(song);
            }}
          >
            <PlusIcon width={14} height={14} />
          </IconButton>
        </Tooltip>
      </Box>
    </Flex>
  );

  // MARK: 渲染播放列表标签页
  const renderPlaylistTabs = () => (
    <Tabs.Root
      className="flex-auto flex flex-col"
      value={activeTab}
      // @ts-expect-error onValueChange类型不匹配
      onValueChange={setActiveTab}
    >
      <Tabs.List color="ruby" size="1">
        <Tabs.Trigger value="request">点歌列表({requestPlaylist.length})</Tabs.Trigger>
        <Tabs.Trigger value="default">固定歌单({defaultPlaylist.length})</Tabs.Trigger>
        <Tabs.Trigger value="history">播放历史({playHistory.length})</Tabs.Trigger>
      </Tabs.List>

      <Tabs.Content value="request" className="flex-auto h-0">
        <ScrollArea type="auto" scrollbars="vertical">
          {requestPlaylist.length > 0 ? (
            requestPlaylist.map((song, index) => renderRequestPlaylistItem(song, index))
          ) : (
            <Text as="p" align="center" color="gray" size="2" className="p-4">
              点歌列表为空
            </Text>
          )}
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="default" className="flex-auto h-0">
        <ScrollArea type="auto" scrollbars="vertical">
          {defaultPlaylist.length > 0 ? (
            defaultPlaylist.map((song, index) => renderDefaultPlaylistItem(song, index))
          ) : (
            <Text as="p" align="center" color="gray" size="2" className="p-4">
              固定歌单为空
            </Text>
          )}
        </ScrollArea>
      </Tabs.Content>

      <Tabs.Content value="history" className="flex-auto h-0">
        <ScrollArea type="auto" scrollbars="vertical">
          {playHistory.length > 0 ? (
            playHistory.map((song, index) => renderPlayHistoryItem(song, index))
          ) : (
            <Text as="p" align="center" color="gray" size="2" className="p-4">
              暂无播放历史
            </Text>
          )}
        </ScrollArea>
      </Tabs.Content>
    </Tabs.Root>
  );

  // MARK: 渲染弹幕点歌控制区域
  const renderDanmuControls = () => (
    <Box className="mb-4">
      <Flex align="center" mb="2">
        <Text size="1" color="gray">
          点歌播放配置
        </Text>
        <Separator orientation="horizontal" className="flex-auto ml-2" />
      </Flex>
      <Flex gap="2" align="center">
        {/* 弹幕点歌状态 */}
        <Badge
          color={
            {
              connected: 'green',
              disconnected: 'red',
              reconnecting: 'gray',
              connecting: 'gray',
            }[connectionState] as BadgeProps['color']
          }
          variant="soft"
          size="3"
        >
          弹幕点歌：
          {
            {
              connected: '已开启',
              disconnected: '未开启',
              reconnecting: '开启中',
              connecting: '开启中',
            }[connectionState]
          }
        </Badge>
        {/* 开关弹幕点歌 */}
        <Tooltip content="如未开启控制台弹幕连接，将同时开启" side="top">
          <Button
            size="2"
            color={connectionState === 'connected' ? 'red' : 'indigo'}
            onClick={handleToggleDanmu}
            disabled={connectionState === 'connecting' || connectionState === 'reconnecting'}
          >
            {connectionState === 'connected' ? '关闭' : '开启'}
          </Button>
        </Tooltip>

        {/* MARK: 点歌前缀配置 */}
        <Popover.Root>
          <Popover.Trigger>
            <Button variant="soft" size="2">
              点歌前缀
            </Button>
          </Popover.Trigger>
          <Popover.Content className="w-48" size="1">
            <Text size="1" color="gray" as="p" mb="2">
              修改实时生效
            </Text>
            {Object.entries(prefixConfig).map(([source, prefix]: [MusicSourceValue, string]) => (
              <Flex key={source} gap="2" align="center" mb="2">
                <Text size="2" className="w-24">
                  {MUSIC_SOURCES.find(s => s.value === source)?.label || source}:
                </Text>
                <TextField.Root
                  size="2"
                  value={prefix}
                  onChange={e => updatePrefixConfig(source, e.target.value)}
                  className="w-16"
                />
              </Flex>
            ))}
          </Popover.Content>
        </Popover.Root>

        {/* MARK: 点歌黑名单配置 */}
        <Popover.Root>
          <Popover.Trigger>
            <Button variant="soft" size="2">
              黑名单
            </Button>
          </Popover.Trigger>
          <Popover.Content className="w-48" size="1">
            <Text size="1" color="gray" as="p" mb="2">
              关键词(不区分大小写)
            </Text>
            <form onSubmit={handleAddToBlacklist} className="flex gap-2 mb-2">
              <TextField.Root
                size="2"
                placeholder="输入关键词"
                value={newBlacklistItem}
                onChange={e => setNewBlacklistItem(e.target.value.trim())}
              />
              <Button size="2" type="submit">
                添加
              </Button>
            </form>

            <Text size="2" color="gray" as="p">
              当前黑名单：
            </Text>
            <ScrollArea type="auto" scrollbars="vertical" className="max-h-50">
              {blacklist.length > 0 ? (
                <Flex direction="column">
                  {blacklist.map(keyword => (
                    <Flex
                      key={keyword}
                      justify="between"
                      align="center"
                      className="pt-1 pb-1 border-b [border-color:var(--gray-5)]"
                    >
                      <Text size="2">{keyword}</Text>
                      <Tooltip content="删除" side="top">
                        <IconButton
                          className="!m-0 !mr-3"
                          variant="ghost"
                          size="2"
                          color="ruby"
                          onClick={() => removeFromBlacklist(keyword)}
                        >
                          <TrashIcon width={14} height={14} />
                        </IconButton>
                      </Tooltip>
                    </Flex>
                  ))}
                </Flex>
              ) : (
                <Text size="2" color="gray">
                  无
                </Text>
              )}
            </ScrollArea>
          </Popover.Content>
        </Popover.Root>

        {/* MARK: 管理固定歌单 */}
        <Dialog.Root open={isSyncDialogOpen} onOpenChange={setIsSyncDialogOpen}>
          <Dialog.Trigger>
            <Button variant="soft" size="2">
              管理固定歌单
            </Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="500px">
            <Dialog.Title>管理固定歌单</Dialog.Title>
            <Dialog.Description size="1" mb="4" color="gray">
              直接输入网易云歌单 ID 同步，或通过网易云用户 ID 获取所有公开歌单，再挑选同步
            </Dialog.Description>

            <Flex direction="column" gap="4">
              <Flex gap="2" align="center">
                <Text className="w-14">歌单ID:</Text>
                <TextField.Root
                  className="flex-1"
                  placeholder="请输入网易云歌单ID"
                  value={localPlaylistId}
                  onChange={e => setLocalPlaylistId(e.target.value.trim())}
                />
                <Button
                  onClick={() => handleSyncPlaylistById(localPlaylistId)}
                  disabled={isSyncingPlaylist || !localPlaylistId}
                >
                  {isSyncingPlaylist ? <Spinner /> : '替换歌单'}
                </Button>
                <Button color="red" variant="soft" onClick={() => updateDefaultPlaylist([])}>
                  清空歌单
                </Button>
              </Flex>

              <Flex gap="2" align="center">
                <Text className="w-14">用户ID:</Text>
                <TextField.Root
                  className="flex-1"
                  placeholder="请输入网易云用户ID"
                  value={localUserId}
                  onChange={e => setLocalUserId(e.target.value.trim())}
                />
                <Button onClick={handleSyncPlaylists} disabled={isSyncing || !localUserId}>
                  {isSyncing ? <Spinner /> : '获取歌单'}
                </Button>
              </Flex>
            </Flex>

            {/* MARK: 歌单列表 */}
            {syncPlaylists.length > 0 && (
              <Box mt="4">
                <Text as="div" mb="2" weight="bold">
                  歌单列表
                </Text>
                <ScrollArea type="auto" scrollbars="vertical" className="max-h-100">
                  <Flex direction="column">
                    {syncPlaylists.map(playlist => (
                      <Flex
                        key={playlist.id}
                        position="relative"
                        align="center"
                        p="2"
                        className="group border-b [border-color:var(--gray-5)]"
                        gap="2"
                      >
                        <img src={playlist.coverImgUrl} alt={playlist.name} className="w-8 h-8 rounded object-cover" />
                        <Flex direction="column" className="flex-auto">
                          <Text size="2" truncate>
                            {playlist.name}
                          </Text>
                          <Text size="1" color="gray">
                            {playlist.trackCount} 首歌曲
                          </Text>
                        </Flex>
                        <Box
                          position="absolute"
                          right="3"
                          className="hidden! group-hover:flex! group-hover:[background-color:var(--gray-5)] rounded"
                        >
                          <Tooltip content="同步此歌单" side="top">
                            <IconButton
                              className="!m-0"
                              variant="ghost"
                              size="3"
                              color="ruby"
                              onClick={() => {
                                setLocalPlaylistId(playlist.id + '');
                                handleSyncPlaylistById(playlist.id);
                              }}
                              disabled={isSyncingPlaylist}
                            >
                              {isSyncingPlaylist ? <Spinner size="2" /> : <UpdateIcon width={14} height={14} />}
                            </IconButton>
                          </Tooltip>
                        </Box>
                      </Flex>
                    ))}
                  </Flex>
                </ScrollArea>
              </Box>
            )}
          </Dialog.Content>
        </Dialog.Root>
      </Flex>
    </Box>
  );

  // MARK: 渲染播放状态同步控制区域
  const renderSyncControls = () => (
    <Box className="mb-4">
      <Flex align="center" mb="2">
        <Text size="1" color="gray">
          同步 OBS 配置
        </Text>
        <Tooltip
          content="需要先在 OBS 程序的 [顶部菜单栏] -> [工具] -> [WebSocket 服务器设置] 中勾选 [开启 WebSocket 服务器]，同时保持端口和密码与连接配置中一致(嫌麻烦可以去掉 [开启身份认证] 的勾选)"
          side="top"
        >
          <InfoCircledIcon width={14} height={14} className="ml-1 cursor-help" />
        </Tooltip>
        <Separator orientation="horizontal" className="flex-auto ml-2" />
      </Flex>
      <Flex gap="2" align="center">
        {/* 播放状态同步状态 */}
        <Badge color={obsConfiguring ? 'gray' : obsSyncEnabled ? 'green' : 'red'} variant="soft" size="3">
          播放状态同步：
          {obsConfiguring ? '配置中' : obsSyncEnabled ? '已开启' : '未开启'}
        </Badge>

        {/* 开启/关闭播放状态同步 */}
        <Tooltip content="开启时会自动在当前OBS场景中设置点歌机源，关闭时将自动隐藏该源" side="top">
          <Button
            size="2"
            color={obsSyncEnabled ? 'red' : 'indigo'}
            onClick={obsSyncEnabled ? handleDisableOBSSync : handleEnableOBSSync}
            disabled={obsConfiguring}
          >
            {obsSyncEnabled ? '关闭' : '开启'}
          </Button>
        </Tooltip>

        {/* MARK: 文字模板配置 */}
        <Dialog.Root>
          <Dialog.Trigger>
            <Button variant="soft" size="2">
              文字模板配置
            </Button>
          </Dialog.Trigger>
          <Dialog.Content maxWidth="500px">
            <Dialog.Title>文字模板配置</Dialog.Title>
            <Dialog.Description size="1" mb="4" color="gray">
              通过模板自由拼装播放状态文本
            </Dialog.Description>

            {/* 文字源模板配置 */}
            <Text size="2" as="p" mb="2">
              文字源模板
            </Text>
            <Flex direction="row" gap="2" align="center" mb="2" wrap="wrap">
              <Text size="1" color="gray">
                关键字:
              </Text>
              {[
                { key: '{歌曲名}', label: '歌曲名' },
                { key: '{歌手}', label: '歌手' },
                { key: '{点歌者}', label: '点歌者' },
                { key: '{点歌列表}', label: '点歌列表' },
              ].map(({ key, label }) => (
                <Button key={key} variant="soft" size="1" onClick={() => insertKeyword(textTemplateRef, key)}>
                  {label}
                </Button>
              ))}
            </Flex>
            <TextArea
              mb="4"
              value={obsConfig.textTemplate}
              onChange={e => updateOBSConfig({ textTemplate: e.target.value })}
              rows={3}
              ref={textTemplateRef}
            />

            <Text as="p" mb="2">
              点歌列表项模板
            </Text>
            <Flex direction="row" gap="2" align="center" mb="2" wrap="wrap">
              <Text size="1" color="gray">
                关键字:
              </Text>
              {[
                { key: '{序号}', label: '序号' },
                { key: '{歌曲名}', label: '歌曲名' },
                { key: '{歌手}', label: '歌手' },
                { key: '{点歌者}', label: '点歌者' },
              ].map(({ key, label }) => (
                <Button key={key} variant="soft" size="1" onClick={() => insertKeyword(playlistTemplateRef, key)}>
                  {label}
                </Button>
              ))}
            </Flex>
            <TextArea
              mb="4"
              value={obsConfig.playlistTemplate}
              onChange={e => updateOBSConfig({ playlistTemplate: e.target.value })}
              rows={2}
              ref={playlistTemplateRef}
            />

            {/* 重置按钮 */}
            <Flex justify="end">
              <Button
                variant="soft"
                color="gray"
                size="1"
                onClick={() => {
                  resetOBSTextTemplate();
                  showToast('文字模板已重置为默认值', 'success');
                }}
              >
                重置设置
              </Button>
            </Flex>
          </Dialog.Content>
        </Dialog.Root>

        {/* MARK: OBS连接配置 */}
        <Popover.Root>
          <Popover.Trigger>
            <Button variant="soft" size="2">
              连接配置
            </Button>
          </Popover.Trigger>
          <Popover.Content style={{ width: 200 }}>
            <Flex direction="column" gap="2">
              <Text size="1" color="gray" as="p">
                OBS WebSocket 服务器
              </Text>

              <Flex gap="2" align="center">
                <Text size="1" className="w-8">
                  地址:
                </Text>
                <TextField.Root
                  placeholder="localhost"
                  value={obsConfig.address}
                  onChange={e => updateOBSConfig({ address: e.target.value.trim() })}
                  className="flex-1"
                />
              </Flex>

              <Flex gap="2" align="center">
                <Text size="1" className="w-8">
                  端口:
                </Text>
                <TextField.Root
                  type="number"
                  placeholder="4455"
                  value={obsConfig.port}
                  onChange={e => updateOBSConfig({ port: parseInt(e.target.value) })}
                  className="flex-1"
                />
              </Flex>

              <Flex gap="2" align="center">
                <Text size="1" className="w-8">
                  密码:
                </Text>
                <TextField.Root
                  type="password"
                  placeholder="留空表示无密码"
                  value={obsConfig.password}
                  onChange={e => updateOBSConfig({ password: e.target.value.trim() })}
                  className="flex-1"
                />
              </Flex>

              {/* 重置按钮 */}
              <Flex justify="end">
                <Button
                  variant="soft"
                  color="gray"
                  size="1"
                  onClick={() => {
                    resetOBSConnection();
                    showToast('连接配置已重置为默认值', 'success');
                  }}
                >
                  重置设置
                </Button>
              </Flex>
            </Flex>
          </Popover.Content>
        </Popover.Root>
      </Flex>
    </Box>
  );

  // MARK: 渲染搜索区域
  const renderSearchSection = () => (
    <Flex direction="column" className="flex-auto h-0">
      <Flex align="center" className="mb-2">
        <Text size="1" color="gray">
          搜索歌曲
        </Text>
        <Separator orientation="horizontal" className="flex-auto ml-2" />
      </Flex>
      <form onSubmit={handleSearch} className="flex gap-2">
        <Select.Root value={searchSource} onValueChange={setSearchSource} size="2">
          <Select.Trigger className="w-30" />
          <Select.Content>
            {MUSIC_SOURCES.map(source => (
              <Select.Item key={source.value} value={source.value}>
                {source.label}
              </Select.Item>
            ))}
          </Select.Content>
        </Select.Root>
        <TextField.Root
          className="flex-auto"
          placeholder="搜索歌曲、歌手或专辑"
          value={searchQuery}
          size="2"
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value.trim())}
        />
        <Button type="submit" disabled={isSearching} size="2" variant="surface">
          <MagnifyingGlassIcon />
          {isSearching ? '搜索中...' : '搜索'}
        </Button>
      </form>
      {renderSearchResults()}
    </Flex>
  );

  // MARK: 渲染搜索结果
  const renderSearchResults = () => (
    <ScrollArea type="auto" scrollbars="vertical">
      {searchResults.map(song => (
        <Flex
          position="relative"
          align="center"
          p="2"
          className="group border-b [border-color:var(--gray-5)]"
          gap="2"
          key={`${song.source}-${song.id}`}
        >
          <Text className="flex-2 w-0" size="2" truncate>
            {song.name}
          </Text>
          <Text className="flex-1 w-0" color="gray" size="1" truncate>
            {Array.isArray(song.artist) ? song.artist.join(' / ') : song.artist}
          </Text>
          <Text className="flex-1 w-0" color="gray" size="1" truncate>
            {song.album}
          </Text>
          <Box
            position="absolute"
            right="3"
            className="hidden! group-hover:flex! group-hover:[background-color:var(--gray-5)] rounded"
          >
            <Tooltip content="立即播放" side="top">
              <IconButton
                className="!m-0"
                variant="ghost"
                size="2"
                color="ruby"
                onClick={() => {
                  addSongToRequestPlaylist(song, true);
                  playNextSong();
                }}
              >
                <PlayIcon width={14} height={14} />
              </IconButton>
            </Tooltip>
            <Tooltip content="置顶点歌" side="top">
              <IconButton
                className="!m-0"
                variant="ghost"
                size="2"
                color="ruby"
                onClick={() => {
                  addSongToRequestPlaylist(song, true);
                }}
              >
                <PinTopIcon width={14} height={14} />
              </IconButton>
            </Tooltip>
            <Tooltip content="点歌" side="top">
              <IconButton
                className="!m-0"
                variant="ghost"
                size="2"
                color="ruby"
                onClick={() => {
                  addSongToRequestPlaylist(song);
                }}
              >
                <PlusIcon width={14} height={14} />
              </IconButton>
            </Tooltip>
          </Box>
        </Flex>
      ))}
      {searchResults.length === 0 && (
        <Text size="2" align="center" color="gray" as="p" className="p-4">
          歌曲服务由GD音乐台(music.gdstudio.xyz)提供
        </Text>
      )}
    </ScrollArea>
  );

  return (
    <Flex height="100%" maxHeight="100%" gap="4">
      {/* 左侧：播放区域 */}
      <Flex direction="column" className="flex-2 w-0">
        {renderPlayer()}
        {renderPlaylistTabs()}
      </Flex>

      {/* 右侧：操作区域 */}
      <Flex direction="column" className="flex-3 w-0">
        {renderDanmuControls()}
        {renderSyncControls()}
        {renderSearchSection()}
      </Flex>
    </Flex>
  );
};

export default SongRequest;
