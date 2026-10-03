import { PlaylistPage, PlayerBar, usePlaylist } from './Playlist';
import { useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import { ArrowLeft, Archive, Plus, Search, ChevronRight, Music2, FileText, Download, ExternalLink, Trash2, Pencil, ShieldCheck, X, Upload } from 'lucide-react';
import * as db from './lib/storage';
import { createBackup, inspectBackup, restoreBackup } from './lib/backup';
import type { BackupSummary } from './lib/backup';
import { ASSET_KINDS } from './lib/types';
import type { Song, SongInput, Asset, AssetKind } from './lib/types';
const names: Record<AssetKind, string> = { audio: '音频', slides: '歌词 PPT', score: '乐谱', document: '文档', image: '图片', other: '其他' };
const empty: SongInput = { title: '', artist: '', version: '', lyricsZh: '', lyricsEn: '', key: '', category: '', tags: [], notes: '' };
const size = (n: number) => n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`;
function errorText(e: unknown) { return e instanceof DOMException && e.name === 'QuotaExceededError' ? '设备存储空间不足。请释放空间后重试，建议先导出备份。' : e instanceof Error ? e.message : '操作未完成，请重试。'; }
function guess(file: File): AssetKind { const ext = file.name.split('.').pop()?.toLowerCase() || ''; return /^(mp3|m4a|wav|aac|ogg|flac)$/.test(ext) ? 'audio' : /^(ppt|pptx|key)$/.test(ext) ? 'slides' : /^(png|jpg|jpeg|webp|heic|gif)$/.test(ext) ? 'image' : /^(pdf|doc|docx|txt)$/.test(ext) ? 'document' : 'other'; }
function download(blob: Blob, name: string) { const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = name; document.body.append(a); a.click(); a.remove(); window.setTimeout(() => URL.revokeObjectURL(url), 120000); }
export default function App() {
    const player = usePlaylist();
    const [route, setRoute] = useState(location.hash.slice(1) || '/');
    const [songs, setSongs] = useState<Song[]>([]);
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [notice, setNotice] = useState('');
    const [busy, setBusy] = useState(false);
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('');
    const [tag, setTag] = useState('');
    const [language, setLanguage] = useState('zh');
    const [stats, setStats] = useState<{
        usage: number;
        quota: number;
    } | null>(null);
    const [backup, setBackup] = useState<{
        file: File;
        summary: BackupSummary;
    } | null>(null);
    const [progress, setProgress] = useState('');
    const [lastBackup, setLastBackup] = useState(() => { try {
        return localStorage.getItem('lastBackup') || '';
    }
    catch {
        return '';
    } });
    const operation = useRef(false);
    const dirty = useRef(false);
    const [confirm, setConfirm] = useState<{
        title: string;
        text: string;
        action: () => void;
    } | null>(null);
    const dialog = useRef<HTMLDialogElement>(null);
    const supported = typeof navigator.storage?.getDirectory === 'function';
    const { needRefresh: [refresh, setRefresh], updateServiceWorker } = useRegisterSW();
    async function reload() { const [s, a, st] = await Promise.all([db.getAllSongs(), db.getAllAssets(), db.getStorageStats()]); setSongs(s.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))); setAssets(a); setStats(st); player.sync(s, a); }
    useEffect(() => { reload().catch(e => setError(errorText(e))).finally(() => setLoading(false)); navigator.storage?.persist?.().catch(() => { }); }, []);
    useEffect(() => { function hash() { const next = location.hash.slice(1) || '/'; if (operation.current || dirty.current) {
        history.replaceState(null, '', `#${route}`);
        if (!operation.current)
            setConfirm({ title: '放弃未保存的修改？', text: '本次修改和新选择的附件不会保存。', action: () => { dirty.current = false; location.hash = next; } });
        return;
    } setRoute(next); setError(''); window.scrollTo(0, 0); } function unload(e: BeforeUnloadEvent) { if (dirty.current || operation.current) {
        e.preventDefault();
        e.returnValue = '';
    } } window.addEventListener('hashchange', hash); window.addEventListener('beforeunload', unload); return () => { window.removeEventListener('hashchange', hash); window.removeEventListener('beforeunload', unload); }; }, [route]);
    useEffect(() => { if (confirm)
        dialog.current?.showModal();
    else
        dialog.current?.close(); }, [confirm]);
    useEffect(() => { if (!notice)
        return; const t = setTimeout(() => setNotice(''), 7000); return () => clearTimeout(t); }, [notice]);
    async function run(fn: () => Promise<void>) { if (operation.current)
        return; operation.current = true; setBusy(true); setError(''); try {
        await fn();
    }
    catch (e) {
        setError(errorText(e));
    }
    finally {
        operation.current = false;
        setBusy(false);
    } }
    const id = route.split('/')[2];
    const song = songs.find(s => s.id === id);
    const related = assets.filter(a => a.songId === id);
    const editing = route === '/new' || route.endsWith('/edit');
    const go = (path: string) => { location.hash = path; };
    async function openAsset(asset: Asset) { const canPreview = /^(application\/pdf|image\/(png|jpeg|webp|gif))$/.test(asset.mimeType); const tab = canPreview ? window.open('about:blank', '_blank') : null; if (tab)
        tab.opener = null; try {
        const file = await db.getAssetFile(asset.id);
        if (!file)
            throw Error('附件缺失，请从备份恢复。');
        if (tab) {
            const u = URL.createObjectURL(file);
            tab.location.href = u;
            setTimeout(() => URL.revokeObjectURL(u), 120000);
        }
        else {
            download(file, asset.name);
            setNotice('已发起下载。PPT 等文件请使用系统或相应应用打开。');
        }
    }
    catch (e) {
        tab?.close();
        setError(errorText(e));
    } }
    const filtered = songs.filter(s => (!category || s.category === category) && (!tag || s.tags.includes(tag)) && [s.title, s.artist, s.version, s.lyricsZh, s.lyricsEn, s.key, s.category, ...s.tags, s.notes].join(' ').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
    return <><header className="header"><div className="header-inner"><a className="brand" href="#/"><span className="mark">W</span><span>Worship Library</span></a><nav><button aria-label="播放列表" onClick={() => go('/playlist')} disabled={busy}><Music2 /></button><button className="primary add" disabled={busy || !supported} onClick={() => go('/new')} aria-label="新增歌曲"><Plus /><span>新增歌曲</span></button><button aria-label="备份与恢复" title="备份与恢复" disabled={busy} onClick={() => go('/backup')}><Archive /></button></nav></div></header><main>
 {!supported && <div className="alert">当前浏览器不支持本地文件存储。请使用支持 OPFS 的 Safari、Chrome 或 Edge，并通过 HTTPS 或本机 localhost 打开。</div>}
 {error && <div className="alert" role="alert">{error}<button aria-label="关闭错误提示" onClick={() => setError('')}><X /></button></div>}
 {refresh && <div className="banner">有新版本可用。请先保存修改。<button disabled={busy} onClick={() => { if (dirty.current) {
        setNotice('请先保存或取消编辑。');
        return;
    } void updateServiceWorker(true); }}>更新</button><button aria-label="稍后更新" onClick={() => setRefresh(false)}><X /></button></div>}
 {loading ? <section className="empty">正在读取本地曲库…</section> : route === '/' ? <><div className="heading"><h1>我的歌曲</h1><p>音乐、歌词与敬拜资料</p></div><div className="tools"><label className="search"><Search /><input aria-label="搜索歌曲" type="search" placeholder="搜索歌曲、歌手、歌词或标签" value={query} onChange={e => setQuery(e.target.value)}/></label><div className="filters"><select aria-label="分类筛选" value={category} onChange={e => setCategory(e.target.value)}><option value="">所有分类</option>{[...new Set(songs.map(s => s.category).filter(Boolean))].sort().map(c => <option key={c}>{c}</option>)}</select><select aria-label="主题筛选" value={tag} onChange={e => setTag(e.target.value)}><option value="">所有主题</option>{[...new Set(songs.flatMap(s => s.tags))].sort().map(t => <option key={t}>{t}</option>)}</select>{(query || category || tag) && <button className="text-button" onClick={() => { setQuery(''); setCategory(''); setTag(''); }}>清除</button>}</div></div><div className="playlist-toolbar"><button className="primary" disabled={!filtered.some(s => assets.some(a => a.songId === s.id && a.kind === 'audio'))} onClick={() => player.playAll(filtered.flatMap(s => { const a = assets.find(a => a.songId === s.id && a.kind === 'audio'); return a ? [a.id] : []; }))}><Music2 />{query || category || tag ? '播放筛选结果' : '播放全部'}</button><button onClick={() => go('/playlist')}>播放列表 · {player.queue.length}</button></div><div className="list-heading"><h2>{query || category || tag ? '筛选结果' : '全部歌曲'}</h2><span>{filtered.length} 首</span></div><div className="song-list">{filtered.map(s => <a className="song-row" key={s.id} href={`#/song/${s.id}`}><div><strong>{s.title}</strong><p>{[s.artist, s.version, s.category, ...s.tags].filter(Boolean).join(' · ') || '尚未填写歌手与分类'}</p><small>{[...new Set(assets.filter(a => a.songId === s.id).map(a => names[a.kind]))].join(' · ') || '暂无附件'}</small></div><div className="row-end">{s.key && <span className="key">{s.key}</span>}<ChevronRight /></div></a>)}</div>{!filtered.length && <section className="empty"><Music2 size={36}/><h2>{songs.length ? '没有找到歌曲' : '还没有歌曲'}</h2><p>{songs.length ? '试试其他关键词，或清除筛选条件。' : '新增第一首歌，开始建立你的资料库。'}</p>{!songs.length && <button className="primary" disabled={!supported} onClick={() => go('/new')}><Plus />新增第一首歌</button>}</section>}<div className="local-note"><ShieldCheck size={17}/>资料只存此设备，请定期备份。</div></> : <><button className="back text-button" disabled={busy} onClick={() => go('/')}><ArrowLeft />返回曲库</button>
 {route === '/playlist' ? <PlaylistPage /> : editing ? (route === '/new' || song ? <SongForm key={route} song={song} assets={related} busy={busy} supported={supported} markDirty={v => dirty.current = v} onCancel={() => go(song ? `/song/${song.id}` : '/')} onSave={(fn) => run(async () => { try { await fn(); } catch (e) { await reload().catch(() => {}); throw e; } })} onComplete={async saved => { await reload(); dirty.current = false; setNotice('歌曲已保存'); operation.current = false; go(`/song/${saved.id}`); }}/> : <section className="empty">歌曲不存在或已被删除。</section>) : route === '/backup' ? <><div className="heading"><h1>备份与恢复</h1><p>把完整曲库留一份在其他设备。</p></div><section className="panel"><h2>此设备的曲库</h2><div className="stats"><div><strong>{songs.length}</strong><span>首歌曲</span></div><div><strong>{assets.length}</strong><span>个附件</span></div><div><strong>{stats ? size(stats.usage) : '暂不可用'}</strong><span>已用存储{stats ? ` / ${size(stats.quota)}` : ''}</span></div></div><p className="muted">资料仅存在当前浏览器或主屏幕应用内。清除网站数据、卸载应用或设备故障可能导致丢失。请勿在多个窗口同时编辑；不要使用隐私浏览保存资料。</p></section><section className="panel"><h2>导出完整备份</h2><p>包含所有歌曲、歌词和附件。备份没有加密，请妥善保管，并复制到 Windows 或外接存储。</p><button className="primary" disabled={busy || !supported} onClick={() => run(async () => { setProgress('正在生成完整备份…'); try {
            const result = await createBackup();
            download(result.blob, result.filename);
            const stamp = new Date().toISOString();
            try {
                localStorage.setItem('lastBackup', stamp);
            }
            catch { /* optional preference */ }
            setLastBackup(stamp);
            setNotice('已发起备份下载，请确认文件已保存到“文件”App 或下载目录。');
        }
        finally {
            setProgress('');
        } })}><Download />导出 .wlib 备份</button><p className="muted">{lastBackup ? `最近生成备份：${new Date(lastBackup).toLocaleString()}（请自行确认下载成功）` : '尚未生成备份'}</p></section><section className="panel"><h2>从备份恢复</h2><p>导入后将替换当前曲库，不会合并。建议先导出当前资料。</p><label className="file-pick"><Upload />选择 .wlib 备份<input aria-label="选择备份文件" type="file" accept=".wlib" disabled={busy || !supported} onChange={e => { const file = e.target.files?.[0]; e.target.value = ''; setBackup(null); if (file)
            void run(async () => setBackup({ file, summary: await inspectBackup(file) })); }}/></label>{backup && <div className="backup-summary"><strong>{backup.file.name}</strong><p>{new Date(backup.summary.createdAt).toLocaleString()}</p><p>{backup.summary.songCount} 首歌曲 · {backup.summary.assetCount} 个附件 · {size(backup.summary.totalBytes)}</p><p className="muted">摘要已读取，恢复时将验证全部附件。</p><button className="danger" disabled={busy} onClick={() => setConfirm({ title: '替换当前曲库？', text: `将以备份中的 ${backup.summary.songCount} 首歌曲替换此设备的全部曲库。此操作无法撤销。`, action: () => void run(async () => { setProgress('正在验证附件…'); try {
                player.stop();
                await restoreBackup(backup.file, (n, total) => setProgress(n === total ? '附件已验证，正在写入资料，请勿关闭页面…' : `正在验证附件 ${n} / ${total}`));
                await reload();
                setBackup(null);
                setNotice('恢复完成，歌曲与附件已重新加载。');
            }
            finally {
                setProgress('');
            } }) })}>恢复并替换</button></div>}{busy && <p role="status">{progress || '正在读取，请稍候…'}</p>}</section><section className="panel"><h2>在 iPhone 上使用</h2><p>用 Safari 打开部署后的网址，点击“分享”→“添加到主屏幕”。以后固定从同一个图标进入，完成首次加载后可离线使用。</p><p className="muted">Safari 与主屏幕应用可能使用不同的存储空间。更换网址也会切换存储空间；请先备份，再迁移。</p></section></> : song ? <><div className="detail-heading"><div><h1>{song.title}</h1><p className="muted">{[song.artist, song.version].filter(Boolean).join(' · ')}</p><div className="chips">{[song.key && `Key ${song.key}`, song.category, ...song.tags].filter(Boolean).map((x, i) => <span key={i}>{x}</span>)}</div></div><button disabled={busy} onClick={() => go(`/song/${id}/edit`)}><Pencil />编辑</button></div>{related.filter(a => a.kind === 'audio').map(a => <div className="player" key={a.id}><span><Music2 />{a.name}</span><div className="playlist-toolbar"><button className="primary" onClick={() => player.play(a.id)}>播放此音频</button><button disabled={player.ids.includes(a.id)} onClick={() => player.add(a.id)}>{player.ids.includes(a.id) ? '已在播放列表' : '加入播放列表'}</button></div></div>)}{!related.some(a => a.kind === 'audio') && <p className="muted">暂无音频，可在编辑中添加。</p>}<section className="panel"><div className="section-heading"><h2>歌词</h2><div className="tabs">{[['zh', '中文'], ['en', '英文'], ['both', '双语']].map(([v, label]) => <button key={v} aria-pressed={language === v} className={language === v ? 'active' : ''} onClick={() => setLanguage(v!)}>{label}</button>)}</div></div><div className={language === 'both' ? 'lyrics bilingual' : 'lyrics'}>{language !== 'en' && <div>{language === 'both' && <h3>中文</h3>}<p>{song.lyricsZh || '暂无中文歌词'}</p></div>}{language !== 'zh' && <div>{language === 'both' && <h3>English</h3>}<p>{song.lyricsEn || '暂无英文歌词'}</p></div>}</div></section><section className="panel"><h2>歌曲资料 <span className="muted">{related.length}</span></h2>{!related.length && <p className="muted">暂无附件</p>}{related.map(a => <div className="asset-row" key={a.id}><FileText /><div className="asset-copy"><strong>{a.name}</strong><small>{names[a.kind]} · {size(a.size)}</small></div><div className="asset-actions"><button aria-label={`打开 ${a.name}`} onClick={() => void openAsset(a)}><ExternalLink /></button><button aria-label={`下载 ${a.name}`} onClick={() => run(async () => { const file = await db.getAssetFile(a.id); if (!file)
            throw Error('附件缺失'); download(file, a.name); })}><Download /></button></div></div>)}</section>{song.notes && <section className="panel"><h2>备注</h2><p className="preserve">{song.notes}</p></section>}<button className="danger text-button" disabled={busy} onClick={() => setConfirm({ title: '删除这首歌曲？', text: `“${song.title}”及其全部附件将被删除，无法撤销。`, action: () => void run(async () => { await db.removeSong(song.id); await reload(); setNotice('歌曲已删除'); operation.current = false; go('/'); }) })}><Trash2 />删除歌曲</button></> : <section className="empty"><h2>未找到页面或歌曲</h2></section>}
 </>}
 </main><PlayerBar /><footer>Worship Library <span>·</span> 私人曲库</footer>{notice && <div className="toast" role="status">{notice}<button aria-label="关闭通知" onClick={() => setNotice('')}><X /></button></div>}<dialog ref={dialog} onCancel={() => setConfirm(null)}><h2>{confirm?.title}</h2><p>{confirm?.text}</p><div className="actions"><button autoFocus onClick={() => setConfirm(null)}>取消</button><button className="danger" onClick={() => { const fn = confirm?.action; setConfirm(null); fn?.(); }}>确认</button></div></dialog></>;
}
function SongForm({ song, assets, busy, supported, markDirty, onCancel, onSave, onComplete }: {
    song?: Song;
    assets: Asset[];
    busy: boolean;
    supported: boolean;
    markDirty: (v: boolean) => void;
    onCancel: () => void;
    onSave: (fn: () => Promise<void>) => Promise<void>;
    onComplete: (s: Song) => Promise<void>;
}) {
    const [form, setForm] = useState<SongInput>(song ? { ...song } : empty);
    const [tags, setTags] = useState(song?.tags.join('、') || '');
    const [pending, setPending] = useState<{
        id: string;
        file: File;
        kind: AssetKind;
    }[]>([]);
    const [removed, setRemoved] = useState<string[]>([]);
    const savedId = useRef(song?.id);
    const uploaded = useRef(new Set<string>());
    const [status, setStatus] = useState('');
    const field = (key: keyof SongInput, value: string) => { setForm(f => ({ ...f, [key]: value })); markDirty(true); };
    return <form onSubmit={e => { e.preventDefault(); void onSave(async () => { let saved: Song; try {
        setStatus('正在保存歌曲…');
        saved = await db.saveSong({ ...form, title: form.title.trim(), tags: [...new Set(tags.split(/[,，、\n]+/).map(t => t.trim()).filter(Boolean))] }, savedId.current);
        savedId.current = saved.id;
        for (const item of pending) {
            if (uploaded.current.has(item.id))
                continue;
            setStatus(`正在保存附件：${item.file.name}`);
            await db.addAsset({ songId: saved.id, kind: item.kind, file: item.file });
            uploaded.current.add(item.id);
        }
        for (const id of removed)
            await db.removeAsset(id);
        await onComplete(saved);
    }
    catch (e) {
        throw Error(`${savedId.current ? '歌曲文字已保存；部分附件可能尚未完成。可重试保存，已上传附件不会重复添加。 ' : ''}${errorText(e)}`);
    }
    finally {
        setStatus('');
    } }); }}><h1>{song ? '编辑歌曲' : '新增歌曲'}</h1><fieldset disabled={busy || !supported}><section className="panel"><h2>歌曲信息</h2><div className="form-grid">{([['title', '歌名 *'], ['artist', '歌手'], ['version', '版本'], ['key', '调性 Key'], ['category', '分类']] as const).map(([key, label]) => <label key={key} className={key === 'title' ? 'wide' : ''}>{label}<input required={key === 'title'} value={form[key]} onChange={e => field(key, e.target.value)} placeholder={key === 'key' ? '例如 G、D、C' : undefined}/></label>)}<label>主题标签<input value={tags} onChange={e => { setTags(e.target.value); markDirty(true); }} placeholder="用逗号或顿号分隔"/></label></div></section><section className="panel"><h2>歌词与备注</h2><div className="form-grid"><label>中文歌词<textarea rows={8} value={form.lyricsZh} onChange={e => field('lyricsZh', e.target.value)}/></label><label>英文歌词<textarea rows={8} value={form.lyricsEn} onChange={e => field('lyricsEn', e.target.value)}/></label><label className="wide">备注<textarea rows={3} value={form.notes} onChange={e => field('notes', e.target.value)}/></label></div></section><section className="panel"><h2>音频与附件</h2><p className="muted">可选择多个文件。PDF 或图片乐谱请将类型调整为“乐谱”。删除已有附件会在保存后生效。</p>{assets.map(a => <div className={`asset-row ${removed.includes(a.id) ? 'removed' : ''}`} key={a.id}><FileText /><div className="asset-copy"><strong>{a.name}</strong><small>{names[a.kind]} · {size(a.size)}</small></div><button type="button" onClick={() => { setRemoved(r => r.includes(a.id) ? r.filter(x => x !== a.id) : [...r, a.id]); markDirty(true); }}>{removed.includes(a.id) ? '撤销删除' : '移除'}</button></div>)}{pending.map(item => <div className="asset-row" key={item.id}><div className="asset-copy"><strong>{item.file.name}</strong><small>{size(item.file.size)}</small></div><select aria-label={`${item.file.name} 类型`} disabled={uploaded.current.has(item.id)} value={item.kind} onChange={e => setPending(p => p.map(x => x.id === item.id ? { ...x, kind: e.target.value as AssetKind } : x))}>{ASSET_KINDS.map(k => <option key={k} value={k}>{names[k]}</option>)}</select><button type="button" disabled={uploaded.current.has(item.id)} aria-label={`移除 ${item.file.name}`} onClick={() => setPending(p => p.filter(x => x.id !== item.id))}><X /></button></div>)}<label className="file-pick"><Plus />添加文件<input type="file" multiple aria-label="添加附件" onChange={e => { const selected = Array.from(e.target.files || []).map(file => ({ id: crypto.randomUUID(), file, kind: guess(file) })); setPending(p => [...p, ...selected]); e.target.value = ''; markDirty(true); }}/></label></section></fieldset><div className="save-bar"><button type="button" disabled={busy} onClick={onCancel}>取消</button><button type="submit" className="primary" disabled={busy || !supported}>{busy ? '正在保存…' : '保存歌曲'}</button></div>{status && <p role="status">{status}</p>}</form>;
}
