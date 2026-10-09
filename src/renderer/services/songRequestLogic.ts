import type { Song } from '../store/songStore';
import type { Track, getSongInfo } from './musicApi';

export function parseSongCommand(content: string, prefixes: Record<string, string>) {
  if (content.trim() === '切歌') return { type: 'skip' as const };
  // Empty prefixes match everything; overlapping prefixes use the most specific one.
  const match = Object.entries(prefixes)
    .filter(([, prefix]) => prefix && content.startsWith(prefix))
    .sort((a, b) => b[1].length - a[1].length)[0];
  if (!match) return null;
  const keyword = content.slice(match[1].length).trim();
  return keyword ? { type: 'request' as const, source: match[0], keyword } : null;
}

export function getSkipSongAction(current: Song | null, queue: Song[], username: string, userType: number) {
  if (current && (userType === 100 || userType === 1)) return { type: 'skip' as const, authorized: true };
  if (current?.requester === '[系统]') return { type: 'ignore' as const };
  if (current && current.requester === username) return { type: 'skip' as const, authorized: false };
  const index = queue.findIndex(song => song.requester === username);
  return index >= 0 ? { type: 'remove' as const, index } : { type: 'ignore' as const };
}

export function selectNextSong(requests: Song[], playlist: Song[], currentIndex: number) {
  if (requests.length) {
    return { song: requests[0], requests: requests.slice(1), index: currentIndex, fromDefault: false };
  }
  if (!playlist.length) return { song: null, requests, index: 0, fromDefault: false };
  const index =
    Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < playlist.length
      ? (currentIndex + 1) % playlist.length
      : 0;
  return { song: playlist[index], requests, index, fromDefault: true };
}

export async function resolveSongRequest(
  source: string,
  keyword: string,
  requester: string,
  search: (keyword: string, source: string) => Promise<Song[]>,
  isBlocked: (text: string) => boolean
) {
  for (const [label, value] of [
    ['关键词点歌', keyword],
    ['关键词点歌者', requester],
  ]) {
    if (isBlocked(value)) return { song: null, message: `已拦截黑名单${label}: ${value}` };
  }
  const results = await search(keyword, source);
  if (!results.length) return { song: null, message: `${requester}点歌未找到: ${keyword}` };
  const song = { ...results[0], requester };
  const artist = Array.isArray(song.artist) ? song.artist.join('/') : song.artist || '';
  for (const [label, value] of [
    ['歌曲名', song.name],
    ['歌手', artist],
  ]) {
    if (value && isBlocked(value)) return { song: null, message: `已拦截黑名单关键词${label}: ${value}` };
  }
  return { song, message: `已添加${requester}的点歌: ${song.name} - ${artist || '未知艺术家'}` };
}

export function convertTrackToSong(track: Track): Song {
  return {
    id: String(track.id),
    name: track.name,
    artist: track.ar.map(artist => artist.name),
    album: track.al.name,
    source: 'netease',
    pic_id: track.al.pic_str || String(track.al.pic),
    lyric_id: String(track.id),
  };
}

export function createLatestSongLoader(load: typeof getSongInfo) {
  let revision = 0;
  return {
    cancel() {
      revision += 1;
    },
    async load(
      song: Song,
      callbacks: {
        success: (audio: Awaited<ReturnType<typeof getSongInfo>>) => void;
        error: (error: unknown) => void;
        finish: () => void;
      }
    ) {
      const current = ++revision;
      try {
        const audio = await load(song);
        if (current === revision) callbacks.success(audio);
      } catch (error) {
        if (current === revision) callbacks.error(error);
      } finally {
        if (current === revision) callbacks.finish();
      }
    },
  };
}
