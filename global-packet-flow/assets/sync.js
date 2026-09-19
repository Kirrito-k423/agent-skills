/* 同源页面共享一个持久快照。Web Locks 串行处理命令；播放帧只读时间锚点。 */
async function createPacketSession({key, role, initial, reduce, onState, onPresence}) {
  if (location.protocol === 'file:') throw new Error('本地文件模式只支持单页预览；请通过同一 localhost 地址打开两页。');
  if (!navigator.locks || !window.BroadcastChannel) throw new Error('当前浏览器不支持双屏同步，请使用新版 Chrome 或 Edge。');
  const id = crypto.randomUUID(), peers = new Map(), channel = new BroadcastChannel(key);
  let current, revision = -1, stopped = false;
  const read = () => {const raw=localStorage.getItem(key);return raw?JSON.parse(raw):null;};
  function accept(state) {
    if (!state || state.revision <= revision) return;
    current=state; revision=state.revision; onState(state);
  }
  function presence() {
    const now=Date.now();for(const [peer,p] of peers)if(now-p.seen>7000)peers.delete(peer);
    onPresence([...peers.values()]);
  }
  function hello(reply=false) {channel.postMessage({kind:reply?'presence':'hello',id,role});}
  channel.onmessage = ({data}) => {
    if (!data || data.id===id) return;
    if(data.kind==='hello'||data.kind==='presence') {
      peers.set(data.id,{role:data.role,seen:Date.now()});presence();if(data.kind==='hello')hello(true);
    } else if(data.kind==='state') accept(read());
    else if(data.kind==='bye'){peers.delete(data.id);presence();}
  };
  window.addEventListener('storage', e => {if(e.key===key)accept(read());});
  await navigator.locks.request(key, () => {
    let saved=read();if(!saved){saved={...initial,revision:0};localStorage.setItem(key,JSON.stringify(saved));}accept(saved);
  });
  hello();presence();
  const timer=setInterval(()=>{if(!stopped){accept(read());hello();presence();}},1500);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden){accept(read());hello();}});
  window.addEventListener('pagehide',()=>{stopped=true;clearInterval(timer);channel.postMessage({kind:'bye',id});});
  window.addEventListener('pageshow',event=>{if(event.persisted)location.reload();});
  return {
    async command(action) {
      await navigator.locks.request(key, () => {
        const previous=read()||current,next=reduce(previous,action,Date.now());
        next.revision=previous.revision+1;localStorage.setItem(key,JSON.stringify(next));accept(next);
        channel.postMessage({kind:'state',id});
      });
    }
  };
}
