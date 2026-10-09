import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SearchResult } from '../services/musicApi';

export type Song = SearchResult & {
  requester?: string;
};

interface SongState {
  // 默认播放列表
  defaultPlaylist: Song[];
  // 当前播放索引
  defaultPlaylistIndex: number;

  // 获取当前播放列表（用于在闭包中获取最新值）
  getDefaultPlaylist: () => Song[];
  // 获取当前播放索引（用于在闭包中获取最新值）
  getDefaultPlaylistIndex: () => number;
  // 添加歌曲到默认播放列表
  addToDefaultPlaylist: (song: Song) => void;
  // 从默认播放列表移除歌曲
  removeFromDefaultPlaylist: (index: number) => void;
  // 更新默认播放列表
  updateDefaultPlaylist: (songs: Song[]) => void;
  // 更新当前播放索引
  setDefaultPlaylistIndex: (index: number) => void;
  // 重置播放索引
  resetDefaultPlaylistIndex: () => void;
}

const STORAGE_KEY = 'song-store';

// 音乐源列表
export const MUSIC_SOURCES = [
  { value: 'netease', label: '网易云音乐', prefix: '点歌' },
  { value: 'kuwo', label: '酷我音乐', prefix: '点k歌' },
  { value: 'tidal', label: 'Tidal', prefix: '点t歌' },
  { value: 'joox', label: 'JOOX', prefix: '点j歌' },
  // 已禁用的音乐源:
  // { value: 'tencent', label: 'QQ音乐' },
  // { value: 'kugou', label: '酷狗音乐' },
  // { value: 'migu', label: '咪咕音乐' },
  // { value: 'spotify', label: 'Spotify' },
  // { value: 'ytmusic', label: 'YouTube Music' },
  // { value: 'qobuz', label: 'Qobuz' },
  // { value: 'deezer', label: 'Deezer' },
  // { value: 'ximalaya', label: '喜马拉雅' },
  // { value: 'apple', label: '苹果' },
] as const;
export type MusicSourceValue = (typeof MUSIC_SOURCES)[number]['value'];

// 默认播放列表
const DEFAULT_PLAYLIST: Song[] = [
  {
    album: 'My Story,Your Song 经典全记录',
    artist: ['孙燕姿'],
    id: '287221',
    lyric_id: '287221',
    name: '绿光',
    pic_id: '109951166887388958',
    source: 'netease',
  },
  {
    album: '火车驶向云外，梦安魂于九霄',
    artist: ['刺猬'],
    id: '528272281',
    lyric_id: '528272281',
    name: '火车驶向云外，梦安魂于九霄',
    pic_id: '109951163102691938',
    source: 'netease',
  },
  {
    album: '七里香',
    artist: ['周杰伦'],
    id: '94237',
    lyric_id: '94237',
    name: '七里香',
    pic_id: '120/s4s81/2/3200337129.jpg',
    source: 'kuwo',
  },
];

export const useSongStore = create<SongState>()(
  persist(
    (set, get) => ({
      defaultPlaylist: DEFAULT_PLAYLIST,
      defaultPlaylistIndex: 0,

      // 获取当前播放列表的getter方法
      getDefaultPlaylist: () => get().defaultPlaylist,
      // 获取当前播放索引的getter方法
      getDefaultPlaylistIndex: () => get().defaultPlaylistIndex,
      addToDefaultPlaylist: song => {
        set(state => ({
          defaultPlaylist: [...state.defaultPlaylist, song],
        }));
      },
      removeFromDefaultPlaylist: index => {
        if (!Number.isInteger(index) || index < 0 || index >= get().defaultPlaylist.length) return;
        set(state => {
          const newPlaylist = [...state.defaultPlaylist];
          newPlaylist.splice(index, 1);
          return {
            defaultPlaylist: newPlaylist,
            // 如果删除的是当前播放的歌曲或之前的歌曲，需要调整索引
            defaultPlaylistIndex:
              state.defaultPlaylistIndex >= index && state.defaultPlaylistIndex > 0
                ? state.defaultPlaylistIndex - 1
                : state.defaultPlaylistIndex,
          };
        });
      },
      updateDefaultPlaylist: songs => {
        set({
          defaultPlaylist: songs,
          defaultPlaylistIndex: 0, // 重置索引
        });
      },
      setDefaultPlaylistIndex: index => {
        if (!Number.isInteger(index) || index < 0 || index >= get().defaultPlaylist.length) return;
        set({ defaultPlaylistIndex: index });
      },
      resetDefaultPlaylistIndex: () => {
        set({ defaultPlaylistIndex: 0 });
      },
    }),
    {
      name: STORAGE_KEY,
      // 只保存必要的数据
      partialize: state => ({
        defaultPlaylist: state.defaultPlaylist,
        defaultPlaylistIndex: state.defaultPlaylistIndex,
      }),
      onRehydrateStorage: () => state => {
        if (
          state &&
          (!Number.isInteger(state.defaultPlaylistIndex) ||
            state.defaultPlaylistIndex < 0 ||
            state.defaultPlaylistIndex >= state.defaultPlaylist.length)
        )
          state.resetDefaultPlaylistIndex();
      },
    }
  )
);
