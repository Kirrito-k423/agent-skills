import {COMMIT} from './model.mjs';
import {extraDefinitions} from './terminology-source-extra.mjs';
import {sourceEvidence} from './terminology-source-evidence.mjs';
export const D='deep_ep/include/deep_ep/impls/ep/dispatch.hpp',E='deep_ep/include/deep_ep/impls/ep/dispatch_copy_epilogue.hpp',L='deep_ep/include/deep_ep/layout/ep/token.hpp',K='csrc/kernels/ep/dispatch.hpp',H='deep_ep/include/deep_ep/comm/handle.hpp';
const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ref=(file,line,fn='')=>({file,line,fn,commit:COMMIT,url:`https://github.com/deepseek-ai/DeepEP-Ascend/blob/${COMMIT}/${file}#L${line}`});
export const glossary={};
const add=(id,label,definition,{fullName='',kind='术语',unit='',bounds='',role='',sourceRef=ref(D,86,'simt_persistent_worker'),aliases=[],related=[]}={})=>{glossary[id]={termId:id,label,definition,fullName,kind,unit,bounds,role,sourceRef,aliases:[label,...aliases],related};};
const official={ascend:'https://www.hiascend.com/document/detail/en/canncommercial/800/opdevg/Ascendcopdevg/atlas_ascendc_10_0008.html',urma:'https://docs.openeuler.org/zh/docs/24.03_LTS_SP3/unifiedbus/unifiedbus/urma/URMA%20User%20Guide.ch.html'};
const configs={R:['参与通信的 Rank 总数','kNumRanks','rank',D,76],E:['全局专家总数','kNumExperts','expert',D,76],K:['每个 token 的 top-k 路由位置数量','kNumTopk','lane/token',D,76],T:['本轮每个 Rank 的有效输入 token 数量','num_tokens','token/rank',D,98],M:['每个来源 Rank 接收分区预留的最大 token 容量','kNumMaxTokensPerRank / num_max_tokens_per_rank','slot/source-rank',L,107],H:['每个 token 的 hidden 向量元素数','x.shape[-1]','element/token','deep_ep/buffers/ep.py',260],A:['每个 expert 输出段的 token 行数对齐单位','kExpertAlignment / expert_alignment','row',E,179],C:['每个 Rank 使用的 AIV 向量核数量','kNumVecCores / num_vec_cores','AIV/rank',D,77]};
for(const [id,[def,full,unit,file,line]]of Object.entries(configs))add(id,id,def,{kind:'教学参数与源码参数的对应',fullName:full,unit,sourceRef:ref(file,line),related:id==='T'||id==='M'?['T','M']:id==='A'?['alignment','padding']:[]});
add('SF','SF','FP8 的缩放因子相关数据；本实现通过 sf_pack_t=int16_t 的 pack 搬运原始位模式，动画没有解码或计算 scale。',{fullName:'Scaling Factor（缩放因子）',sourceRef:ref('deep_ep/include/deep_ep/common/compiled.hpp',33),unit:'pack（16 bit原始位模式）',aliases:['SF packs','SF pack','sf_pack_t','recv_sf','sf'],related:['FP8','sf_pack_t','packing']});
add('BF16','BF16','16 位浮点载荷格式，教学模型按每元素 2 字节计算 hidden 大小。',{fullName:'Brain Floating Point 16 / bfloat16',sourceRef:ref('deep_ep/buffers/ep.py',260),aliases:['bfloat16'],unit:'2 byte/element',related:['hidden','dtype']});
add('FP8','FP8','8 位浮点载荷格式；本图选择 float8_e4m3fn，hidden 每元素 1 字节，另有 SF pack 作为 metadata。数值是教学输入，不是实机量化输出。',{fullName:'8-bit Floating Point',sourceRef:ref('deep_ep/buffers/ep.py',294),aliases:['float8_e4m3fn'],unit:'1 byte/element',related:['SF','hidden','dtype']});
for(const [id,full,def,file,line]of [
 ['AIV','AI Vector','Ascend 的向量核执行主体。本图每 rank 使用 C 个 AIV；按容量 M 分配连续 token 范围，T 小于 M 时尾部核可为空。',D,98],['UB','Unified Buffer','AIV 的片上缓冲，供 SIMT/scalar/MTE 协作，和全局 GM 地址空间不同。',D,27],['GM','Global Memory','设备全局内存；输入、发送 metadata、接收记录和输出都在 GM，异步 URMA 可能仍读取发送源。',D,89],['MTE','Memory Transfer Engine','数据搬运执行单元。本代码 MTE2 把 GM 读入 UB，MTE3 将 UB 写到 GM；完成事件决定流水依赖。',D,702],['SIMT','Single Instruction, Multiple Threads','多线程执行同一指令流的编程方式；该 worker 按 warp/lane 做路由去重、统计和通信描述符构造。',D,86],['SIMD','Single Instruction, Multiple Data','一个向量指令处理多个数据元素；epilogue 的 histogram/初始化函数使用 SIMD 向量操作。',E,37],['URMA','Unified Remote Memory Access','统一远程内存访问。本代码将 hidden 和 metadata 的两条 SGE 作为 WRITE 提交给远端；提交完成和远端可消费是不同条件。',D,857],['SQ','Send Queue','发送队列，存放通信工作描述符；advance_sq 更新队列位置，ring_doorbell 通知通信引擎。',H,94],['SQE','Send Queue Element','发送队列中的工作描述符。本图每个远端 rank 副本用一条 SQE，含 hidden 和 metadata 两个 SGE；固定预留 4 个 WQEBB。',D,357],['SGE','Scatter/Gather Element','散布/聚集元素；一个描述符包含一段源内存的地址及长度。本例 hidden 和 metadata 分别由一个 SGE 指向。',D,403],['SGEP','SGE pair','源码中两条 SGE 组成的一对：hidden + metadata；不是两份 token，单条 SQE 最多容纳 6 对。',D,357],['WQE','Work Queue Element','工作队列元素，用来描述一次通信请求。SQE 是发送队列中的该类请求。',H,168],['WQEBB','Work Queue Element Basic Block','工作队列元素基本块；源码常量为每块 64 字节。有效使用块数与为每条 SQE 固定预留块数不同。',H,19],['CQ','Completion Queue','完成队列，用于观察异步请求完成；不能从 SQE 已提交推断载荷已经到远端。',H,80],['CQE','Completion Queue Element','完成队列元素，最后 physical SQE 的 flags 请求产生完成通知，后续 drain 使用完成状态。',D,393],['DB','Doorbell','门铃通知；提交队列工作给通信引擎。本图 DB 对应 signals.doorbell 教学状态，并非硬件寄存器实测值。',D,857],['CPU','Central Processing Unit','主机处理器；kDoCPUSync 分支把接收计数写回 host_workspace，以便主机知道分配输出所需大小。',D,485],['NPU','Neural Processing Unit','神经网络处理器。本动画是源码语义教学模型，没有 NPU 实机时序或性能 trace。',K,49],['EP','Expert Parallelism','专家并行：专家分布在不同 rank，dispatch 根据 top-k 路由把 token 送给负责专家的 rank。','deep_ep/buffers/ep.py',184]
]){add(id,id,def,{fullName:full,sourceRef:ref(file,line),related: id==='MTE'?['MTE2','MTE3']:[]});if(['AIV','UB','GM','MTE'].includes(id))glossary[id].externalSource=official.ascend;if(['URMA','WQE','WQEBB'].includes(id))glossary[id].externalSource=official.urma;}
add('MTE2','MTE2','本源码中的 GM → UB 搬运流水；必须等待相应事件，才能由 scalar/vector 消费 UB 数据。',{fullName:'MTE pipeline 2；MTE 为 Memory Transfer Engine',sourceRef:ref(D,702),related:['MTE','GM','UB']});add('MTE3','MTE3','本源码中的 UB → GM 搬运流水；发布 metadata_ready 前先等待其完成，防止通知早于数据写入。',{fullName:'MTE pipeline 3',sourceRef:ref(D,797),related:['MTE','GM','UB']});
const concepts=[
 ['rank','rank','通信进程/设备的参与者编号；此教学模型 4 个 rank，每个负责 2 个专家。目的 rank=floor(expert/(E/R))。',D,182,['Rank','R0','R1','R2','R3']],
 ['token','token','路由和搬运的一条输入记录；包含 H 个 hidden 元素、K 个专家选择和可选 weights/SF。一个 rank 副本可能展开到两个本地 expert 输出槽。',L,14,[]],
 ['expert','expert','处理 token 的专家；全局 ID 范围 [0,E)。expert 编号与 rank 编号不是同一个对象。',D,177,['experts','expert IDs','专家']],
 ['top-k','top-k','每条 token 保存 K 个路由位置；topk_idx 记录 expert ID，负哨兵 -1 表示该位置无选择。相同目的 rank 的多个 expert 只产生一个通信副本。',D,177,['topk','Topk']],
 ['hidden','hidden','token 的特征向量，有 H 个元素；x[token,0] 只是首元素，不能代表整个向量。',L,27,['hidden vector','x₀']],
 ['metadata','metadata','伴随 token 的元数据：SF、topk indices、weights 和 src_global_idx；fresh/cached 字段不同，32 字节对齐填充未定义。',L,14,['meta','metadata_send']],
 ['fresh','fresh','不使用旧 handle 的首次路由模式；生成直方图、槽位映射、接收前缀和 recv_src_metadata。',D,156,[]],
 ['cached','cached','复用先前 fresh 调用的路由/槽位/前缀/recv_src_metadata，只搬本轮更新的 hidden、weights/SF；topk 路由必须保持一致。',D,133,['Cached','cached不发送','CachedMode']],
 ['slot','slot','记录的存储槽位。dispatch 的 dst slot 是目的 buffer 中来源 rank 分区内槽，epilogue expanded slot 是按 expert 对齐后的输出行；要按所在字段区分。',D,272,['槽位','槽']],
 ['local','local','相对于当前rank本地归属的对象：local expert是本rank负责的专家；local copy则是目的rank等于来源rank的本机复制路径，用SIMT/scalar/MTE而不发远端SGE。',D,431,['local_copy']],
 ['remote','remote','目的 rank 与来源 rank 不同的远端路径，通过 URMA WRITE 搬运 hidden+metadata。',D,403,['远端']],
 ['peer','peer','通信对端 rank；空 peer 分区仍有容量，实际有效数量由接收前缀确定。',D,303,['空peer']],
 ['alignment','alignment','把大小/行数向上补齐到指定单位。A 是 expert 输出行对齐，metadata 的 32 字节对齐与 A 是不同单位。',E,422,['align','aligned','对齐']],
 ['padding','padding','为对齐保留的空洞，不是有效 token。do_zero_padding 只决定这些输出空洞写 0 或保持未定义；metadata padding 不能假定为零。',E,548,['pad','填充']],
 ['prefix','prefix sum','前缀和。rank 接收前缀为包含式；AIV 槽位前缀为排他式；expert raw end 包含前面专家的对齐容量，当前专家只加有效数量。',D,511,['前缀','psum']],
 ['histogram','histogram','按 rank/expert 统计命中次数的直方图。同 token 同 rank 去重计一次，每个有效 expert 各计一次。UB rank_histogram 随后复用成排他前缀。',D,177,['直方图']],
 ['deduplicate','deduplicate','对同 token 的目的 rank 去重：两个专家同属一个 rank 时只保留一个通信副本；expert 计数仍分别增加。',D,183,['去重']],
 ['scalar','scalar','标量执行流水；和 SIMT/MTE 并行协作，读取 UB 标志，安排搬运并最终提交门铃。',D,801,[]],
 ['warp','warp','SIMT 的线程组；warp_idx 标识组，lane_idx 标识组内线程，交换/前缀操作在 warp 内协作。',D,106,['warps']],
 ['lane','lane','SIMT warp/group 内线程位置。group_lane_idx 扫描 top-k 路由，SGE 构造时 lane 写各 64-bit 字段。',D,107,['lanes']],
 ['Jetty','Jetty','URMA 通信端点/队列上下文；代码为每个向量核读取独立 Jetty 的 SQ/CQ 信息，配合每个 peer 的远端元信息。专名不展开成猜测的缩写。',H,80,['jetty','private Jetty']],
 ['Hcomm','Hcomm','AscendC 的通信相关类型/API 名称前缀，如 HcommJettyInfo 和 HcommUrmaSgeCtx；源码未给出可验证英文缩写展开。',H,76,[]],
 ['dispatch','dispatch','把输入 token 按专家路由发给负责专家的 rank，并在接收端按本地 expert 展开到输出行。',D,559,['Dispatch']],
 ['epilogue','epilogue','通信提交后的接收/展开收尾阶段；先 drain/barrier 确认接收可消费，再按 expert 分配和复制输出。',E,181,[]],
 ['barrier','barrier','参与者同步屏障；本代码 epilogue 默认 barrier 带 drain，等待异步通信完成后才使用接收 buffer。',E,199,[]],
 ['drain','drain','等待此前异步通信请求的完成状态被收齐，保证其读取/写入已完成；不只是把队列工作提交出去。',E,199,[]],
 ['fence','fence','通信顺序约束标志；最后 physical SQE 请求强顺序和完成通知，不能把 fence 本身当作所有载荷已消费。',D,393,[]],
 ['strong order','strong order','最后 physical SQE 使用的强顺序标志，配合 fence/CQE 保证通信完成跟踪；真实语义由句柄代码与接口定义。',H,38,[]],
 ['WRITE','WRITE','把 SGE 指向的本地数据写到远端接收地址的 URMA 请求类型；门铃提交后异步执行。',H,23,[]],
 ['NOP','NOP','No Operation（空操作）；为 SQE 固定预留但没有有效数据的 WQEBB 写 NOP header。',D,416,['nop']],
 ['trace','trace','实机执行追踪记录；本页只按冻结源码制作教学批次，不能用于推断 NPU 时间线或性能。',K,49,[]],
 ['atomic','atomic','原子操作；例如 asc_atomic_add 返回旧计数并增加 1，从而分配互不重叠的槽位。教学模型选择一种合法顺序，不保证硬件按 token 编号执行。',D,186,['原子']],
 ['dtype','dtype','元素的数据类型，如 int64、int32、bfloat16 或 sf_pack_t；决定每元素字节数和解释方式。',L,14,[]],
 ['shape','shape','逻辑维度；本图每条 x 的 shape=[H]，整个输入为 [T,H]。有效数量和预留容量要分别理解。',L,107,[]],
 ['bytes','bytes','字节长度，单位 B；不是数组元素个数。hiddenBytes=H×元素字节数。',L,55,['B','byte']],
 ['global_idx','global_idx','来源 token 的全局编号，source_rank×M+token；M 是每 rank 容量步长，不能用本轮 T 代替。',D,779,['global','gid','g']],
 ['master','master top-k slot','接收记录中最后匹配本地 expert 的 top-k 位置 j，用于 combine 后续识别主匹配项；不是 expert ID。',E,484,[]],
 ['s','s','输出图中 s=expanded output slot，按本地 expert 分段并对齐后的 recv_x 行号。',{file:E},0,[]],
 ['raw','raw','expert 的实际有效 token 数量，不包含对齐 padding。raw end 则是前面专家对齐容量加本 expert 有效数量。',D,519,['expert raw end']],
 ['start','start','expert 输出段起点：第一个为0，其余由前一 expert raw end 向 A 行对齐得到。',E,422,[]],
 ['end','end','区间的结束位置；本代码 expert raw end 不含该 expert 尾部 padding，aligned end 才是对齐容量终点。',E,548,[]],
 ['UNKNOWN','未写入','当前调用尚未生产有效值；它不是数值0，不能消费或用作本次算术操作数。cached继承值也必须说明来自前次fresh。',E,548,[]],
 ['packing','pack','为传输存储的原始打包数据。本图 SF pack 为16bit位模式，metadata是连续内存逻辑剖面而不是C++ struct。',L,14,['packs']],
 ['handle','handle','fresh 返回并供cached复用的路由/槽位/前缀元信息；另一个同名handle命名空间承载Jetty通信接口，要按源码上下文辨别。','deep_ep/buffers/ep.py',210,[]]
];for(const [id,label,def,file,line,aliases]of concepts)add(id,label,def,{sourceRef:ref(typeof file==='string'?file:E,line||422),aliases});
const objectRows=`x|原始输入 hidden 向量；按 token 和 hidden 元素索引读取。|89
topk_idx|每个 token 的 K 个全局 expert ID；-1表示无选择。|91
topk_weights|每个 top-k 位置的float权重；可不提供，metadata仍预留对应区域。|743
sf|输入SF pack数组；16bit原始位模式，不是动画已解码的scale。|698
dst_buffer_slot_idx|每token、每top-k位置的目的接收槽映射；槽相对目的buffer的来源rank分区。重复rank/无选择lane为-1。|281
dst_gsge_idx|每token/top-k的核内逻辑SGE pair位置，用于cached恢复；local/无选择为-1。不是GM地址。|282
local_copy_dst_slot_idx|本机副本的接收槽；-1表示该token无需本机复制。先核内局部槽，分配后覆盖为来源分区最终槽。|127
metadata_send_buffer|每条输入的GM发送元数据块；fresh包含topk/global_idx，cached省略这些缓存字段。|775
rank_histogram_sum_view|各AIV的rank计数求和教学视图，不是源码实际GM分配；顺序为目的rank0到R-1。|248
expert_histogram_sum_view|各AIV的expert计数求和教学视图，不是实际GM分配；一个有效expert选择计一次。|211
ub_rank_histogram|每AIV的UB rank_histogram；最初计数，跨核前缀后覆盖为该核之前的排他前缀。|242
ub_expert_histogram|每AIV的UB expert_histogram；索引为全局expert，计每个有效top-k命中。|179
local_rank_histogram|EPSignals中每AIV每目的rank的计数/前缀信号；教学明确拆arrival与count。源码高8位arrival、低24位value。|220
psum_num_recv_tokens_per_rank|接收rank按来源rank排列的包含式前缀；末元素是去重接收记录总数。|538
psum_num_recv_tokens_per_expert|每本地expert的raw end：之前expert的aligned容量总和+本expert有效数。不是普通原始count累加。|519
num_unaligned_recv_tokens_per_expert|每本地expert实际有效接收数，未加对齐padding。|488
signals|教学聚合完成状态，并非一个真实C++ struct；counts就绪和payload就绪分开。|298
SQE|教学的发送描述符剖面，按token展示private Jetty SQ中远端工作；最多两个SGE pair副本。|403
recv_buffer|目的rank的GM接收容量；按来源rank分区，每分区M条，记录包含hidden+metadata。|95
recv_src_metadata|每条去重接收记录的输出映射：[K个expanded slot,src_global_idx,master_topk_slot_idx]。|90
recv_x|按本地expert分段并对齐后的输出hidden行；一rank副本可复制到多个expert行。|90
recv_topk_weights|展开输出行对应top-k位置的权重；padding为0仅限启用清零。|90
recv_sf|展开输出行的SF pack位模式；仅搬运，未解码scale。|90
epilogue_expert_counter|每AIV接收流中本核之前的expert计数，供输出槽前缀分配。|90`;
for(const row of objectRows.split('\n')){const [id,def,line]=row.split('|'),epi=id.startsWith('recv_')&&id!=='recv_buffer'||id==='epilogue_expert_counter';add('object.'+id,id,def,{kind:'对象/数组变量',sourceRef:ref(epi?E:D,+line,epi?'dispatch_copy_epilogue_impl':'simt_persistent_worker'),related:id==='dst_gsge_idx'?['SGEP','slot']:id==='recv_sf'||id==='sf'?['SF']:[]});}
const fieldRows=`metadata_ready|UB标志：发送metadata写GM并等待MTE流水完成后置1；SIMT据此继续本机metadata复制。|801
local_copy_ready|UB标志：SIMT完成本机槽位映射后置1，scalar据此安排hidden复制；不是整个payload已到达。|298
doorbell|本图URMA提交状态，DB只证明队列已通知，不证明远端写完成。|857
payload|教学聚合载荷状态；经drain/barrier才显示可消费。|199
arrival|统计发布/到达次数或阶段标志；local rank教学1=count ready、2=prefix ready，和载荷状态不同。|220
count|按目的rank顺序的本核去重token计数；低24bit统计值与高8bitarrival分开显示。|220
exclusivePrefix|本AIV之前所有AIV的目的rank计数之和；不含本核，供slot不重叠分配。|244
key|教学记录身份sourceRank:token，关联同一token的各位置副本；不是通信payload字段。|173
status|教学记录位置的搬运状态；本机复制完成/远端WRITE完成，不是硬件实测时刻。|431
weights|发送metadata或输出记录的每top-k权重。|743
topk|连续metadata中K个expert ID；cached模式不发送此字段。|731
src_global_idx|来源token全局编号sourceRank×M+token，用于后续还原；cached本轮不发送。|779
padding|元数据的字节对齐空洞，位模式未定义；不等于输出清零padding。|619
logicalSQE|教学逻辑SQE索引；核内SGE pair索引÷6，按路由分组规划。|274
physicalSQE|教学选择的物理SQE发号顺序；源码并发atomic取号，不保证真实顺序与逻辑编号相同。|339
dst_rank|发送描述符目的rank编号，由expert ID÷每rank专家数推导。|182
dst_slot|目的buffer内来源rank分区的槽，不是expert展开输出槽。|272
remote_offset|远端地址相对接收区起点的字节偏移=(sourceRank×M+slot)×tokenBytes。|402
SGEs|发送描述符内散布/聚集元素列表，两项分别指hidden和metadata。|403
source|SGE来源内存地址的教学表示，带对象名和字节偏移，是真实源数据引用而非复制临时包。|411
num_sges|一个SQE中实际SGE数量；本例每有效pair有2条。|372
validWQEBBs|SQE内容占用的有效64B块数量，ceil((48+SGE数×16)/64)，不含预留NOP。|373
reservedWQEBBs|每SQE固定预留4个64B块，剩余块写NOP，不是4个有效数据块。|24
finalFlags|是否为最后physical SQE请求strong order/fence/CQE；本图布尔值，详细flags见源码。|393`;
for(const row of fieldRows.split('\n')){const [id,def,line]=row.split('|');add('field.'+id,id,def,{kind:'嵌套字段',sourceRef:ref(id==='payload'?E:D,+line),related:id==='SGEs'?['SGE']:id==='padding'?['padding']:[]});}
add('field.sf','sf','此记录metadata中的SF pack原始位模式，复制自输入SF；cached也可携带，本动画不解码scale。',{sourceRef:ref(D,702),related:['SF']});
add('field.hidden','hidden','接收record中的hidden向量字段，原样来自源token x；metadata与它是两个SGE段。',{sourceRef:ref(D,407),related:['hidden','object.x']});
const functions=`simt_persistent_worker|SIMT常驻worker：路由去重、跨核计数/前缀、槽位、SQE、local metadata以及接收计数归约。|${D}|86
dispatch_impl|AIV入口：启动SIMT worker，同时用scalar/MTE打包metadata和复制local hidden，最后提交Jetty门铃。|${D}|559
dispatch_copy_epilogue_impl|接收展开入口：先drain通信，按rank遍历接收流，再按expert写recv_x并处理padding。|${E}|181
launch_dispatch|主机kernel启动包装：验证/选择模板参数，把指针与运行时数量传给dispatch_impl。|${K}|20
launch_dispatch_copy_epilogue|主机启动接收展开kernel的包装。|csrc/kernels/ep/dispatch_copy_epilogue.hpp|18
EPBuffer|主机侧专家并行buffer管理类，管理通信buffer和dispatch/epilogue调用。|csrc/buffers/ep.hpp|29
fill_ubuf|SIMD将UB整数数组填成给定value，处理尾部掩码。|${E}|21
histogram_accumulate_u32|SIMD读取int64 expert IDs，过滤本地范围并增加uint32专家直方图。|${E}|37
initialize_dst_slot_idx|把每核前置expert计数加上对齐后的expert起点，得到输出槽起始值。|${E}|103
PSumIterator|基于来源rank包含前缀定位接收流到某个来源rank及其分区内槽。|${E}|128`;
for(const row of functions.split('\n')){const [id,def,file,line]=row.split('|');add('fn.'+id,id,def,{kind:'函数/类型',sourceRef:ref(file,+line,id)});}
const srcRows=`thread_idx|本SIMT worker中的线程编号threadIdx.x。
warp_idx|SIMT线程所属warp编号，thread_idx/warpSize。
lane_idx|warp内线程位置，thread_idx%warpSize。
group_idx|扫描top-k的线程小组编号；thread_idx/num_threads_per_group。
group_lane_idx|线程在top-k小组内位置；超出K的lane不加载expert。
routing_group_mask|本top-k线程组在warp中的掩码，只在组内去重。
entry_idx|当前核负责token的top-k展平位置；i×K+group_lane_idx；SQE构造时由sgep_to_entry反查。
token_idx|dispatch的源rank输入行号；vec_core_idx×核容量+i。
topk_offset|topk_idx或dst映射的展平索引token_idx×K+top-k位置。
dst_expert_idx|当前top-k选中的全局expert；-1为无选择；expert归约分支中减去目的rank起点得到local expert。
dst_rank_idx|由有效expert除每rank专家数得到目的rank；被去重的lane或无expert为-1。
dst_slot_idx|dispatch目的buffer中本来源rank分区内的槽号；epilogue同名变量为expert展开输出槽，按文件区分。
dst_sgep_idx|对目的rank计数器原子加1返回的旧值，核内该目的rank的副本/SGE pair序号。
sgep_idx|核内某目的rank的SGE pair编号，或构造时由lane分工算出的本SQE pair位置；依具体源码行区分。
global_sgep_idx|核内整个逻辑SQE范围的SGE pair索引=lsqe_base×6+sgep_idx。
global_sge_idx|SQE构造时用physical SQE编号×6+lane，反查sgep_to_entry中的路由entry。
gsge_idx|cached从dst_gsge_idx读出的旧核内pair映射；>=0用于恢复反查，-1对应local/无选择。
max_gsge_idx|cached本核所有有效gsge索引的最大值，用ceil_div(max+1,6)恢复逻辑SQE数量。
sgep_to_entry|UB内从全局核内pair索引到路由entry的逆映射；初始-1表示没有有效pair。
lsqe_base_idx|每目的rank在本核逻辑SQE范围中的起点；由原子取号获得。
lsqe_counter|本核所需逻辑SQE计数，按各remote rank所需ceil(count/6)累计。
psqe_counter|实际写SQE时物理工作槽的原子取号计数器。
psqe_idx|此warp原子取号取得的physical SQE编号，warp内广播后共同写字段。
peer_idx|跨核/跨rank循环中的目的peer编号；按源码本处循环分工分配。
peer_rank_idx|创建逻辑SQE范围时轮转访问的目的rank=(rank_idx+thread_idx)%R。
num_entries|cached本核有效token范围乘K后的路由entry数量。
num_iterations|fresh路由扫描为线程组数量对齐后的循环范围，可能含不加载token的空迭代。
num_iters|本机metadata复制循环中本AIV有效输入token数量。
num_threads_per_group|扫描一个token top-k的线程小组大小，K向上取2的幂。
num_groups_per_wave|一波SIMT线程可同时扫描多少token，线程数÷top-k小组大小。
num_sqes|此AIV待构造/提交的SQE总数，取UB lsqe_counter。
num_sqes_per_warp|各warp分配到的逻辑SQE范围大小ceil(num_sqes/kNumWarps)。
start_lsqe_idx|当前warp逻辑SQE区间起点。
end_lsqe_idx|当前warp逻辑SQE区间不包含式终点，截断至num_sqes。
num_sgeps|SQE中有效entry的数量，即有效SGE pair数。
num_sges|实际SGE条数=有效pair数量×2。
num_wqebbs|实际SQE字节数向64B取整后所需WQEBB数量，不含预留NOP。
sqe_dst_rank_idx|从路由lane0广播的此SQE目的rank。
sqe_dst_slot_idx|从路由lane0广播的此SQE目的来源分区槽。
sgep_entry_idx|当前写字段lane从对应pair的lane交换来的路由entry。
sgep_lane_idx|pair内写64bit字的lane位置：长度hidden、地址hidden、长度meta、地址meta。
slot_head|physical SQE起始WQEBB头位置=原SQ head+psqe_idx×4。
wqebb_head|当前lane所在WQEBB的完整头位置。
owner_bit|由WQEBB跨SQ环绕周期推导的owner位，写入header bit31。
sq_wqebb_idx|当前WQEBB在SQ环内的索引=wqebb_head%kSQDepth。
sqe_word|当前lane要写入SQ的64-bit字段字；按lane决定header、peer字段或SGE地址/长度。
sq_base_addr|Jetty SQ描述符存储的GM基地址。
packed_head|Jetty把SQ WQEBB head与期望completion count压在同一个uint64字段；低32为head、高32为完成计数。
peer_info_words|把当前目的peer信息看成64bit字数组，用于填SQE header。
jetty_info|本核Jetty的UB队列上下文，含SQ/CQ地址、head等。
peer_info|目的peer的UB通信元信息，提供远端地址/token等header字段。
jetty_ptrs|传给kernel的Jetty与peer描述符指针表。
rank_psum|UB按目的/来源rank的聚合计数暂存数组，最后写成GM包含前缀。
rank_histogram|UB rank计数数组；之后复用为本核之前的排他前缀；含义随阶段改变。
expert_histogram|UB expert计数数组；源路由阶段按全局expert统计，远端归约后AIV0把local expert数量写到前部。
workspace_layout|设备GM工作区布局访问器，定位信号、直方图、前缀计数等。
host_workspace_layout|映射主机可见工作区访问器；kDoCPUSync时写回接收expert/rank数量。
recv_buffer_offset|源rank在目的接收buffer中的对称地址字节偏移，含M个记录的来源分区起点。
num_hidden_bytes|每token hidden部分字节长度=H×dtype元素字节数。
num_metadata_bytes|每token发送metadata字节长度，包含分支字段及字节对齐。
num_token_bytes|接收record总字节长度=hidden字节+metadata字节。
num_tokens|当前源rank本轮有效输入token数量T，0<=T<=M。
vec_core_idx|本rank的AIV向量核编号；决定输入范围和private Jetty。
rank_idx|本kernel所在rank编号；PSumIterator同名成员是当前接收流所属来源rank。
lower_ptr|local rank统计矩阵较低32核半部某lane的GM信号指针。
upper_ptr|local rank统计矩阵较高32核半部某lane的GM信号指针。
lower|较低半部当前lane读到的核计数，越界lane为0。
upper|较高半部当前lane读到的核计数，越界lane为0。
lower_sum|lower值在warp内的包含前缀。
upper_sum|upper值在warp内的包含前缀。
lower_total|较低核半部所有计数总和，由末lane广播。
upper_total|较高核半部所有计数总和，由末lane广播。
inclusive_psum|跨warp分块累积的前缀基数；expert分支累加aligned数量，rank分支累加原count。
inclusive_warp_psum|当前warp内包含式前缀；expert分支输入aligned count，rank分支输入原count。
exclusive_warp_psum|expert warp前缀减当前aligned count，得到当前expert之前的容量。
psum|rank分支：前块累计+本warp包含前缀；PSumIterator成员为来源rank包含前缀指针。
aligned|当前expert有效数量向kExpertAlignment行对齐后的容量。
num_recv_tokens|接收记录数量；dispatch expert归约中为当前expert数量，epilogue中为rank前缀末元素的去重接收总数。
num_local_tokens|源rank对指定全局expert的命中总数，经本rank所有AIV归约获得。
cumulative_local_expert_recv_stats|可选长期累积统计数组，atomic增加各local expert当前接收数量。
status|归约packed状态（到达次数+低位count），不同于页面signals/record.status教学聚合。
first_metadata_idx|metadata批次在当前AIV输入范围内的首token位置。
first_token_idx|当前metadata批次对应整个来源rank输入的首token编号。
metadata_token_layout|仅metadata部分的TokenLayout，hidden字节数为0。
ub_metadata_buffer|一阶段UB metadata内存区基地址。
ub_metadata|当前阶段/当前token的UB元数据布局访问器。
ub_hidden|当前本机hidden复制阶段的UB暂存区。
gm_sf|当前输入token的GM SF起点，由sf_token_stride寻址。
sf_token_stride|SF张量沿token维的元素跨度，乘sizeof(sf_pack_t)得到字节偏移。
sf_hidden_stride|SF沿pack/hidden分组维的元素跨度，区分行主序和列主序。
hidden_stage_idx|本机hidden流水的循环UB阶段索引。
stage_idx|本处MTE流水阶段的循环索引；对应阶段数组而非token编号。
num_tokens_in_stage|本metadata MTE批次实际有效token数，不超过批容量且截断至输入尾部。
num_active_stages|最初预加载的有效metadata流水阶段数，不超过总stage容量与batch数。
num_metadata_batches|本AIV所有有效token需多少metadata批次，向上取整。
num_tokens_for_vec_core|当前AIV范围内有效源token数，按num_tokens和核容量截断。
batch_idx|metadata写回流水的当前batch编号。
next_batch_idx|预加载的下一metadata batch编号。
base|本源码pointer/UB布局访问时的基地址；在所示赋值中确定实际对象。
loop_desc|NDDMA多维搬运的循环描述参数，控制token/SF分组的计数与源/目的步长。
nddma_desc|NDDMA多维数据搬运描述符，由loop_desc及padding配置构成。
sf_desc|处理SF元素跨度的NDDMA描述符。
preload_metadata|lambda：按batch加载SF/topk/weights进UB metadata流水阶段。
ub_layout|当前AIV的UB工作结构指针，保存统计、路由映射、队列上下文和ready标志。
ub_layout_t|DispatchUBLayout模板类型，决定每核UB工作字段容量。
ub_layout_with_buffer_t|UBLayoutWithBuffer模板类型，含工作结构和metadata/hidden流水暂存。
workspace|设备工作区指针；UBLayoutWithBuffer成员同名workspace为核内统计结构。
host_workspace|CPU同步使用的主机映射工作区指针。
buffer|GM通信接收buffer指针，按TokenLayout/BufferLayout解释。
recv_buffer|按来源rank分区的接收buffer布局访问器，每分区容量M。
metadata|UBLayoutWithBuffer中的分批元数据暂存数组。
hidden|UBLayoutWithBuffer中的分批hidden暂存数组。
token_layout|记录各字段byte offsets/总长度的TokenLayout对象。
num_hidden_bytes|每个hidden向量的字节长度。
num_max_tokens_per_rank|每来源rank最大token容量M，决定分区步长而非本轮有效数量。
num_vec_cores|每rank启动的向量核数C。
num_ub_bytes|当前kernel可用的UB容量，字节单位。
num_ubuf_bytes|启动端计算的每向量核UB容量，字节单位。
num_blocks|启动Ascend kernel的执行block数量。
num_timeout_cycles|等待统计/通信完成所用的超时cycle上限。
num_ranks|专家并行参与rank数量R。
num_experts|全局专家总数量E。
num_topk|每token路由位置数K。
num_sf_packs|每token的SF pack数量，BF16分支为0。
expert_alignment|每local expert输出行数向上对齐单位A。
cached_mode|是否从先前handle复用槽位/前缀，省去本轮路由统计。
do_cpu_sync|是否将接收计数写主机映射工作区供host分配输出。
do_barrier|是否执行启动/收尾同步屏障；源码模板分支决定实际是否drain。
do_zero_padding|是否把expert输出对齐空洞写0。
ptr|当前语句明确指向的工作区信号地址；本处赋值与引用索引见原文，不是数据值。
idx|前缀循环的expert/rank索引=i×warpSize+thread/lane；按源码分支解释。
value|prefix分支当前expert或rank的原始count，越界lane补0；不是x的hidden载荷。
src|本机metadata复制的GM源指针，metadata_send_buffer+token×metadataBytes。
dst|本机metadata复制的GM目的指针，接收slot起点+hiddenBytes。
word_idx|metadata以uint64拷贝时的8字节字索引，warp lane跨步循环。
i|本处for循环迭代索引；具体遍历范围与步长由同一源码行的for子句定义。
j|top-k lane索引，按j选择expert/weight/expanded slot，不是expert编号。
token|当前接收/暂存token的TokenLayout访问器；教学token概念另有入口。
first_expert_idx|本rank负责的第一个全局expert ID=rank_idx×每rank专家数。
local_expert_idx|匹配expert减first_expert_idx后的本地expert编号。
expert_idx|padding遍历的本地expert编号，或histogram索引，按当前函数分支定义。
master_topk_slot_idx|fresh展开过程中最后命中的top-k位置j，写到recv_src_metadata最后元素。
has_dst_slot|当前top-k位置j是否匹配一个本地expert输出槽。
metadata_buffer_idx|epilogue输出映射metadata流水暂存区的循环索引。
metadata_ptr|epilogue当前接收记录对应recv_src_metadata暂存行指针；含K个slot+global_idx+master。
token_base_idx|本MTE stage首条记录在去重接收流中的位置。
num_stage_tokens|该MTE stage实际包含的有效接收记录数。
ub_expert_token_count|epilogue本核local expert计数数组；随后内存复用为ub_next_dst_slot_idx。
ub_next_dst_slot_idx|epilogue每local expert下一输出slot，初值=前置核count+对齐expert起点。
ub_psum_num_recv_tokens_per_expert|UB中的前expert raw end，向A对齐后成为各expert起点。
ub_metadata_buffers|epilogue输出映射metadata的双阶段UB暂存区。
ub_zero_buffer|epilogue用于padding清0的UB全零字节向量。
gm_recv_sf|当前expanded output slot的GM SF pack目标地址。
gm_recv_topk_weights|当前expanded slot的GM top-k weight目标地址。
recv_sf_token_stride|输出SF张量沿token/输出行维的元素跨度。
recv_sf_hidden_stride|输出SF沿pack维的元素跨度。
expert_token_end_idx|当前expert的raw end，不含其尾部padding。
num_pad_tokens|当前expert从raw end到aligned end之间的空洞行数。
num_tokens_per_part|padding行数平均分给kNumPaddingParts后的基础份额。
num_extra_tokens|padding均分后余数；前若干part各再分1行。
pad_token_start_idx|当前part的padding子范围起点，相对raw end。
num_part_tokens|当前part实际负责清零的padding行数。
pad_token_idx|本part逐条清零的padding输出行索引。
part_idx|padding任务份编号；多个AIV按expert和part分工。
kExpertCountCumsumBarrier|epilogue计数向后续AIV原子广播后的核间屏障ID=1。
kExpertCountClearedBarrier|epilogue各核先清计数行后的核间屏障ID=0。
kNumPaddingParts|每expert padding工作拆成的份数，源码为4。
kNumHistogramBins|epilogue SIMD histogram容量，local expert<=256取256，否则512。
kNumMetadataBytesPerToken|epilogue映射metadata每record字节数=(K+2)×sizeof(int)。
kNumMetadataElemsPerToken|epilogue映射metadata每record元素数=K+2。
kNumMetadataStageBytes|epilogue一metadata stage字节容量，按UB字节对齐。
kNumMetadataStages|epilogue output metadata暂存stage数，源码为2。
kNumZeroBytes|一个全零SIMD向量的字节数，供padding块复制。
kNumSFBytes|每token SF pack总字节数=pack数×sizeof(sf_pack_t)。
kNumTokensPerMetadataMTE|dispatch一次metadata MTE批次最多token数，由可用UB容量选择64或4。
kNumWQEBBLanes|64B WQEBB包含多少64-bit lane字段，源码为8。
kNumSGEPairLanes|两SGE占多少64-bit lane字段，源码为4。
kNumWriteHeaderLanes|48B URMA SQE header占多少64-bit lane字段，源码为6。
kNumWQEBBsPerSQESlot|每SQE固定预留WQEBB块数，源码为4。
kNumSGEPairsPerSQE|单SQE的pair容量，模板本实现固定6。
kNumMaxSGEPairsPerSQE|句柄接口允许的每SQE最大pair数，源码6。
kNumWQEBBBytes|每WQEBB块字节数，源码64。
kSQDepth|Jetty发送环队列的WQEBB深度，环索引模此值。
kSQEBBAlignment|本kernel要求SQ起点的队列基本块对齐单位，验证packed_head低位。
kWriteSQEFinalFlags|最后physical SQE请求strong order/fence/CQE的位掩码。
kWriteSQEHeaderTemplate|URMA WRITE header的预填位模板。
kNopSQEHeaderTemplate|NOP header的预填位模板，供预留而非有效内容的WQEBB。
kReductionIdentity|packed reduction中高位的一次arrival单位，同时低位累加count。
kNumExpertsPerRank|每rank负责的expert数量=E/R。
kNumMaxTokensPerVecCore|每AIV预留输入容量=ceil(M/C)。
kNumRanks|参与rank总数R。
kNumExperts|全局expert总数E。
kNumTopk|每token路由位置数K。
kNumHiddenBytes|每token hidden字节数。
kExpertAlignment|每expert输出段的行对齐单位A。
kNumMaxTokensPerRank|每来源rank接收分区的token容量M。
kNumVecCores|每rank参与的AIV数C。
kNumSFPacks|每token SF pack数量，0时不走SF搬运。
kNumThreads|SIMT worker线程数。
kNumWarps|SIMT线程数÷warpSize得到warp数。
kCachedMode|模板布尔值，是否复用先前fresh路由元信息。
kDoCPUSync|模板布尔值，是否写回host可见计数。
kDoBarrier|模板布尔值，是否在当前路径执行同步屏障。
kNumTimeoutCycles|轮询等待的超时cycle阈值。
kNumMaxVecCores|实现支持的最大AIV数量上限。
kNumHiddenMTEStageBytes|hidden流水每UB stage的对齐字节大小。
kNumAvailableMetadataBytes|总UB扣掉工作结构和hidden stage后可用于metadata的字节数。
kNumMetadataTokenBytes|仅metadata TokenLayout的每record字节数。
kNumMetadataMTEStageBytes|每metadata MTE stage字节容量。
kNumMetadataMTEStages|dispatch metadata流水stage个数，由容量/输入规模决定且至多8。
kNumHiddenMTEStages|dispatch local hidden流水stage个数，由剩余UB容量决定且至多8。
kNumUbAlignmentBytes|UB数据地址/大小的字节对齐常量。
kNumUbBytes|dispatch模板传入的可用UB字节数。
kNumUBBytes|epilogue模板传入的可用UB字节数。
kNumMaxRemoteEntries|本AIV最多远端token top-k路由entry容量。
kNumMaxSQEs|最坏路由分布下本AIV所需SQE数量上界。
kNumMaxURMAEntries|本AIV的URMA路由entry容量模板参数。
kNumMaxLocalCopies|本AIV本机token复制容量模板参数。
kNumMaxSGEs|UB逆映射数组容量；允许各peer向SQE容量补齐。
kNumJetties|每rank通信Jetty数量，与向量核数量选择相关。
kNumMaxRanks|该通信布局支持的最大rank数量常量。
kReductionMaxHighCount|归约packed状态高位arrival数量的上限。
kReductionMaxLowCount|归约packed状态低位value/count的上限。
warpSize|SIMT一个warp的线程数；warp/group公式用的基础常量。
EP_DEVICE_ASSERT|设备端运行时断言，检查动态输入/队列条件。
EP_STATIC_ASSERT|编译期断言，检查模板/布局静态约束。
EP_HOST_ASSERT|主机端断言，启动前验证shape/dtype/容量和配置。
asc_atomic_add|原子加法；读取旧值后加delta，返回旧值用于槽位/SQE取号。
asc_atomic_max|原子最大值；cached恢复本核最大逻辑SQE计数。
asc_reduce_max|SIMT归约取所有参与线程的最大值。
asc_ballot|把warp各lane条件收集成位mask，检测某token组是否有本机目的。
asc_syncthreads|SIMT worker线程同步，确保UB共享字段生产后再读取。
asc_threadfence|设备内存访问栅栏，保证读取计数完成/发布顺序。
asc_stcg|SIMT把一个字写到GM；本代码用于写SQE和local metadata。
asc_copy_gm2ub_align|按bursts从GM搬到UB，参数为次数、字节长度和步长；MTE2执行。
asc_copy_ub2gm_align|按bursts从UB搬到GM，参数为次数、字节长度和步长；MTE3执行。
asc_sync_notify|向两执行流水间的指定事件发布完成通知。
asc_sync_wait|等待指定流水事件，确保依赖数据可用。
asc_sync_inter_arrive|发布AIV核间同步到达，用于计数clear/cumsum屏障。
asc_sync_inter_wait|等待AIV核间屏障的参与核到达。
asc_set_atomic_add_int|把MTE写GM模式设为整数原子加，广播expert计数。
asc_set_atomic_none|把MTE写GM恢复成普通复制模式。
asc_set_ub2gm_loop1_stride|设置UB→GM复制循环的源/目的步长。
asc_set_ub2gm_loop_size|设置UB→GM嵌套循环次数。
advance_sq|在Jetty中推进SQ队列头，配合后续ring_doorbell提交。
ring_doorbell|通知Jetty通信引擎处理已写SQE；不是等通信完成。
advance_ptr|按字节偏移移动指定地址空间的指针。
ceil_div|整数除法向上取整，ceil(x/y)。
min|取较小值；用于把有效范围截断至实际数量/容量。
max|取较大值；用于防止空范围为负或统计上界。
exchange|SIMT warp内从指定源lane广播/交换某个值。
warp_inclusive_sum|SIMT warp内包含式前缀和。
wait_ready|轮询packed reduction状态直到arrival满足指定次数，可带超时。
get_reduction_value|提取packed reduction低位计数值，去除高位arrival。
make_reduction_status|把arrival次数与count打包为reduction信号。
get_base_ptr|返回当前布局对象对应内存区域的起点。
get_num_bytes|返回Token/Buffer布局占用的总字节长度，可选择只要metadata。
get_hidden_ptr|定位记录中hidden向量的起始地址。
get_sf_ptr|定位记录中SF pack区域起始地址。
get_topk_idx_ptr|定位fresh记录中的expert ID数组起点。
get_topk_weights_ptr|定位记录中的K个top-k weight起点。
get_src_token_global_idx_ptr|定位fresh记录的来源token全局编号字段。
get_token_buffer|从rank分区内按slot定位一条完整接收记录。
get_rank_buffer|按rank编号定位接收buffer的分区起点。
get_buffer_end_ptr|返回buffer布局的结束地址，用于后续UB区域拼接。
get_sym_ptr|根据对称信号区本地地址和目的rank定位远端对应地址。
get_common_signals|定位包含对称buffer指针/同步信号等的公共信号区域。
get_local_rank_histogram_ptr|定位GM中的某AIV某目的rank统计/前缀信号。
get_local_expert_histogram_ptr|定位本rank汇总指定全局expert命中的GM信号。
get_remote_expert_histogram_ptr|定位来自各源rank汇总到本rank的local expert信号。
get_remote_rank_histogram_ptr|定位本rank收到的某来源rank数量信号。
get_host_rank_count_ptr|定位CPU可见的某来源rank接收数量信号。
get_host_expert_count_ptr|定位CPU可见的local expert对齐接收数量信号。
get_epilogue_expert_counter_ptr|定位某AIV的前置核local expert计数行。
get_iqent|查询PIPE_MTE2指令队列状态/可发令能力；本代码返回值>1才继续issue_load预加载。精确硬件返回字段没有在此源码展开，不臆造缩写。
InitSocState|初始化Ascend设备运行状态，kernel入口调用。
GetBlockIdx|获取当前执行block/AIV编号。
WriteGmByPassDCache|按指定内存策略写GM，代码用于clear计数/信号。
ReadGmByPassDCache|绕过数据cache读GM信号，用于同步轮询。
EVENT_ID0|源码使用的流水事件编号0；不是全局教学步骤。
PIPE_MTE2|GM→UB搬运流水标识。
PIPE_MTE3|UB→GM搬运流水标识。
PIPE_S|标量流水标识。
PIPE_V|向量流水标识。
event_t|Ascend流水同步事件编号类型。
LD_L2CacheType|GM读取的L2 cache策略枚举类型。
ST_L2CacheType|GM写入的L2 cache策略枚举类型。
L2_CACHE_HINT_NORMAL_FV|普通L2缓存策略枚举值；本图不测量其性能。
L2_CACHE_HINT_NOTALLOC_CI|不分配缓存的L2策略枚举值，减少同步计数污染。
L2_CACHE_HINT_NOTALLOC_CLEAN|不分配且清理的L2策略枚举值。
NOTALLOC_CLEAN|内联汇编选择的不分配/清理store cache模式。
NORMAL_FIRST_VICTIM|正常缓存策略名称，用于当前load cache设置。
asc_store_l2_cache_mode|设置SIMT写GM的L2缓存策略。
asc_load_l2_cache_mode|设置SIMT读GM的L2缓存策略。
asc_mark_stamp|可选设备trace打点，教学动画不读取真实trace。
ASCENDC_TRACE_ON|编译时是否开启AscendC trace打点的宏。
VF_CALL|调用设备vector/SIMT函数的编译接口。
Simt|AscendC启动SIMT VF的接口类型。
Dim3|设备调用使用的三维执行维度类型。
DispatchUBLayout|保存本核统计、路由索引、SQE计数、ready和Jetty上下文的UB结构。
UBLayoutWithBuffer|UB工作结构加metadata/hidden多阶段暂存的组合布局。
TokenLayout|连续记录布局访问器，定位hidden/SF/topk/weights/global_idx并计算对齐字节长度。
BufferLayout|由token布局、分区数和每分区容量组成的buffer布局访问器。
EPWorkspaceLayout|设备工作区信号/统计/epilogue前缀的布局访问器。
HcommJetty|操作通信队列的接口类型，包括推进SQ、门铃和drain。
HcommJettyInfo|Jetty SQ/CQ上下文数据类型，本代码从指针表加载到UB。
HcommPeerInfo|目的peer远端地址/通信header元信息的数据类型。
HcommUrmaSqeCtx|URMA SQE header结构类型，本代码sizeof为48B。
HcommUrmaSgeCtx|URMA SGE结构类型，本代码sizeof为16B。
AscendC|Ascend C设备编程接口命名空间。
math|本库的数学/字节指针辅助函数命名空间。
simt|本库SIMT去重、warp前缀、lane交换辅助命名空间。
scalar|标量执行版本接口命名空间。
comm|通信接口命名空间。
layout|内存布局访问器命名空间。
reduction|packed到达/count归约协议的辅助命名空间。
deep_ep|DeepEP-Ascend库的C++命名空间。
__gm__|指针指向设备GM全局内存的地址空间限定。
__ubuf__|指针指向UB片上内存的地址空间限定。
__aicore__|设备AI Core函数标记。
__global__|设备kernel入口标记。
__vector__|向量核kernel标记。
__simt_vf__|设备SIMT vector function标记。
__simd_vf__|设备SIMD vector function标记。
__forceinline__|强制内联函数编译限定。
__launch_bounds__|SIMT线程启动上限编译标记。
__builtin_clz|统计整数最高位前导0，用于K向上取2幂的小组大小计算。
__reduce_add|SIMT归约求和，本代码计有效SGE pair数。
__trap|设备陷阱，断言队列/对齐不合法时终止。
__asc_simt_vf|SIMT设备内建接口命名空间。
threadIdx|SIMT线程位置的内建对象，x是线性线程编号。
kTraceBarrierBefore|可选trace标记：barrier开始前。
kTraceBarrierAfter|可选trace标记：barrier结束后。`;
export const sourceDefinitions=Object.fromEntries(srcRows.split('\n').map(r=>r.split('|')));
const syntaxRows=`int|C++有符号整型，本实现计数/slot通常用32bit。
int64_t|固定64bit有符号整数；topk expert ID用此类型。
int32_t|固定32bit有符号整数。
int16_t|固定16bit有符号整数；sf_pack_t的底层类型。
uint8_t|固定8bit无符号整数；连续buffer按字节访问。
uint16_t|固定16bit无符号整数；SQ索引或burst参数。
uint32_t|固定32bit无符号整数；位掩码和计数。
uint64_t|固定64bit无符号整数；地址或SQE字。
uintptr_t|能够保存指针整数表示的无符号整数类型。
float|单精度浮点类型；top-k权重通常为float32。
bool|布尔类型，仅true/false。
auto|C++由初始化表达式推导变量类型。
const|C++只读限定，此变量/指针目标不可经该引用修改。
constexpr|C++编译期可求值限定或编译期if分支。
static|C++静态成员/存储或内部链接限定，具体由声明决定。
volatile|要求实际执行访问的限定，本代码用于跨执行单元的UB标志。
if|按条件选择分支；未执行分支不产生本步数据。
else|if条件不满足时的替代分支。
for|按初始化、条件、步长重复执行循环。
while|条件为真时重复执行，常用于轮询ready。
continue|跳过当前循环余下语句进入下一次。
break|退出当前循环。
return|返回函数结果或结束当前函数。
sizeof|求类型/对象字节大小；结果单位是byte。
static_cast|C++显式类型转换，按目标数值类型转换。
reinterpret_cast|C++重新解释指针/位表示，不表示数据已搬运或浮点解码。
template|C++模板参数声明，形成编译时kernel特化。
typename|C++类型模板参数或依赖类型限定。
struct|C++结构类型声明；TokenLayout不代表传输数据实际是此struct。
class|C++类类型声明。
alignas|指定类型/对象地址的字节对齐要求。
alignof|求类型地址对齐要求，单位byte。
namespace|C++命名空间声明。
using|C++类型别名或引入命名空间/成员。
unsigned|C++无符号整数限定。
void|C++无返回值类型或无类型指针。
true|布尔真。
false|布尔假。
nullptr|C++空指针，表示可选字段未提供。
not|逻辑非，C++的!替代拼写；Python也使用not。
and|逻辑与，只有两条件都真才真。
or|逻辑或，有任一条件真则真。
asm|C++内联设备汇编，本段设置GM cache策略。
pragma|编译器指令，本代码主要用于展开循环。
unroll|请求编译器展开循环，减少循环控制开销。
include|引入C++头文件声明。
once|pragma once，防止头文件重复包含。
ifdef|预处理条件：宏已定义才保留块。
endif|结束预处理条件块。
defined|预处理检测宏是否已定义。
public|C++类的公共成员访问限定。
override|C++声明覆盖父类虚函数。
noexcept|C++声明函数不抛异常。
INT_MAX|C++int最大正值常量，用于输入/缓冲大小上界检查。
UINT16_MAX|uint16最大值65535，用于SQ索引上界检查。`;
export const syntaxDefinitions=Object.fromEntries(syntaxRows.split('\n').map(r=>r.split('|')));
// The registry is authoritative: rendering performs lexical lookup, never guesses a name's meaning.
for(const [name,definition]of Object.entries(sourceDefinitions))if(!glossary['src.'+name])add('src.'+name,name,definition,{kind:'源码标识符',sourceRef:ref(D,86)});
for(const [name,definition]of Object.entries(syntaxDefinitions))add('syntax.'+name,name,definition,{kind:'语言语法/类型',sourceRef:{file:'C++ 语言语法',line:0,fn:'',url:'https://en.cppreference.com/w/cpp/language.html',commit:null}});
add('slot.recv','slot','dispatch接收槽：目的buffer中来源rank分区内的记录编号；地址=(sourceRank×M+slot)×tokenBytes。',{sourceRef:ref(D,402),unit:'record/source partition',related:['M','object.recv_buffer']});
add('slot.output','slot','epilogue输出槽：按本地expert分段、A行对齐后的recv_x行号；不是来源rank接收分区槽。',{sourceRef:ref(E,482),unit:'output row',related:['A','object.recv_x']});
add('slot.sq','slot','发送队列工作槽：physical SQE预留的4个WQEBB所在环位置；不能套用token接收槽含义。',{sourceRef:ref(D,384),unit:'WQEBB',related:['SQE','WQEBB']});
const objectRefs={recv_x:[E,187],recv_sf:[E,188],recv_topk_weights:[E,189],recv_src_metadata:[E,190],epilogue_expert_counter:['deep_ep/include/deep_ep/layout/ep/workspace.hpp',63]};for(const [name,[file,line]]of Object.entries(objectRefs))glossary['object.'+name].sourceRef=ref(file,line);
glossary.A.sourceRef=ref(E,176);glossary.SQ.sourceRef=ref(H,79);glossary.CQ.sourceRef=ref(H,83);glossary.CPU.sourceRef=ref(D,478);glossary.hidden.sourceRef=ref(L,55);glossary.handle.sourceRef=ref('deep_ep/buffers/ep.py',21);glossary.EP.sourceRef=ref('deep_ep/buffers/ep.py',181);glossary.SF.externalSource='https://github.com/deepseek-ai/DeepEP/blob/main/deep_ep/buffers/elastic.py';glossary['object.num_unaligned_recv_tokens_per_expert'].sourceRef=ref(D,482);glossary['field.source'].sourceRef=ref(D,409);
glossary.R.sourceRef=ref(D,78);glossary.E.sourceRef=ref(D,78);glossary.K.sourceRef=ref(D,78);glossary.C.sourceRef=ref(D,79);glossary.H.sourceRef=ref('deep_ep/buffers/ep.py',342);glossary.BF16.sourceRef=ref('deep_ep/buffers/ep.py',342);glossary.FP8.sourceRef=ref('deep_ep/buffers/ep.py',344);glossary.lane.sourceRef=ref(D,106);glossary['strong order'].sourceRef=ref(H,31);glossary['fn.launch_dispatch_copy_epilogue'].sourceRef=ref(K,84,'launch_dispatch_copy_epilogue');glossary['fn.PSumIterator'].sourceRef=ref(E,131,'PSumIterator');glossary['fn.initialize_dst_slot_idx'].sourceRef=ref(E,108,'initialize_dst_slot_idx');
for(const name of ['SQE','SQ','CQ','CQE','WQEBB'])glossary[name].fullName+='（常用名称；冻结源码只明确功能与命名，未给正式展开）';delete glossary.WQEBB.externalSource;glossary.SGE.fullName='Scatter-Gather Entry（URMA官方用语；亦常称Scatter/Gather Element）';glossary.SGE.externalSource=official.urma;glossary.SF.fullName='Scale Factor（缩放因子；pack表示见本实现）';
for(const [name,definition]of Object.entries(extraDefinitions)){if(!sourceDefinitions[name])sourceDefinitions[name]=definition;if(!glossary['src.'+name])add('src.'+name,name,definition,{kind:'源码标识符/接口',sourceRef:ref(D,86)});}
add('syntax.cppRaw','R','C++原始字符串字面量前缀，不是教学参数R；字符串内容用于JIT源码拼接。',{kind:'语言语法',sourceRef:ref(K,49)});
add('syntax.header','头文件','C++ #include引入的头文件路径，为当前接口提供声明；文件名片段不是变量。',{kind:'语言语法/依赖',sourceRef:ref(D,3)});
const sourceOverrides=[
 {file:'deep_ep/buffers/ep.py',from:35,to:35,names:{data:'Tensor.data直接访问底层存储的视图属性；修改可能绕过Tensor版本检查，cached handle不能据此安全检测路由变化。'}},
 {file:L,from:103,to:132,names:{token_idx:'BufferLayout当前所选分区内的record槽，get_token_buffer按该索引×每record字节推进base；既适用于来源接收分区也适用于UB stage，不是固定源输入T编号。'}},
 {file:'deep_ep/buffers/ep.py',from:1,to:649,names:{hidden:'输入/输出Tensor hidden维度大小H，每token的特征元素数量，决定hidden字节数。'}},
 {file:'csrc/buffers/ep.hpp',from:1,to:608,names:{hidden:'Tensor最后一维hidden元素数H，乘elem_size得到每token hidden字节长度。'}},
 {file:D,from:225,to:226,names:{i:'local-rank-histogram-new注释矩阵的目标AIV核编号，前缀只累加更早核k。',j:'local-rank-histogram-new矩阵的目的rank列编号，不是top-k位置。'}},
 {file:D,from:358,to:369,names:{ptr:'注释SGE源地址：token data项指x+token×hiddenBytes，token meta项指metadata_send_buffer+token×metadataBytes；两者是独立源段，不是工作区信号。'}},
 {file:E,from:100,to:130,names:{i:'initialize_dst_slot_idx等价伪码的local expert bin编号，遍历kNumBins输出slot起点数组。'}},
 {file:E,from:398,to:406,names:{i:'Atomic & Broadcast注释中后续AIV核编号，当前核expert计数广播累加到每个后续核行。'}},
 {file:E,from:430,to:432,names:{i:'尚未预加载的token MTE stage编号，从preload_stage_idx到kNumMTEStages依次issue_load。'}},
 {file:E,from:443,to:446,names:{i:'输出metadata pipeline stage编号，初始化其notify/wait事件。'}},
 {file:'deep_ep/include/deep_ep/comm/barrier.hpp',from:90,to:104,names:{i:'轮询间隔内空操作循环的次数索引，形成等待周期，非token/expert编号。'}},
 {file:'deep_ep/include/deep_ep/comm/barrier.hpp',from:140,to:154,names:{status:'barrier_counter&3得到的两bit轮次/符号状态，不是reduction packed count+arrival。'}},
 {file:'deep_ep/include/deep_ep/layout/ep/workspace.hpp',from:1,to:70,names:{signals:'整个EPSignals工作区结构，含公共对称信号、rank/expert histogram、host count和epilogue expert前缀；不是动画聚合signals。'}},
 {file:H,from:97,to:136,names:{src:'Jetty SQ/CQ上下文加载的GM源地址，由jetty_table中当前端点表项取得，不是metadata_send_buffer。'}},
 {file:H,from:140,to:168,names:{size:'远端注册rma buffer的字节容量字段，提供寻址/保护边界，不是Tensor维度。'}},
 {file:'deep_ep/buffers/ep.py',from:184,to:245,names:{num_bytes:'整个EPBuffer待分配的通信buffer字节容量，不是一个SGE传输片段长度。'}},
 {file:'deep_ep/include/deep_ep/layout/ep/workspace.hpp',from:40,to:45,names:{rank_idx:'local rank统计矩阵当前目的rank列编号，与核索引一起定位GM统计信号。'}},
 {file:'deep_ep/include/deep_ep/layout/ep/workspace.hpp',from:46,to:69,names:{rank_idx:'接收/host统计信号对应的来源rank编号，按来源分区计数，不是本kernel所在rank。'}},
 {file:K,from:1,to:141,names:{ptr:'JIT compile返回的kernel函数入口指针，用作launch调用，不是工作区统计信号地址。'}},
 {file:L,from:1,to:132,names:{ptr:'TokenLayout.set_base_ptr传入的新记录/内存起始指针；改变访问器基址，不代表复制数据。',rank_idx:'BufferLayout.get_rank_buffer所选择的来源rank分区编号，决定rank分区字节偏移。',base:'TokenLayout/BufferLayout当前连续内存区域的起始字节地址。'}},
 {file:H,from:400,to:456,names:{status:'从CQE header提取的完成状态码，用于检查通信错误；不是reduction到达次数/count packed字段。'}},
 {file:'csrc/buffers/ep.hpp',from:1,to:608,names:{data:'Tensor数据视图/存储访问接口，当前对象及Tensor dtype由原文给出；不是epilogue histogram int64数组。',value:'本处std::optional.value()取已提供张量或配置的值；作为局部变量时按本处声明解释。'}},
 {file:'deep_ep/buffers/ep.py',from:1,to:649,names:{data:'Python当前排序重排的hidden/SF/weights Tensor视图，依shape和索引更新；不是SIMD histogram expert ID数组。'}},
 {file:'deep_ep/buffers/ep.py',from:35,to:48,names:{i:'local expert列表索引，对每expert前缀向expert_alignment对齐形成输出段起点。'}},
 {file:'csrc/buffers/ep.hpp',from:299,to:305,names:{i:'CPU同步按来源rank读取host_rank_count的编号，累加去重接收记录总数。'}},
 {file:'csrc/buffers/ep.hpp',from:307,to:323,names:{i:'CPU同步按local expert读取对齐host_expert_count，构造输出容量列表。'}},
 {file:'csrc/buffers/ep.hpp',from:460,to:469,names:{i:'combine两份可选bias输入编号，逐项校验shape/dtype并提取指针。'}},
 {file:H,from:1,to:456,names:{len:'SGE源内存片段的字节长度字段（byte），不是Python序列len。'}},
 {file:E,from:32,to:100,names:{i:'注释等价伪码中的expert ID输入元素索引，遍历num_i64_elems；真实SIMD实现以elem_offset向量块处理。',ptr:'histogram helper当前UB计数/输入指针，具体data/acc数组由原文参数定位。'}},
 {file:D,from:1,to:867,names:{handle:'设备通信handle命名空间，提供HcommJetty/PeerInfo及SQE/SGE常量接口；不是Python缓存路由EPHandle。'}},
 {file:H,from:1,to:456,names:{handle:'设备通信handle命名空间，此完整文件定义Jetty上下文与URMA队列操作。'}},
 {file:'deep_ep/buffers/ep.py',from:1,to:649,names:{handle:'Python EPHandle缓存路由对象，复用fresh的topk、目的slot、前缀和recv_src_metadata。'}},
 {file:D,from:125,to:130,names:{i:'清UB数组循环索引，遍历local token slot和SGE反查容量，以kNumThreads跨步。'}},
 {file:D,from:166,to:195,names:{i:'本AIV的源token局部序号，线程组按num_groups_per_wave跨步扫描路由。'}},
 {file:D,from:258,to:295,names:{i:'本AIV源token局部序号，本轮遍历为其top-k分配最终目的buffer槽。'}},
 {file:D,from:508,to:525,names:{i:'本地expert前缀分块编号，每块warpSize专家，累计前面aligned容量。'}},
 {file:D,from:530,to:547,names:{i:'来源rank前缀分块编号，每块warpSize来源rank，累计原count。'}},
 {file:D,from:775,to:780,names:{i:'metadata批内token位置，用于写source_rank×M+first_token+i的global_idx。'}},
 {file:D,from:810,to:838,names:{i:'本AIV逐条本机hidden复制的输入局部序号，目的槽来自local_copy_dst_slot_idx。'}},
 {file:E,from:21,to:30,names:{i:'fill_ubuf当前SIMD块循环索引，按vector的int元素容量前进。'}},
 {file:E,from:470,to:538,names:{j:'当前接收record的top-k位置；fresh用该位置expert判本地，cached直接用映射slot。'}},
 {file:'deep_ep/buffers/ep.py',from:474,to:551,names:{x:'combine输入expanded expert hidden或其tuple，输出按来源token还原。',num_tokens:'combine接口使用的行数/数量由当前输入与handle决定，非固定源T。'}},
 {file:'csrc/buffers/ep.hpp',from:394,to:608,names:{num_tokens:'combine输入hidden的本地expanded行数=x.size(0)，可大于M；M约束num_combined_tokens输出容量，不是此输入行数。',x:'combine输入：专家计算后的expanded hidden输出，不是dispatch原始源输入。',topk_weights:'combine可选的接收/专家输出权重，用于还原和累加。'}},
 {file:E,from:100,to:130,names:{dst_slot_idx:'initialize_dst_slot_idx中的每local expert下一输出槽数组，加上对齐expert起点；不是dispatch接收槽。'}},
 {file:D,from:173,to:195,names:{rank_histogram:'每AIV、每目的rank的去重token副本计数；本阶段atomic+1取旧计数作为核内slot。',expert_histogram:'每AIV按全局expert ID统计有效top-k命中数，尚未是远端接收local expert总数。'}},
 {file:D,from:239,to:295,names:{rank_histogram:'同名UB数组已复用为本AIV之前各核count的排他前缀；dst slot=该前缀+核内旧计数。'}},
 {file:D,from:472,to:526,names:{expert_histogram:'AIV0等待所有source rank汇总后保存的本地expert有效接收数，索引为本地expert；不再是本核源路由统计。',num_recv_tokens:'当前本地expert从远端归约信号提取的有效接收数量。',value:'当前local expert的原始有效count；前面expert使用aligned容量，当前expert只加raw count。',idx:'本地expert编号=i×warpSize+thread_idx，越界lane补0。',status:'远端expert归约packed状态：高位arrival应满足R、低位为有效命中数量。',ptr:'本段的归约/host signal指针，见当前调用getter的具体expert索引。'}},
 {file:D,from:527,to:547,names:{value:'当前来源rank的去重接收记录数，从UB rank_psum读取。',idx:'来源rank编号=i×warpSize+lane_idx。',psum:'当前来源rank包含式接收前缀，前块累计+warp内包含和。',inclusive_psum:'前面rank分块的原始count累计基数，不做expert对齐。'}},
 {file:E,from:1,to:30,names:{value:'fill_ubuf指定的整数填充值，broadcast到SIMD向量。',ptr:'fill_ubuf要填充的UB int数组起点，要求32字节对齐。'}},
 {file:E,from:131,to:175,names:{rank_idx:'PSumIterator当前接收流位置所属的来源rank，不是本设备rank。',token_idx:'当前接收流总序号，由rank包含前缀定位为来源分区slot。',psum:'来源rank的包含式接收前缀数组指针。',num_tokens:'迭代器要向前移动的接收流记录步数，与源输入T不同。'}},
 {file:E,from:181,to:623,names:{dst_slot_idx:'当前expert展开后的输出行号；从ub_next_dst_slot_idx取号或cached recv_src_metadata读取。单位是recv_x行，不是接收来源分区slot。',num_recv_tokens:'整个本rank去重接收记录数=来源rank包含前缀最后元素。',token_idx:'本处接收/清零循环中的记录索引，按当前for子句和token布局定位。',rank_idx:'本设备/当前接收目的rank编号，负责[first_expert_idx,first+E/R)专家。',metadata_ptr:'当前接收record的recv_src_metadata映射行，K个expanded slot+global_idx+master j。'}},
 {file:D,from:327,to:425,names:{sgep_idx:'此写字段lane对应的SQE内SGE pair位置，由header lane数及每pair lane数推导。',entry_idx:'从sgep_to_entry按physical SQE和pair lane反查的路由entry，-1表示该pair未用。',i:'当前warp遍历其[start_lsqe_idx,end_lsqe_idx)逻辑SQE范围的迭代编号。'}},
 {file:D,from:433,to:448,names:{i:'本warp负责的核内本机token索引，从warp_idx开始以kNumWarps跨步。',dst_slot_idx:'本token在本rank接收buffer中本来源分区的local copy槽；-1则不复制。'}},
 {file:D,from:134,to:156,names:{entry_idx:'cached有效输入范围的top-k展平entry，线程按kNumThreads跨步读取旧映射。',i:'cached初始化/恢复的循环索引，遍历相应UB映射数组。'}}
];
for(const [name,r]of Object.entries(sourceEvidence))if(glossary['src.'+name])glossary['src.'+name].sourceRef=ref(r.file,r.line);

