export const COMMIT='3b25377d04b24fc6154698ded78a2bcb2c59afff';
const D='deep_ep/include/deep_ep/impls/ep/dispatch.hpp',E='deep_ep/include/deep_ep/impls/ep/dispatch_copy_epilogue.hpp';
export const UNKNOWN='未写入',PADDING='未定义填充';
export const PRESETS={mixed:'非均匀 / A=4 / 清零填充',concentrated:'集中到 R0 两专家 / A=4',invalid:'含全 -1 token / A=2',zero:'全零 hidden / A=4',fp8:'FP8 + SF packs / A=4',cached:'Cached 再 dispatch / A=4',noWeights:'不传 weights / A=4',uninitialized:'不清零 padding / A=4',empty:'每 rank T=0 / M=4'};
const routes=[[[0,1],[2,3],[4,6],[-1,0]],[[0,2],[2,3],[6,7],[2,-1]],[[4,5],[0,4],[2,3],[0,1]],[[6,7],[0,6],[2,4],[6,-1]]];
const clone=x=>structuredClone(x),align=(x,a)=>Math.ceil(x/a)*a;
export function buildModel(preset='mixed'){
 const c={R:4,E:8,K:2,H:256,M:4,T:preset==='empty'?0:4,C:16,A:preset==='invalid'?2:4,cached:preset==='cached',fp8:preset==='fp8',weights:preset!=='noWeights',zeroPadding:preset!=='uninitialized'};
 c.hiddenBytes=c.H*(c.fp8?1:2);c.sfPacks=c.fp8?8:0;c.sfBytes=c.sfPacks*2;c.metadataBytes=(c.sfBytes?align(c.sfBytes,32):0)+align(c.K*4+(c.cached?0:align(c.K*8,32)+4),32);c.tokenBytes=c.hiddenBytes+c.metadataBytes;c.regionBytes=c.M*c.tokenBytes;c.bufferBytes=c.R*c.regionBytes;
 let routing=clone(routes);if(preset==='concentrated')routing=routing.map(rr=>rr.map(()=>[0,1]));if(preset==='invalid')routing[0][0]=[-1,-1];
 for(const rr of routing)for(const row of rr){const valid=row.filter(e=>e>=0);if(row.some(e=>!Number.isInteger(e)||e < -1||e>=c.E)||new Set(valid).size!==valid.length)throw Error('非法topk教学输入');}
 const tokens=[],plan=Array.from({length:4},()=>[]),counts=Array.from({length:4},()=>[0,0,0,0]),expertCounts=Array.from({length:4},()=>[0,0]);
 for(let r=0;r<4;r++)for(let t=0;t<c.T;t++){
  const key=`${r}:${t}`,topk=routing[r][t],gid=r*c.M+t,base=preset==='zero'?0:((gid===0)?0:(c.fp8?(gid+1)%4:(gid+1)*2)),x=Array.from({length:c.H},(_,h)=>preset==='zero'||gid===0?0:base+(c.fp8?(h%2):(h%4))+(c.cached?32:0));
  const tok={key,r,t,gid,topk,x,weights:c.weights?(c.cached?[.25,.75]:[.6,.4]):null,sf:c.sfPacks?Array.from({length:8},(_,p)=>0x3c00+p):null,slot:[-1,-1],gsge:[-1,-1],localSlot:-1};tokens.push(tok);
  const seen=new Set(),peers=[];topk.forEach((e,j)=>{if(e<0)return;const dst=Math.floor(e/2);expertCounts[dst][e%2]++;if(seen.has(dst))return;seen.add(dst);const slot=counts[r][dst]++;tok.slot[j]=slot;if(dst===r)tok.localSlot=slot;else peers.push({dst,j,slot});plan[dst].push({key,r,t,gid,dst,slot,topk,x,weights:tok.weights,sf:tok.sf,sourceCore:t});});
  peers.sort((a,b)=>((a.dst-r+4)%4)-((b.dst-r+4)%4));peers.forEach((p,i)=>tok.gsge[p.j]=i*6);
 }
 const recvPlan=plan.map(arr=>arr.sort((a,b)=>a.r-b.r||a.slot-b.slot));
 const prefixRank=counts[0].map((_,dst)=>{let n=0;return counts.map(row=>(n+=row[dst]));});
 const prefixExpert=expertCounts.map(row=>{let n=0;return row.map(v=>{const end=n+v;n+=align(v,c.A);return end;});});
 const expanded=expertCounts.map(row=>row.reduce((sum,n)=>sum+align(n,c.A),0));
 const outputPlan=recvPlan.map((arr,dst)=>{const next=[0,align(prefixExpert[dst][0],c.A)];return arr.map((rec,pos)=>{const slots=[-1,-1];let master=-1;rec.topk.forEach((e,j)=>{if(e>=dst*2&&e<dst*2+2){slots[j]=next[e-dst*2]++;master=j;}});return {...rec,pos,slots,master,metadata:[...slots,rec.gid,master],epCore:pos};});});
 const cells={},ledger={},frames=[];
 const define=(id,val,meta)=>{cells[id]=clone(val);ledger[id]={id,...meta};};
 const id=(r,obj,index)=>`R${r}.${obj}${index===undefined?'':`[${index}]`}`;
 const defs=(r,obj,idx,val,dtype,shape,owner,bytes,note='')=>define(id(r,obj,idx),val,{rank:r,obj,index:idx,dtype,shape,owner,memory:obj.endsWith('_sum_view')?'教学聚合（非分配）':obj.startsWith('ub_')?'UB':'GM',bytes,note});
 for(let r=0;r<4;r++){
  defs(r,'rank_histogram_sum_view',undefined,c.cached?UNKNOWN:[0,0,0,0],'int32',[4],'各 AIV UB 的最终总计展示；逐核见 ub_rank_histogram',16,'fresh 前缀之前是每核计数，之后同名 UB 数组被覆盖为排他前缀');
  defs(r,'expert_histogram_sum_view',undefined,c.cached?UNKNOWN:Array(8).fill(0),'int32',[8],'各 AIV UB expert_histogram 的教学求和',32,'聚合视图不是真实GM分配；真实逐核见ub_expert_histogram');
  defs(r,'psum_num_recv_tokens_per_rank',undefined,c.cached?prefixRank[r]:UNKNOWN,'int32',[4],'AIV 1',16,'按来源 rank 的包含式前缀');
  defs(r,'psum_num_recv_tokens_per_expert',undefined,c.cached?prefixExpert[r]:UNKNOWN,'int32',[2],'AIV 0',8,'sum align(前面的 count,A) + 当前 raw count');
  defs(r,'num_unaligned_recv_tokens_per_expert',undefined,c.cached?expertCounts[r]:UNKNOWN,'int32',[2],'AIV 0',8);
  defs(r,'signals',undefined,{metadata_ready:0,local_copy_ready:0,doorbell:'未提交',payload:'未就绪',arrival:'未到'},'状态字段',[], '各 AIV / 本图按完成条件聚合',0,'教学聚合，不是一个真实 C++ struct；counts就绪≠payload就绪');
  defs(r,'epilogue_expert_counter',undefined,UNKNOWN,'int32',[16,2],'每 AIV 的前置核统计前缀',128);
  for(let core=0;core<16;core++){defs(r,'ub_expert_histogram',core,c.cached?UNKNOWN:Array(8).fill(0),'int32',[8],`AIV ${core} / 真名expert_histogram`,32);defs(r,'ub_rank_histogram',core,c.cached?UNKNOWN:[0,0,0,0],'int32',[4],`AIV ${core}`,16);defs(r,'local_rank_histogram',core,0,'int32',[4],`AIV ${core} / EPSignals`,16,'实际状态高8位arrival，低24位count；教学对象显式拆分');}
  for(const tok of tokens.filter(t=>t.r===r)){
   defs(r,'x',tok.t,tok.x,c.fp8?'float8_e4m3fn':'bfloat16',[256],`AIV ${tok.t} 负责 token ${tok.t}`,c.hiddenBytes,'全向量由逐元素公式生成；零值是有效载荷');defs(r,'topk_idx',tok.t,tok.topk,'int64',[2],`AIV ${tok.t} / group lanes 0,1`,16,'expert ID；-1无选择；缓存从handle引用');
   if(c.weights)defs(r,'topk_weights',tok.t,tok.weights,'float32',[2],`AIV ${tok.t}`,8);if(c.sfPacks)defs(r,'sf',tok.t,tok.sf,'sf_pack_t=int16',[8],`AIV ${tok.t}`,16,'仅搬运SF pack原始位模式；不是解码出的scale数值');
   defs(r,'dst_buffer_slot_idx',tok.t,c.cached?tok.slot:UNKNOWN,'int32',[2],`AIV ${tok.t}`,8,'相对于目的 buffer 的来源 rank 分区；重复 rank 的lane=-1');defs(r,'dst_gsge_idx',tok.t,c.cached?tok.gsge:UNKNOWN,'int32',[2],`AIV ${tok.t}`,8,'每核SQ的逻辑SGE pair索引；local/invalid=-1');defs(r,'local_copy_dst_slot_idx',tok.t,-1,'int32',[1],`AIV ${tok.t}`,4);
   defs(r,'metadata_send_buffer',tok.t,UNKNOWN,'uint8',[c.metadataBytes],`AIV ${tok.t} scalar/MTE`,c.metadataBytes,'打包连续内存，不是struct；alignment padding未定义');defs(r,'SQE',tok.t,UNKNOWN,'WQEBB',[4],`AIV ${tok.t} private Jetty`,256,'一SQE固定预留4×64B；每SGE pair=hidden+metadata；最多6 pair');
  }
  for(let src=0;src<4;src++)for(let slot=0;slot<4;slot++)defs(r,'recv_buffer',`${src},${slot}`,UNKNOWN,'uint8',[c.tokenBytes],`目的 R${r} / 来源 R${src}`,c.tokenBytes,`字节偏移=(src×M+slot)×${c.tokenBytes}；容量槽不等于有效槽`);
  for(let pos=0;pos<recvPlan[r].length;pos++)defs(r,'recv_src_metadata',pos,c.cached?outputPlan[r][pos].metadata:UNKNOWN,'int32',[4],`epilogue AIV ${pos}`,16,'[expanded_slot_j0,expanded_slot_j1,src_global_idx,最后本地j]；每收到的rank去重token一行');
  for(let slot=0;slot<expanded[r];slot++){defs(r,'recv_x',slot,UNKNOWN,c.fp8?'float8_e4m3fn':'bfloat16',[256],'epilogue MTE3',c.hiddenBytes);if(c.weights)defs(r,'recv_topk_weights',slot,UNKNOWN,'float32',[],'epilogue scalar',4);if(c.sfPacks)defs(r,'recv_sf',slot,UNKNOWN,'sf_pack_t=int16',[8],'epilogue MTE3',16);}
 }
 function frame(stage,title,explanation,source,reads=[],writes=[],actors=[],transfers=[],condition=''){
  const readSnapshot=reads.map(i=>({id:i,value:clone(cells[i])}));
  const changes=writes.map(([i,v])=>({id:i,before:clone(cells[i]),after:clone(v)}));writes.forEach(([i,v])=>{if(!(i in cells))throw Error('undefined cell '+i);cells[i]=clone(v);});
  frames.push({step:frames.length,stage,title,explanation,source,reads:readSnapshot,writes:changes,actors,transfers,condition,snapshot:clone(cells)});
 }
 const ref=(file,fn,def,start,end,active)=>({file,fn,def,start,end,active,caller:file==='csrc/kernels/ep/dispatch.hpp'?'EPBuffer.dispatch → EPBuffer::dispatch → launch_dispatch':file===D?'EPBuffer.dispatch → EPBuffer::dispatch → launch_dispatch → dispatch_impl → simt_persistent_worker':'launch_dispatch_copy_epilogue → dispatch_copy_epilogue_impl'});
 const simt=(a,b,ls)=>ref(D,'simt_persistent_worker',86,a,b,ls),dispatch=(a,b,ls)=>ref(D,'dispatch_impl',559,a,b,ls),epi=(a,b,ls)=>ref(E,'dispatch_copy_epilogue_impl',181,a,b,ls);
 frame('input','初始：四个 rank 均持有真实数据',`T=${c.T}，容量 M=4，E=8，每 rank 两专家，K=2，H=256，16 AIV。ceil(M/16)=1，AIV 0–3 各处理一条输入，4–15 空范围；空核仍参与统计与同步。${c.cached?'已完成一次相同路由的fresh调用，本轮复用handle映射并更新hidden/weights。':''}`,ref('csrc/kernels/ep/dispatch.hpp','launch_dispatch',20,43,49,[49]),tokens.map(t=>id(t.r,'x',t.t)),[],['R0–R3 / 16 AIV']);
 if(c.cached){const ws=[];for(const t of tokens)ws.push([id(t.r,'local_copy_dst_slot_idx',t.t),t.localSlot]);frame('restore','Cached：恢复槽位与逆 SGE 映射','不重新做rank/expert直方图，不重写dst映射或recv_src_metadata。本轮metadata没有topk/global_idx；handle路由必须保持不变。',simt(133,154,[140,142,143,144,146,149,154]),tokens.flatMap(t=>[id(t.r,'dst_buffer_slot_idx',t.t),id(t.r,'dst_gsge_idx',t.t)]),[...ws,...Array.from({length:4},(_,r)=>[id(r,'signals'),{...cells[id(r,'signals')],local_copy_ready:1}])],['R0–R3 / AIV 0–3']);}
 else{
 for(let t=0;t<c.T;t++){
  const writes=[],reads=[];for(const tok of tokens.filter(x=>x.t===t)){const hist=[0,0,0,0];new Set(tok.topk.filter(e=>e>=0).map(e=>Math.floor(e/2))).forEach(dst=>hist[dst]++);const eh=clone(cells[id(tok.r,'expert_histogram_sum_view')]);tok.topk.filter(e=>e>=0).forEach(e=>eh[e]++);const coreExpert=Array(8).fill(0);tok.topk.filter(e=>e>=0).forEach(e=>coreExpert[e]++);writes.push([id(tok.r,'ub_expert_histogram',t),coreExpert],[id(tok.r,'ub_rank_histogram',t),hist],[id(tok.r,'expert_histogram_sum_view'),eh],[id(tok.r,'local_rank_histogram',t),{arrival:1,count:hist}]);reads.push(id(tok.r,'topk_idx',t));}
  if(t===c.T-1)for(let r=0;r<4;r++)for(let core=c.T;core<16;core++)writes.push([id(r,'local_rank_histogram',core),{arrival:1,count:[0,0,0,0]}]);
  frame('histogram',`路由 token ${t}：按 rank 去重`, 'expert_histogram 每个有效expert加1；rank_histogram 对同token的同rank只加1。例 [0,1] 产生两expert命中、一个rank副本。四个rank本批可并行。',simt(173,195,[177,179,182,183,186,188,190,194]),reads,writes,[`R0–R3 / AIV ${t} / 两group lanes${t===c.T-1?'；AIV4–15同时发布空计数ready':''}`]);
 }
 if(c.T===0){const idle=[];for(let r=0;r<4;r++)for(let core=0;core<16;core++)idle.push([id(r,'local_rank_histogram',core),{arrival:1,count:[0,0,0,0]}]);frame('idle','空输入：16核也发布 ready 的零计数','count=0 仍必须发布arrival=1，不能把未到达的信号0误当成已就绪的空结果。每核UB的rank计数为0，发布到GM后prefix消费者才可继续。',simt(217,224,[220,221,222]),[],idle,['R0–R3 / 所有16个空范围AIV']);}
 const ws=[];for(let r=0;r<4;r++){ws.push([id(r,'rank_histogram_sum_view'),counts[r]]);for(let core=0;core<16;core++){const prefix=Array(4).fill(0);for(let t=0;t<Math.min(core,c.T);t++)new Set(routing[r][t].filter(e=>e>=0).map(e=>Math.floor(e/2))).forEach(dst=>prefix[dst]++);ws.push([id(r,'local_rank_histogram',core),{arrival:2,exclusivePrefix:prefix}],[id(r,'ub_rank_histogram',core),prefix]);}}
 frame('prefix','跨 AIV 前缀：每核获得不重叠槽范围','local_rank_histogram 的计数状态1变为排他前缀状态2；每核等待2，读取后实际把GM信号清0。图保留发布快照；下一帧清旗。同名UB rank_histogram已改成前缀，不是本核计数。',simt(227,244,[232,233,234,240,242,244]),Array.from({length:4},(_,r)=>Array.from({length:16},(_,core)=>id(r,'local_rank_histogram',core))).flat(),ws,['每源rank 16 AIV / peer工作分工']);
 const clear=[],slotWrites=[];for(let r=0;r<4;r++)for(let core=0;core<16;core++)clear.push([id(r,'local_rank_histogram',core),0]);for(const tok of tokens)slotWrites.push([id(tok.r,'dst_buffer_slot_idx',tok.t),tok.slot],[id(tok.r,'dst_gsge_idx',tok.t),tok.gsge],[id(tok.r,'local_copy_dst_slot_idx',tok.t),tok.localSlot]);
 frame('slots','分配 dst_buffer_slot_idx / dst_gsge_idx','dst_slot=前置AIV数量+本核原子取号。每核只有一token，remote peer按循环rank顺序取逻辑SQE；global_sgep=lsqe_base×6+sgep。原子顺序不确定，图选择一种合法线性化。local没有SGE。',simt(264,284,[266,271,272,274,275,277,281,282]),tokens.map(t=>id(t.r,'topk_idx',t.t)),[...clear,...slotWrites,...Array.from({length:4},(_,r)=>[id(r,'signals'),{...cells[id(r,'signals')],local_copy_ready:1}])],['R0–R3 / AIV 0–3']);

 }
 for(let t=0;t<c.T;t++){
 const reads=[],ws=[];for(const tok of tokens.filter(x=>x.t===t)){const meta={sf:tok.sf??'无SF分支',topk:c.cached?'cached不发送':tok.topk,weights:tok.weights??'未提供；预留区域未定义',src_global_idx:c.cached?'cached不发送':tok.gid,padding:PADDING};if(!c.cached)reads.push(id(tok.r,'topk_idx',t));if(c.weights)reads.push(id(tok.r,'topk_weights',t));if(c.sfPacks)reads.push(id(tok.r,'sf',t));ws.push([id(tok.r,'metadata_send_buffer',t),meta]);}
 frame('metadata',`打包 metadata_send_buffer：token ${t}`,`hidden 与 metadata 是两个SGE，不先打成hidden临时发送包。本模式hidden ${c.hiddenBytes}B，metadata ${c.metadataBytes}B，接收record ${c.tokenBytes}B；padding不假定0。SF只搬运pack位模式。`,dispatch(775,791,c.cached?[782,783,786,787,788,789,790,791]:[779,782,783,786,787,788,789,790,791]),reads,ws,[`R0–R3 / AIV ${t} scalar + MTE2/MTE3`]);
 }
 const readyWrites=Array.from({length:4},(_,r)=>[id(r,'signals'),{...cells[id(r,'signals')],metadata_ready:1}]);
 frame('metadata','metadata_ready 发布：所有metadata已写GM','MTE3 flush完成、MTE2→S事件汇合后 scalar 写metadata_ready=1。SIMT等待此标志才复制local metadata并继续expert归约；local_copy_ready此前已发布槽位。',dispatch(797,804,[798,799,800,801]),tokens.map(t=>id(t.r,'metadata_send_buffer',t.t)),readyWrites,['R0–R3 / 每个AIV scalar'],[],'metadata_ready=1');

 const sq=[],sr=[];for(const tok of tokens){const sqes=[];tok.slot.forEach((s,j)=>{const dst=tok.topk[j]>=0?Math.floor(tok.topk[j]/2):-1;if(s<0||dst===tok.r)return;sqes.push({logicalSQE:tok.gsge[j]/6,physicalSQE:tok.gsge[j]/6,dst_rank:dst,dst_slot:s,remote_offset:(tok.r*4+s)*c.tokenBytes,SGEs:[{source:`R${tok.r}.x+${tok.t*c.hiddenBytes}`,bytes:c.hiddenBytes},{source:`R${tok.r}.metadata_send_buffer+${tok.t*c.metadataBytes}`,bytes:c.metadataBytes}],num_sges:2,validWQEBBs:2,reservedWQEBBs:4,finalFlags:false});});sqes.sort((a,b)=>a.physicalSQE-b.physicalSQE);if(sqes.length)sqes.at(-1).finalFlags=true;sq.push([id(tok.r,'SQE',tok.t),sqes]);sr.push(id(tok.r,'dst_gsge_idx',tok.t));}
 frame('sqe','构造 SQE：每副本一对 SGE','每核private Jetty；本例每目的rank最多1 pair/SQE。48B header+2×16B SGE=80B，占2个有效64B WQEBB、固定预留4个，剩余NOP。最后physical SQE启用strong order / fence / CQE。仅构造尚未ring。',simt(403,425,[407,409,411,413,414,417,422,423,424,425]),sr,sq,['R0–R3 / AIV 0–3 / warp lanes']);
 const lw=[],lr=[],lt=[];for(const tok of tokens)if(tok.localSlot>=0){const dst=id(tok.r,'recv_buffer',`${tok.r},${tok.localSlot}`);lw.push([dst,{key:tok.key,hidden:tok.x,metadata:cells[id(tok.r,'metadata_send_buffer',tok.t)],status:'本机复制完成'}]);lr.push(id(tok.r,'x',tok.t),id(tok.r,'metadata_send_buffer',tok.t));lt.push({key:tok.key,src:tok.r,dst:tok.r,slot:tok.localSlot,kind:'本机 MTE + SIMT metadata'});}for(let r=0;r<4;r++)lw.push([id(r,'signals'),{...cells[id(r,'signals')],local_copy_ready:1,metadata_ready:1}]);
 frame('local','本机路径：hidden 与 metadata 分别复制','SIMT写local metadata；scalar的MTE2→MTE3复制local hidden。dst_slot=-1时不执行复制；有效零hidden写入仍标红。metadata_ready 与 local_copy_ready 是不同的UB发布条件。',dispatch(831,838,[831,832,833,834,835,836,837,838]),lr,lw,['R0–R3 / 有本机路径AIV'],lt,'local_copy_ready=1，metadata_ready=1；复制流水完成');
 if(!c.cached){ const ps=[];for(let r=0;r<4;r++)ps.push([id(r,'psum_num_recv_tokens_per_rank'),prefixRank[r]],[id(r,'psum_num_recv_tokens_per_expert'),prefixExpert[r]],[id(r,'num_unaligned_recv_tokens_per_expert'),expertCounts[r]],[id(r,'signals'),{...cells[id(r,'signals')],arrival:'counts就绪；payload未就绪'}]);
 frame('counts','计数先到：输出大小与两类前缀','AIV 0 归约expert计数；AIV 1 汇总来源rank。expert_end[e]=Σ前面align(count,A)+count[e]，下个expert_start=align(上个end,A)。计数完成不能证明hidden已经到达。',simt(506,525,[508,511,512,513,514,518,519,522]),Array.from({length:4},(_,r)=>id(r,'expert_histogram_sum_view')),ps,['R0–R3 / AIV0 expert，AIV1 rank'],[],'远端expert arrival=4；rank arrival=16');
 }
 const db=[];for(let r=0;r<4;r++)db.push([id(r,'signals'),{...cells[id(r,'signals')],doorbell:tokens.filter(t=>t.r===r&&t.gsge.some(x=>x>=0)).length?'已提交，未证明完成':'无remote SQE；跳过ring'}]);
 frame('issue','ring_doorbell：提交 URMA WRITE','SIMT完成槽位/SQE/count，metadata 与local MTE流水完成后才advance SQ并ring。issue kernel退出不代表URMA已结束；host闭包保留x与metadata_send_buffer。',dispatch(853,858,[853,855,857]),tokens.map(t=>id(t.r,'SQE',t.t)),db,['各rank有remote SQE的AIV Jetty'],[],'仅提交；异步URMA读取源GM仍可能进行');
 const rw=[],rr=[],rt=[];for(let dst=0;dst<4;dst++)for(const rec of recvPlan[dst])if(rec.r!==dst){const tok=tokens.find(t=>t.key===rec.key);rw.push([id(dst,'recv_buffer',`${rec.r},${rec.slot}`),{key:rec.key,hidden:rec.x,metadata:cells[id(rec.r,'metadata_send_buffer',rec.t)],status:'远端WRITE完成'}]);rr.push(id(rec.r,'x',rec.t),id(rec.r,'metadata_send_buffer',rec.t));rt.push({key:rec.key,src:rec.r,dst,slot:rec.slot,kind:'URMA WRITE完成'});}for(let r=0;r<4;r++)rw.push([id(r,'signals'),{...cells[id(r,'signals')],payload:'drain与barrier后可消费'}]);
 frame('receive','epilogue 先 drain：接收记录现在可读','动画把异步WRITE完成折叠为一教学帧；真实rank/AIV可能错开。epilogue默认barrier drain URMA完成，随后才能按来源rank分区读token。counts帧本身不能替代这里的同步。',epi(195,203,[199,200,201,202]),rr,rw,['R0–R3 / 所有16 AIV同步'],rt,'comm::scalar::barrier drain/CQ完成');
 if(!c.cached){const cw=[];for(let dst=0;dst<4;dst++){const pre=[];const n=[0,0];for(let core=0;core<16;core++){pre.push([...n]);const rec=outputPlan[dst][core];if(rec)rec.topk.forEach(e=>{if(e>=dst*2&&e<dst*2+2)n[e-dst*2]++;});}cw.push([id(dst,'epilogue_expert_counter'),pre]);}
 frame('epPrefix','epilogue：各核expert计数与前缀','接收流按来源rank包含式前缀遍历；ceil(num_recv/16)=1，本例每个活跃epilogue AIV最多一记录。每核清自身prefix行并barrier，再atomic广播给后续核；每核得到前置核数量+expert_start。',epi(396,414,[403,404,405,406,407,408,409,410,411,413,414]),Array.from({length:4},(_,r)=>id(r,'psum_num_recv_tokens_per_expert')),cw,['R0–R3 / 16 AIV（活跃核≤16）'],[],'clear barrier → atomic broadcast → cumsum barrier');}
 const maxPos=Math.max(...recvPlan.map(a=>a.length),0);
 for(let pos=0;pos<maxPos;pos++){
  const reads=[],ws=[],trans=[];for(let dst=0;dst<4;dst++){const rec=outputPlan[dst][pos];if(!rec)continue;reads.push(id(dst,'recv_buffer',`${rec.r},${rec.slot}`));if(c.cached)reads.push(id(dst,'recv_src_metadata',pos));rec.slots.forEach((slot,j)=>{if(slot<0)return;ws.push([id(dst,'recv_x',slot),rec.x]);if(c.weights)ws.push([id(dst,'recv_topk_weights',slot),rec.weights[j]]);if(c.sfPacks)ws.push([id(dst,'recv_sf',slot),rec.sf]);trans.push({key:rec.key,src:dst,dst,slot,kind:`本地expert ${rec.topk[j]}展开`});});if(!c.cached)ws.push([id(dst,'recv_src_metadata',pos),rec.metadata]);}
  frame('expand',`按 local expert 展开：接收流位置 ${pos}`,`同一rank只收到一hidden副本，却可写多个本地expert槽。recv_src_metadata=[两expanded slot,global_idx,master j]，master是最后匹配的j。${c.cached?'本轮直接读取缓存slot，无topk直方图或metadata重写。':''}`,epi(470,496,c.cached?[476,477,492,493,494,495,496]:[479,480,482,484,485,486,492,493,494,495,496]),reads,ws,[`各有流位置 ${pos} 的rank / epilogue AIV ${pos}`],trans);
 }
 const pads=[];for(let dst=0;dst<4;dst++){const used=new Set(outputPlan[dst].flatMap(r=>r.slots).filter(s=>s>=0));for(let slot=0;slot<expanded[dst];slot++)if(!used.has(slot)&&c.zeroPadding){pads.push([id(dst,'recv_x',slot),Array(c.H).fill(0)]);if(c.weights)pads.push([id(dst,'recv_topk_weights',slot),0]);if(c.sfPacks)pads.push([id(dst,'recv_sf',slot),Array(c.sfPacks).fill(0)]);}}
 frame('padding',c.zeroPadding?'对齐空洞：明确写0':'对齐空洞：保持未写入',c.zeroPadding?'只清expert raw end到aligned end之间的padding；零填充不是有效token，不能把它计入路由守恒。padding没有对应src_metadata记录。':'do_zero_padding=False：torch::empty输出的对齐空洞未定义。页面显示未写入，不能把它当作有效零值。',epi(548,575,c.zeroPadding?(pads.length?[556,557,560,561,565,566,567,568,569,570,571,572,573,574]:[]):[]),[],pads,['每expert最多4个padding parts'],[],'按expert_alignment分别对齐');
 frame('done','完成：rank副本数与expert展开数分别守恒',`输入有效topk=${tokens.reduce((n,t)=>n+t.topk.filter(e=>e>=0).length,0)} 次expert命中；rank去重接收=${recvPlan.reduce((n,a)=>n+a.length,0)} 条；输出容量=${expanded.reduce((n,a)=>n+a,0)} 槽（含padding）。本作品是源码语义教学模型，没有NPU精度/trace/性能证据。`,epi(519,523,[]),[],[],['R0–R3']);
 for(const f of frames){
  const alt=[];
  if(f.stage==='restore'){f.source=simt(140,150,[140,142,143,144,146,149]);alt.push(simt(133,139,[135,136,138,139]));alt.push(simt(151,156,[152,154]));alt.push(simt(296,299,[296,298]));}
  if(f.stage==='histogram'){f.source=simt(182,194,[182,183,186,188,190,194]);alt.push(simt(173,180,[177,179]));if(f.writes.some(w=>w.id.includes('local_rank_histogram[4]')))alt.push(simt(217,224,[220,221,222]));}
  if(f.stage==='prefix'){f.source=simt(239,247,[240,242,244]);alt.push(simt(228,238,[232,233,234]));alt.push(simt(248,255,[252,253]));}
  if(f.stage==='slots'){f.source=simt(268,279,[271,272,274,275,277]);alt.push(simt(260,267,[261,262,266]));alt.push(simt(280,284,[281,282]));alt.push(simt(285,295,[289,291]));alt.push(simt(296,300,[296,298]));}
  if(f.stage==='metadata'&&f.title.startsWith('打包')){f.source=dispatch(782,792,[786,787,788,789,790,791]);if(!c.cached)alt.push(dispatch(775,781,[779]));if(!c.cached)alt.push(dispatch(727,740,[729,731]));if(c.weights)alt.push(dispatch(741,752,[742,743,744]));if(c.sfPacks)alt.push(dispatch(700,711,[701,702,703,704,705,706,707,708,709,710]));}
  if(f.stage==='sqe'){f.source=simt(403,415,c.T?[407,409,411,413,414]:[]);alt.push(simt(416,418,c.T?[417]:[]));alt.push(simt(384,391,c.T?[387,389]:[]));alt.push(simt(392,402,c.T?[393,396,398,400,402]:[]));alt.push(simt(420,426,c.T?[422,423,424,425]:[]));}
  if(f.stage==='local'){alt.push(simt(431,438,c.T?[431,433,436]:[]));alt.push(simt(439,447,c.T?[439,440,441,444]:[]));if(!lt.length)f.source.active=[];}
  if(f.stage==='counts'){f.source=simt(511,520,[511,512,513,514,519]);alt.push(simt(521,524,[522]));alt.push(simt(527,537,[531,532,533,534]));alt.push(simt(538,547,[538,540,541,546]));alt.push(simt(472,481,[472,473,477,479,480]));alt.push(simt(482,488,[482,483,488]));}
  if(f.stage==='epPrefix'){f.source=epi(403,414,[403,404,405,406,407,408,409,410,411,413,414]);alt.push(epi(416,423,[416,417,418,419,420,421,422,423]));alt.push(epi(424,429,[424,425,426,427,428]));}
  if(f.stage==='expand'){f.source=epi(490,497,[492,493,494,495,496,497]);alt.push(epi(470,478,c.cached?[476,477]:[]));alt.push(epi(479,488,c.cached?[]:[479,480,482,484,485,486]));if(c.sfPacks)alt.push(epi(498,505,[499,500,501,502,503,504]));if(c.weights)alt.push(epi(505,516,[507,508,509,510]));if(!c.cached){alt.push(epi(514,522,[515,520,521]));alt.push(epi(528,538,[529,530,531,532,533,534,535]));}}
  if(f.stage==='padding'){f.source=epi(565,575,pads.length?[565,566,567,568,569,570,571,572,573,574]:[]);alt.push(epi(553,559,c.zeroPadding?[554,556,557,558,559]:[]));alt.push(epi(560,564,c.zeroPadding?[560,561,562]:[]));if(c.weights)alt.push(epi(576,582,pads.length?[577,578,580]:[]));if(c.sfPacks)alt.push(epi(584,594,pads.length?[585,586,588,589,590,591,592,593]:[]));}
  if(f.stage==='issue'&&!tokens.some(t=>t.gsge.some(g=>g>=0)))f.source.active=[853];
  f.sources=[f.source,...alt];
 }
 return {config:c,tokens,routing,counts,expertCounts,prefixRank,prefixExpert,expanded,recvPlan,outputPlan,ledger,frames,id};
}
export function history(model,cell,element){let old;const out=[];for(const f of model.frames){let v=f.snapshot[cell];if(Array.isArray(v)&&element!==undefined)v=v[element];const s=JSON.stringify(v);if(s!==old||f.writes.some(x=>x.id===cell)||f.reads.some(x=>x.id===cell)){out.push({step:f.step,title:f.title,op:f.writes.some(x=>x.id===cell)?'写':f.reads.some(x=>x.id===cell)?'读':'初始',value:clone(v)});old=s;}}return out;}
