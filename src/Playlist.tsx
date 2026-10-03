import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Play, SkipBack, SkipForward, ListMusic, ArrowUp, ArrowDown, X } from 'lucide-react';
import type { Asset, Song } from './lib/types';
import { getAssetFile } from './lib/storage';

type Track = { id: string; songId: string; title: string; name: string };
type Mode = 'order' | 'shuffle';
const key = 'worship-playlist-v1';
function read(): { ids: string[]; mode: Mode } {
  try { const v = JSON.parse(localStorage.getItem(key) || '{}'); return { ids: Array.isArray(v.ids) ? [...new Set<string>(v.ids.filter((x: unknown) => typeof x === 'string'))] : [], mode: v.mode === 'shuffle' ? 'shuffle' : 'order' }; }
  catch { return { ids: [], mode: 'order' }; }
}
function usePlayer() {
  const [initial] = useState(read);
  const [ids, setIds] = useState(initial.ids);
  const [mode, setMode] = useState<Mode>(initial.mode);
  const [tracks, setTracks] = useState<Track[]>([]);
  const [current, setCurrent] = useState('');
  const [request, setRequest] = useState(0);
  const [error, setError] = useState('');
  const [storageError, setStorageError] = useState('');
  const [status, setStatus] = useState('');
  const audio = useRef<HTMLAudioElement>(null);
  const visited = useRef<string[]>([]);
  const history = useRef<string[]>([]);
  const generation = useRef(0);
  const objectUrl = useRef('');
  const queue = ids.map(id => tracks.find(t => t.id === id)).filter((t): t is Track => !!t);
  const active = tracks.find(t => t.id === current);
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify({ ids, mode })); setStorageError(''); } catch { setStorageError('无法保存播放列表，关闭页面后可能丢失。'); } }, [ids, mode]);
  function stop() {
    generation.current++;
    audio.current?.pause();
    audio.current?.removeAttribute('src');
    audio.current?.load();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
    setCurrent(''); setError(''); setStatus('');
  }
  function sync(songs: Song[], assets: Asset[]) {
    const available = assets.filter(a => a.kind === 'audio' && songs.some(s => s.id === a.songId)).map(a => ({ id: a.id, songId: a.songId, title: songs.find(s => s.id === a.songId)!.title, name: a.name }));
    setTracks(available);
    setIds(old => old.filter(id => available.some(a => a.id === id)));
    if (current && !available.some(a => a.id === current)) stop();
  }
  function start(id: string, reset = true) {
    if (reset) { visited.current = []; history.current = []; }
    if (!visited.current.includes(id)) visited.current.push(id);
    history.current.push(id);
    setCurrent(id); setRequest(n => n + 1);
  }
  function play(id: string) { setIds(old => old.includes(id) ? old : [...old, id]); start(id); }
  function add(id: string) { setIds(old => old.includes(id) ? old : [...old, id]); }
  function playAll(list: string[]) { if (!list.length) return; setIds([...new Set(list)]); const id = mode === 'shuffle' ? list[Math.floor(Math.random() * list.length)]! : list[0]!; start(id); }
  function next() {
    let id: string | undefined;
    if (mode === 'shuffle') {
      const remaining = ids.filter(id => id !== current && !visited.current.includes(id));
      id = remaining[Math.floor(Math.random() * remaining.length)];
    } else { id = ids[ids.indexOf(current) + 1]; }
    if (id) start(id, false);
    else { audio.current?.pause(); setStatus('播放列表已播放完毕，点击“播放列表”可重新开始。'); }
  }
  function previous() {
    if (history.current.length > 1) { history.current.pop(); const id = history.current.pop()!; start(id, false); }
    else if (mode === 'order' && ids.indexOf(current) > 0) start(ids[ids.indexOf(current) - 1]!, false);
    else if (audio.current) { audio.current.currentTime = 0; void audio.current.play().catch(() => setError('请点击播放器的播放按钮继续。')); }
  }
  function remove(id: string) { if (id === current) stop(); setIds(old => old.filter(x => x !== id)); history.current = history.current.filter(x => x !== id); }
  function move(id: string, delta: number) { setIds(old => { const out = [...old]; const i = out.indexOf(id); const j = i + delta; if (i >= 0 && j >= 0 && j < out.length) [out[i], out[j]] = [out[j]!, out[i]!]; return out; }); }
  function changeMode(value: Mode) { setMode(value); visited.current = current ? [current] : []; setStatus(''); }
  useEffect(() => {
    if (!current) return;
    const token = ++generation.current;
    const element = audio.current;
    element?.pause(); element?.removeAttribute('src'); element?.load();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = '';
    setError(''); setStatus('正在加载音频…');
    void getAssetFile(current).then(async file => {
      if (token !== generation.current || !element) return;
      if (!file) throw Error('音频文件缺失，请移除此项或从备份恢复。');
      const url = URL.createObjectURL(file); objectUrl.current = url; element.src = url;
      setStatus('');
      try { await element.play(); } catch { if (token === generation.current) setError('自动播放未成功，请点击播放器的播放按钮；仍无法播放时请检查音频格式。'); }
    }).catch(e => { if (token === generation.current) { setStatus(''); setError(e instanceof Error ? e.message : '音频读取失败，请重试。'); } });
    return () => { generation.current++; element?.pause(); if (objectUrl.current) URL.revokeObjectURL(objectUrl.current); objectUrl.current = ''; };
  }, [current, request]);
  return { queue, ids, mode, active, audio, error, storageError, status, sync, stop, play, add, playAll, next, previous, remove, move, changeMode, setError, setStatus };
}
const Context = createContext<ReturnType<typeof usePlayer> | null>(null);
export function PlaylistProvider({ children }: { children: ReactNode }) { const player = usePlayer(); return <Context.Provider value={player}>{children}</Context.Provider>; }
export function usePlaylist() { const p = useContext(Context); if (!p) throw Error('Missing playlist provider'); return p; }
function ModeSelect() { const p = usePlaylist(); return <select aria-label="播放方式" value={p.mode} onChange={e => p.changeMode(e.target.value as Mode)}><option value="order">顺序播放</option><option value="shuffle">随机播放</option></select>; }
export function PlaylistPage() {
  const p = usePlaylist();
  return <><div className="heading"><h1>播放列表</h1><p>为此刻的敬拜，选一组歌曲。</p></div><section className="panel"><div className="playlist-toolbar"><button className="primary" disabled={!p.queue.length} onClick={() => p.playAll(p.ids)}><Play />播放列表</button><ModeSelect /><span>{p.queue.length} 个音频</span></div><p className="muted">顺序播放按下方排列；随机播放每轮不重复，全部播完后停止。移除列表项不会删除歌曲或附件。</p>{!p.queue.length && <p>列表还是空的。到歌曲详情添加音频，或在曲库点击“播放全部”。</p>}<ol className="playlist-items">{p.queue.map((t, i) => <li key={t.id} className={p.active?.id === t.id ? 'is-current' : ''}><div className="track-copy"><a href={`#/song/${t.songId}`}><strong>{t.title}</strong></a><small>{t.name}{p.active?.id === t.id ? ' · 当前音频' : ''}</small></div><div className="track-actions"><button aria-label={`播放 ${t.title} ${t.name}`} onClick={() => p.play(t.id)}><Play /></button><button aria-label={`上移 ${t.title}`} disabled={i === 0} onClick={() => p.move(t.id, -1)}><ArrowUp /></button><button aria-label={`下移 ${t.title}`} disabled={i === p.queue.length - 1} onClick={() => p.move(t.id, 1)}><ArrowDown /></button><button aria-label={`移除 ${t.title} ${t.name}`} onClick={() => p.remove(t.id)}><X /></button></div></li>)}</ol><p className="muted">列表和播放方式保存在此设备；刷新后保留列表，不会自动播放。目前 .wlib 备份不包含播放列表。</p>{p.storageError && <p role="alert">{p.storageError}</p>}</section></>;
}
export function PlayerBar() {
  const p = usePlaylist();
  return <section className="global-player" aria-label="全局播放器" hidden={!p.active}><div className="player-inner"><div className="now-playing"><div className="track-copy"><a href={`#/song/${p.active?.songId}`}><strong>{p.active?.title}</strong></a><small>{p.active?.name}</small></div><a className="queue-link" href="#/playlist" aria-label="查看播放列表"><ListMusic />{p.queue.length}</a><button aria-label="停止播放" onClick={p.stop}><X /></button></div><div className="playback-controls"><button aria-label="上一首" onClick={p.previous}><SkipBack /></button><audio ref={p.audio} controls preload="metadata" onEnded={p.next} onPlay={() => { p.setError(''); p.setStatus(''); }} onError={() => p.setError('此音频无法播放，请检查文件，或点击下一首。')}/><button aria-label="下一首" onClick={p.next}><SkipForward /></button><ModeSelect /></div>{p.status && <p role="status">{p.status}</p>}{p.error && <p role="alert">{p.error}</p>}</div></section>;
}