add('private','private','本实现每AIV读取自己Jetty的SQ/CQ上下文，队列资源属于当前核；不是全rank共享同一SQ。',{sourceRef:ref(D,305),related:['Jetty','SQ']});
add('pair','pair','此处一对SGE：hidden与metadata两段源内存描述，不是两个token副本。',{sourceRef:ref(D,357),related:['SGEP','SGE']});
add('header','header','URMA SQE的请求头，包含操作码、远端地址/身份、SGE数量和顺序/完成标志；本代码48B。',{sourceRef:ref(D,357),related:['SQE']});
add('physical','physical','实际写入SQ的物理SQE槽位，由atomic取号决定；教学图选择合法顺序，真实并发不保证与logical序号一致。',{sourceRef:ref(D,339),related:['SQE']});
add('logical','logical','路由规划时按目的rank划分的核内逻辑SQE范围，用来构造SGE逆映射；实际写SQ时再分配physical位置。',{sourceRef:ref(D,204),related:['SQE']});
add('ring','ring','ring_doorbell的动作简写，通知通信引擎读取已提交队列工作；异步请求尚可能未完成。',{sourceRef:ref(D,857),related:['DB']});
add('sourceRank','sourceRank','来源rank编号，决定目的recv_buffer中的来源分区和global_idx的M步长。',{sourceRef:ref(D,779),aliases:['source_rank','来源rank','src'],related:['rank','M']});
for(const [name,key,def]of [['hiddenBytes','hiddenBytes','每token hidden字节大小'],['metadataBytes','metadataBytes','每token发送metadata字节大小'],['tokenBytes','tokenBytes','每完整接收record字节大小'],['regionBytes','regionBytes','每来源rank接收分区字节容量'],['sfPacks','sfPacks','每token SF pack元素数量']])add('config.'+name,name,def,{kind:'派生教学参数',sourceRef:ref(L,55),unit:name==='sfPacks'?'pack/token':'byte',related:['bytes']});

