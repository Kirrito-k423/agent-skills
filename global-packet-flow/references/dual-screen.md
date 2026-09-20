# 控制页与多个动画窗口的联动约定

## 页面分工

- `visual.html`：默认跟随控制页的场景，也可切成独立视图。全量发送与接收网图、连线动画、最小块位图；也可切换至 group/rank 完成度曲线、区间带宽和组成堆叠图。核、块、曲线和曲线上关键点可点击。
- `visual-flow.html` / `visual-flags.html` / `visual-packets.html` / `visual-curves.html` / `visual-bandwidth.html`：自包含的固定视图动画页，可重复打开。各窗口通过 URL 的 `view` 参数保存本地视图，刷新时优先采用该参数；`view=follow` 才跟随共享 `scene`。固定页切图不发送共享 scene 命令，不能改变其他页。
- `control.html`：播放与暂停、时间轴、速度、轮次、筛选、核与来源任务选择、slot 翻页、原始记录和完整说明；曲线视图含统计口径、group/rank 聚焦、完整关键节点表格与 CSV 导出。任何场景都不展示动画 Canvas、曲线或时序图。提供五个独立页入口，保留当前 session；页面可由用户拖到任意屏幕。场景标签选择操作/表格，并只驱动跟随窗口。
- 网图始终保留逐块位图，包括 ≤512 组合时的三层布局：网图、时序预览、slot×block 填充。独立位图页放大所选任务，含图例、计数、每格点击和翻页；控制页保持任务与块的文字证据。
- `index.html`：兼容旧入口，保留查询参数跳到控制页。两个实际页面互相提供入口，用户可将标签页拖到不同窗口和屏幕。

默认用同一个 localhost HTTP 服务、同一浏览器配置和相同 `session` 参数。不要混用 `localhost` 与 `127.0.0.1`、不同端口或浏览器配置。两页都内嵌数据，可单独预览；`file://` 不承诺联动，应显示清楚的 HTTP 打开提示。

## 共享状态与命令

`assets/sync.js` 提供同步传输：数据模型 SHA-256 和 session 一起构成命名空间。localStorage 保存唯一权威快照，Web Locks 将所有控制命令串行化；BroadcastChannel 和 storage 事件通知对端，周期读取用于恢复。没有两套各自累加时间的播放计数器。

状态包含 revision、launch、tick、at、playing、speed、group、sourceRank、destRank、rank、core、task、page、block。每个命令先在锁内读取最新快照，按共享时间锚点结算，再执行用户意图并递增 revision。不能把某页陈旧的完整快照覆盖回去。双击播放按两次顺序命令处理；两个控制页各改一项，不丢失另一项。

曲线扩展字段为 scene（flow/flags/curves）、curveAxis（dst/src）、curveGroup、curveRank。scene 是控制页及跟随窗口的视图，固定窗口使用自己的 windowView。旧快照缺少字段时采用曲线视图、接收 rank、全部 group/rank 默认值，不丢弃原播放位置。点击节点只改变共享时间；曲线聚焦与网图顶层筛选分别保留，界面明确曲线继承了哪些顶层筛选。

带宽扩展将 scene 增加 bandwidth，状态包含 bwAxis、bwGroup、bwRank、bwLocal、bwMode、bwWindow、bwPacketBytes、bwCycleUs、bwUnit、bwCapacity、bwFrom、bwTo。控制页承担参数输入、贡献表、说明和导出；动画页只保留曲线、当前区间、摘要与必要边界。相邻/固定窗口、B/包、μs/cycle、纵轴、参考上限与缩放范围双向共享。旧快照采用原始包/tick、未配置时钟、排除本机复制的默认值。

原子时序扩展 scene=packets，状态包含 packetAxis、packetRows、packetPage、packetFrom、packetTo、packetPairSrc、packetPairDst、packetPickFrom、packetPickTo、packetListPage。flow 模式在组合数 ≤512 时自动显示预览；网图只展示 sourceRank/destRank 指定对象。翻页命令携带发起窗口实际每页行数和已截断至有效范围的当前页，不借用控制页 scene 推断；预览与展开窗口可同时存在，页数不同时“上一页”也必须立即生效。点击原子包在同一串行命令中更新时间、核、task、slot/block，不能拆成两页各自解释的选择。控制页即使没有 Canvas，也必须更新重合包清单。

每一帧只根据 `tick + (当前时间 - at) × 速度 × 当前轮次总时长 / 展示总时长` 渲染，不写共享状态。浏览器墙钟只用于同一台电脑的展示进度，不是设备日志的全局时钟。暂停、拖动、变速先结算当前位置；后台恢复、新开和刷新均读取同一锚点。到末尾停止渲染，重新播放回到起点。

监听器先安装，再发送 hello；对端回复 presence。页面显示等待或已连接，关闭时通知，失联后超时标记。缺少 Web Locks、BroadcastChannel 或存储权限时明确降级为单页预览，不能显示“已联动”。

## 最少验收

1. 控制页设置进度、轮次、筛选、速度；动画页的时间、计数、选中块一致。动画页点核、点块后控制页反向更新。
2. 播放途中变速和暂停不跳回；倒退无未来块；第二个控制页不使播放速度翻倍。
3. 先开任一页、再开另一页；刷新或关闭重开接续当前状态。不同 session 互不干扰。
4. 检查全量概览和证据面板截图，以及浏览器脚本错误；记录实际浏览器与视口尺寸。数据守恒和时钟语义沿用数据契约，双屏改造不能改变事实。
5. 同时打开网图、到达位图和图表固定页，改变控制页场景时三者保持各自视图；选择跟随后仅该页切图，刷新保持模式。页面应报告控制页和动画页数量。
6. 控制页各场景没有可见 Canvas；任务选择和原子点定位后，所有位图同步到相同 task/slot/block。检查未观察、零、部分一、完整、已复制与倒退；≤512 组合下不能隐藏网图底部位图。