add('expert_end','expert_end','教学公式中的每local expert raw end，绑定psum_num_recv_tokens_per_expert[e]；前面expert用aligned容量，当前只加count。',{sourceRef:ref(D,519),related:['object.psum_num_recv_tokens_per_expert','A']});
add('expert_start','expert_start','教学公式中的local expert输出段起点：第一个为0，其余align(前一个raw end,A)。',{sourceRef:ref(E,264),related:['A','start']});
for(const [short,actual]of [['global_sgep','global_sgep_idx'],['lsqe_base','lsqe_base_idx'],['sgep','sgep_idx']])add('alias.'+short,short,'页面教学公式简写，源码对应'+actual+'：'+sourceDefinitions[actual],{sourceRef:ref(D,274),related:['src.'+actual]});
add('record','record','buffer中的连续token记录，包含hidden与metadata；按来源rank分区计数，后续按expert展开输出行。',{sourceRef:ref(L,14),aliases:['records'],related:['src.TokenLayout','metadata']});
add('count','count','当前字段统计的有效记录或expert命中数量，具体对象决定是否按rank去重；计数就绪不等于payload到达。',{sourceRef:ref(D,177)});
for(const [alias,base]of [['int32','int32_t'],['int64','int64_t'],['uint8','uint8_t'],['float32','float']])add('dtype.'+alias,alias,syntaxDefinitions[base],{kind:'元素类型',sourceRef:ref(L,14),related:['dtype']});
add('global','global','全局编号或地址空间，具体对象可为全局expert ID、来源token global_idx或核内全部逻辑SQE范围；不能把所有global都当token编号。',{sourceRef:ref(D,274)});
add('source','source','来源：在接收buffer容量公式中指来源rank分区，在数值推导中指操作数从哪个对象、元素路径及前置步骤读取；source-before-producer表示该来源尚未由生产步骤写入。具体SGE.source字段才表示传输源地址。',{sourceRef:ref(L,107),related:['sourceRank','M','field.source']});
add('raw pointers','raw pointers','直接访问Tensor底层存储的内存指针，可能绕过Tensor的版本/原地修改检查；不是expert未对齐计数。',{sourceRef:ref('deep_ep/buffers/ep.py',35)});
const aliasMap=new Map();
for(const [id,g]of Object.entries(glossary))if(!id.startsWith('syntax.')&&!id.startsWith('src.'))for(const label of g.aliases)aliasMap.set(label,id);
for(const name of Object.keys(sourceDefinitions))if(!aliasMap.has(name))aliasMap.set(name,'src.'+name);
add('gsge','gsge','页面简写，指dst_gsge_idx：核内逻辑SGE pair映射索引，不是地址或expanded输出槽。',{sourceRef:ref(D,282),related:['object.dst_gsge_idx','SGEP']});aliasMap.set('gsge','gsge');
add('field.bytes','bytes','当前SGE描述符的源内存片段字节长度；hidden和metadata的两SGE分别使用hiddenBytes和metadataBytes。',{sourceRef:ref(D,407),unit:'byte'});
// Exact object/field identities override generic words where a record supplies that context.
for(const id of Object.keys(glossary).filter(x=>x.startsWith('object.')))aliasMap.set(glossary[id].label,id);
const regexpEscape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');let aliasPattern;
function pattern(){return aliasPattern??=(new RegExp([...aliasMap.keys()].sort((a,b)=>b.length-a.length).map(regexpEscape).join('|'),'gu'));}
export function term(termId,label=glossary[termId]?.label,context={}){if(!glossary[termId])throw Error('Unregistered term '+termId);const q={termId,context};return `<span class="term" role="button" tabindex="0" data-term-id="${esc(termId)}" data-term-query="${esc(JSON.stringify(q))}" aria-label="${esc(label+'；查看变量或术语解释')}">${esc(label)}</span>`;}
export function termText(text,context={},reference=false){text=String(text);let out='',end=0;pattern().lastIndex=0;for(const m of text.matchAll(pattern())){const a=m.index,b=a+m[0].length;if(/[A-Za-z0-9_]/.test(m[0][0])&&a&&/[A-Za-z0-9_]/.test(text[a-1])&&!(m[0]==='B'&&/\d/.test(text[a-1]))||/[A-Za-z0-9_]/.test(m[0].at(-1))&&/[A-Za-z0-9_]/.test(text[b]||'')&&!(m[0]==='AIV'&&/\d/.test(text[b]||'')))continue;const id=resolveAlias(m[0],context);out+=esc(text.slice(end,a))+ (reference?`<button class="termReference" data-term-reference="${esc(id)}" data-term-context="${esc(JSON.stringify(context))}">${esc(m[0])}</button>`:term(id,m[0],context));end=b;}return out+esc(text.slice(end));}
function resolveAlias(label,c){if(label==='slot'||label==='槽'){if(c.objectId?.includes('.SQE')||c.surface==='source'&&c.file===D&&c.line>=384&&c.line<=426)return 'slot.sq';return ['expand','padding','done'].includes(c.stage)||c.objectId?.includes('.recv_x')?'slot.output':'slot.recv';}if(glossary['field.'+label]&&c.objectId&&Array.isArray(c.elementPath)&&c.elementPath.at(-1)===label)return 'field.'+label;return aliasMap.get(label);}
export function fieldTerm(objectId,path,key,context={}){const id=glossary['field.'+key]?'field.'+key:glossary['object.'+key]?'object.'+key:aliasMap.get(key);if(!id)throw Error('Unregistered nested field '+key);return term(id,key,{...context,objectId,elementPath:[...path,key],surface:'nested-field'});}
export function objectTerm(id,context={}){const match=/^R(\d+)\.([^[]+)(?:\[(.*)\])?$/.exec(id);if(!match||!glossary['object.'+match[2]])throw Error('Unregistered object '+id);return term('object.'+match[2],id,{...context,objectId:id,rank:+match[1],index:match[3],surface:'object-name'});}
export function bindTerms(root,context={}){const walker=document.createTreeWalker(root,NodeFilter.SHOW_TEXT),nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);for(const n of nodes){if(!n.textContent.trim()||n.parentElement.closest('[data-term-query],[data-num-query],.codeLine,option,script,style,#numericTooltip'))continue;const host=n.parentElement.closest('[data-cell]'),c={...context,...(host?{objectId:host.dataset.cell}:{})};const html=termText(n.textContent,c);if(html===esc(n.textContent))continue;const t=document.createElement('template');t.innerHTML=html;n.replaceWith(t.content);}}
export function explainTerm(m,q){const base=glossary[q.termId];if(!base)throw Error('Missing term definition '+q.termId);const c=q.context||{},x={...base,context:c,currentRole:base.role||base.definition,related:[...base.related]};if(configs[q.termId]){const v=m.config[q.termId];x.currentValue=v;x.valueQuery={objectId:'@config.'+q.termId,value:v,step:c.step??0,phase:'observe',elementPath:[]};x.currentRole=`当前预设 ${c.preset||''}：${q.termId}=${v}；${base.definition}。`;if(q.termId==='T')x.bounds=`0≤T≤M，当前 ${v}≤${m.config.M}；T=0仍保留M个容量槽。`;if(q.termId==='M')x.bounds=`M>0；有效输入T=${m.config.T}；接收分区shape=[R,M]，分区每rank ${v}条。`;if(q.termId==='A')x.bounds='要求2的幂；单位输出行，例如align(5,4)=ceil(5/4)×4=8，3行padding。';}
 if(q.termId==='bytes'&&c.objectId&&m.ledger[c.objectId]&&!c.elementPath){const l=m.ledger[c.objectId];x.currentRole=c.objectId+'在账本中的容量为'+l.bytes+'字节；与SQE内某条SGE的source片段长度字段不同。';x.currentValue=l.bytes;x.valueQuery={objectId:'@bytes',object:c.objectId,value:l.bytes,step:c.step??0,phase:'observe',elementPath:[]};}
 if(q.termId.startsWith('config.')){const k=q.termId.slice(7);x.currentValue=m.config[k];x.valueQuery={objectId:'@config.'+k,value:m.config[k],step:c.step??0,phase:'observe',elementPath:[]};x.currentRole=base.definition+'='+m.config[k]+'；推导见关联数字。';}
 if(q.termId==='SF'){x.currentRole=m.config.fp8?`当前FP8每token有 ${m.config.sfPacks} 个int16 pack，共 ${m.config.sfBytes}字节；原始位模式例如0x3c00=15360；未解码scale。`:'当前BF16预设sfPacks=0，不走可选SF搬运分支；“无SF”不是scale数值0。';x.related=['FP8','BF16','object.sf','object.recv_sf'];}
 if(q.termId.startsWith('object.')&&c.objectId&&m.ledger[c.objectId]?.obj===q.termId.slice(7)){const l=m.ledger[c.objectId];x.currentRole=`${c.objectId}：${l.owner}；${l.memory}；dtype=${l.dtype}；shape=${JSON.stringify(l.shape)}；容量${l.bytes}字节。${l.note}`;x.objectId=c.objectId;x.elementPath=c.elementPath||[];x.currentValue=m.frames[c.step??0]?.snapshot[c.objectId];x.unit=l.dtype;x.bounds=l.index!==undefined?`数组记录索引 ${l.index}，rank归属R${l.rank}`:`数组逻辑shape ${JSON.stringify(l.shape)}`;}
 if(c.objectId&&q.termId.startsWith('field.')){x.currentRole=`嵌套字段 ${c.objectId}${(c.elementPath||[]).map(k=>typeof k==='number'?'['+k+']':'.'+k).join('')}：${base.definition}`;const f=m.frames[c.step??0],phase=c.phase||'auto',record=phase==='write-before'?f.writes.find(w=>w.id===c.objectId)?.before:phase==='read-before'?f.reads.find(r=>r.id===c.objectId)?.value:f.snapshot[c.objectId];let v=record;for(const k of c.elementPath||[])v=v&&typeof v==='object'&&Object.hasOwn(v,k)?v[k]:v==='未写入'?v:undefined;x.currentValue=v;if(v!==undefined&&(typeof v!=='object'||v===null))x.valueQuery={objectId:c.objectId,elementPath:c.elementPath||[],step:c.step??0,phase};}
 if(c.objectId?.includes('.signals')&&q.termId==='field.arrival'){x.definition='signals.arrival是教学聚合到达状态字符串，例如未到/counts就绪；它不是一个真实reduction packed字段，也不能证明payload就绪。';x.currentRole=x.definition;x.sourceRef=ref(D,473);}
 if(c.memberOf==='threadIdx'&&q.termId==='object.x'||c.memberOf==='threadIdx'&&q.termId==='src.x'){x.definition='threadIdx.x为SIMT内建线程坐标的x分量，经static_cast得到thread_idx；不是token hidden数组x。';x.currentRole=x.definition;}
 if(c.file&&c.line&&c.surface!=='term-reference'){const n=c.identifier||base.label;let definition=q.termId.startsWith('src.')?sourceDefinitions[n]||base.definition:base.definition;let scopeWidth=Infinity;for(const o of sourceOverrides)if(o.file===c.file&&c.line>=o.from&&c.line<=o.to&&o.names[n]&&o.to-o.from<=scopeWidth){definition=o.names[n];scopeWidth=o.to-o.from;}if(n==='x'&&c.memberOf==='threadIdx')definition='threadIdx.x为SIMT内建线程编号坐标的x分量，不是token hidden输入数组。';x.definition=definition;x.currentRole=definition;x.sourceRef=ref(c.file,c.line,c.fn||'');x.sourceLine=c.sourceLine;if(n==='i'||n==='j')x.bounds=`本次出现的准确循环/使用语句：${c.sourceLine}`;}
 x.step=c.step??0;x.preset=c.preset;return x;}
export function sourceLine(file,line,text,context={},state={block:false,pythonTriple:null}){if(/^\s*#\s*include/.test(text)){const mt=/^(\s*#\s*)(include)(.*)$/.exec(text);return esc(mt[1])+term('syntax.include',mt[2],{...context,surface:'source',file,line,identifier:'include',sourceLine:text})+term('syntax.header',mt[3],{...context,surface:'source',file,line,identifier:'header',sourceLine:text});}let out='',i=0;const stringQuote=(quote,start)=>{let j=start+quote.length;while(j<text.length){if(text[j]==='\\'){j+=2;continue;}if(text.startsWith(quote,j)){j+=quote.length;break;}j++;}return j;};while(i<text.length){if(state.block){const e=text.indexOf('*/',i),end=e<0?text.length:e+2;out+=termText(text.slice(i,end),{...context,surface:'comment',file,line});i=end;if(e>=0)state.block=false;continue;}if(state.pythonTriple){const e=text.indexOf(state.pythonTriple,i),end=e<0?text.length:e+3;out+=termText(text.slice(i,end),{...context,surface:'docstring',file,line});i=end;if(e>=0)state.pythonTriple=null;continue;}if(text.startsWith('//',i)||file.endsWith('.py')&&text[i]==='#'){out+=termText(text.slice(i),{...context,surface:'comment',file,line});break;}if(text.startsWith('/*',i)){state.block=true;continue;}if(file.endsWith('.py')&&(text.startsWith('"""',i)||text.startsWith("'''",i))){const quote=text.slice(i,i+3),end=text.indexOf(quote,i+3);if(end<0){state.pythonTriple=quote;out+=termText(text.slice(i),{...context,surface:'docstring',file,line});break;}out+=termText(text.slice(i,end+3),{...context,surface:'docstring',file,line});i=end+3;continue;}if(text[i]==='"'||text[i]==="'"){const end=stringQuote(text[i],i);out+=termText(text.slice(i,end),{...context,surface:'string',file,line});i=end;continue;}if(!file.endsWith('.py')&&text[i]==='R'&&text[i+1]==='"'){out+=term('syntax.cppRaw','R',{...context,file,line,surface:'source',identifier:'R',sourceLine:text});i++;continue;}const literal=/^(?:0[xX][0-9a-fA-F]+(?:[uUlL]*)|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?(?:[fFuUlL]*))/.exec(text.slice(i));if(literal){out+=esc(literal[0]);i+=literal[0].length;continue;}if(file.endsWith('.py')&&/[furb]/i.test(text[i])&&(text[i+1]==="'"||text[i+1]==='"')){out+=esc(text[i]);i++;continue;}const mt=/^[A-Za-z_][A-Za-z0-9_]*/.exec(text.slice(i));if(mt){const name=mt[0],id=sourceId(file,line,name),member=/([A-Za-z_][A-Za-z0-9_]*)\.\s*$/.exec(text.slice(0,i)),c={...context,surface:'source',file,line,identifier:name,sourceLine:text,...(member?{memberOf:member[1]}:{})};out+=id?term(id,name,c):`<span class="unresolvedTerm" data-unresolved-term="${esc(name)}" data-source-file="${esc(file)}" data-source-line="${line}">${esc(name)}</span>`;i+=name.length;}else{out+=esc(text[i]);i++;}}return out;}
export function sourceId(file,line,name){if(syntaxDefinitions[name])return 'syntax.'+name;if(glossary['fn.'+name])return 'fn.'+name;if(sourceDefinitions[name])return 'src.'+name;if(glossary['object.'+name])return 'object.'+name;if(aliasMap.has(name))return aliasMap.get(name);return null;}
export function sourceFragment(file,start,end,lines,context={}){const state={block:false,pythonTriple:null};for(let line=1;line<start;line++)sourceLine(file,line,lines[line-1],context,state);return Array.from({length:end-start+1},(_,i)=>sourceLine(file,start+i,lines[start+i-1],context,state));}
export function registryReport(){return {terms:Object.keys(glossary).length,sourceDefinitions:Object.keys(sourceDefinitions).length,syntax:Object.keys(syntaxDefinitions).length,sourceOverrides:sourceOverrides.length};}
