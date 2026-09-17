/* 可运行的小型教学模型。示例源码为完整合成C++函数，不代表任何目标算子。 */
(function(){
const proof={id:'example',file:'教学示例（合成代码，非目标仓库）',start:1,end:9,fn:'allocate_records',role:'完整教学例子',code:'constexpr size_t stride = 32;\nconstexpr size_t fields = 12;\nsize_t bytes = count * stride;\nuint8_t* records = static_cast<uint8_t*>(malloc(bytes));\nfor (size_t i = 0; i < count; ++i) {\n    int32_t* record = reinterpret_cast<int32_t*>(records + i * stride);\n    record[0] = i; record[1] = 1; record[2] = 2;\n}\nfree(records);',highlights:['records','record']};
const formula=(expression,value,substitution,why)=>({expression,value,substitution,why,unit:'B'});
globalThis.MemoryCase={title:'递归内存设计 · 可适配教学模板',parameters:[{id:'N',label:'记录数',codeName:'count',value:'2',min:1,max:1000000}],presets:[{label:'2条记录',values:{N:'2'}},{label:'百万条记录',values:{N:'1000000'}}],build(raw){if(!/^\d{1,8}$/.test(raw.N)||BigInt(raw.N)<1n||BigInt(raw.N)>1000000n)throw Error('记录数需为1到1000000之间的整数');const count=BigInt(raw.N);const root=RecursiveMemory.repeatNode({id:'records',label:'记录allocation',offset:0n,count,stride:32n,formula:formula('count × stride',count*32n,count+' × 32','每条记录保留32 B。'),why:'这是明确标注的合成教学代码。正式产物应替换模型、证据与叙述。',codeNames:['records'],evidence:[proof],make(i){return{id:'records/r'+i,label:'record ['+i+']',offset:i*32n,bytes:32n,kind:'group',formula:formula('stride',32n,'32','每条记录由12 B字段与20 B留空组成。'),why:'int32 record视图借用records父allocation。',codeNames:['record'],evidence:[proof],children:[{id:'records/r'+i+'/fields',label:'三个int32字段',offset:0n,bytes:12n,kind:'group',formula:formula('3 × sizeof(int32_t)',12n,'3 × 4','三个4 B整数。'),why:'继续进入具体字段。',evidence:[proof],codeNames:['record'],children:[0n,1n,2n].map(j=>({id:'records/r'+i+'/f'+j,label:'record['+j+']',offset:j*4n,bytes:4n,kind:'field',formula:formula('sizeof(int32_t)',4n,'4','一个int32字段。'),why:'对应代码第7行的record['+j+']。',evidence:[{...proof,start:7,end:7,code:'record['+j+'] = '+(j===0n?'i':j)+';',highlights:['record']}],codeNames:['record']}))},{id:'records/r'+i+'/padding',label:'记录尾部留空',offset:12n,bytes:20n,kind:'padding',formula:formula('stride − 3×4',20n,'32 − 12','间距扣除已定义字段。'),why:'没有独立变量，也没有赋值语句；由stride与字段末尾推导。',codeNames:['stride','fields'],evidence:[{...proof,start:1,end:2,code:'constexpr size_t stride = 32;\nconstexpr size_t fields = 12;',highlights:['stride','fields']}]}]};}});return{root,title:this.title,subtitle:'左：树表与真面积矩形；右：每层推导和源码',notes:['模板为合成教学模型；适配时替换实际申请、切片、消费者及证据，不可将该示例当目标算子。'],shortcuts:[{id:'records',label:'整个allocation'}],allocationFlow:[{id:'records',label:'申请',detail:'malloc(count × 32)'},{label:'填字段',detail:'record[i]',evidence:[proof]},{label:'释放',detail:'free(records)',evidence:[proof]}]};}};
})();
/* 教学模型也示范逐层叙述；这里只解释合成代码明确做出的分配、赋值和释放。 */
(function(){
 const Case=globalThis.MemoryCase,originalBuild=Case.build;
 Case.build=function(raw){return {...originalBuild.call(this,raw),values:{count:BigInt(raw.N)}};};
 Case.explainSpace=function(n,d){
  const count=d.count,range=n.id.match(/:range:(\d+):(\d+)$/),record=n.id.match(/\/r(\d+)/),field=n.id.match(/\/f(\d+)$/),padding=n.id.endsWith('/padding'),fields=n.id.endsWith('/fields');
  const i=record?BigInt(record[1]):range?BigInt(range[1]):0n;
  const amount=range?BigInt(range[2]):record?1n:count;
  const proof=Case.build({N:'1'}).root.evidence[0];
  const kind=padding?'留空段':field?'单个字段':fields?'字段组':record?'一条记录':range?'记录索引范围':'记录父申请';
  const lifecycle=[{phase:'建立地址',actor:'allocate_records',condition:'malloc 返回可用地址后，进入 i<count 的循环。',action:'用 records+i×32 定位记录，再转为 int32_t*。这里的32是教学代码选定的记录步长，不是int32_t的最低硬件对齐要求。',evidence:[proof]}];
  if(!padding)lifecycle.push({phase:'写入',actor:'循环内的赋值语句',condition:field?'循环走到记录 i='+i+' 时。':'循环逐条走过当前索引范围时。',action:field?'record['+field[1]+'] 写入 '+(field[1]==='0'?'当前记录编号 i='+i:field[1])+'。':'每条记录的前三个 int32_t 分别保存 i、1、2，当前示例没有后续业务消费者。',evidence:[proof]});
  lifecycle.push({phase:'释放与未知消费',actor:'allocate_records',condition:'赋值循环结束后。',action:'示例直接 free(records)，没有读取字段、轮询ready或复用记录的代码；这些行为不能从空间形状推断。',evidence:[Case.build({N:'1'}).root.evidence[0]]});
  return {
   purpose:[kind+'属于同一个 records allocation，不会另行申请。'+(padding?'这20 B没有字段赋值，只用于保持相邻记录相隔32 B。':field?'它对应一个独立4 B赋值位置，而不是整条32 B记录。':fields?'它把3个4 B赋值位置组合为连续12 B有效字段区。':'它将重复的32 B记录按索引组织，便于解释容量与相邻起点。'), '这是教学用的合成函数，并没有提供真实业务场景。必要性只对当前记录布局成立：删减某段必须一起修改步长或字段下标，不能宣称这些字节具有未展示的通信作用。'],
   formulaSteps:[{label:'当前空间的容量',expression:n.formula.expression,substitution:n.formula.substitution+' = '+n.bytes+' B',reason:padding?'32 B记录扣去3×4 B字段，剩下20 B。剩余不是额外字段，也没有被初始化。':field?'字段宽度来自 int32_t，每个下标前进4 B。':fields?'3个赋值位置各占4 B，因此连续覆盖12 B。':'当前范围有'+amount+'条记录，每条按32 B stride计入容量；重复数量不等于有效字段数。'},{label:'定位这份空间',expression:'记录起点 = i×32；字段偏移 = j×4',substitution:'i='+i+'，记录起点 '+i*32n+' B；本节点局部偏移 '+n.offset+' B',reason:'相对allocation的记录起点与相对父空间的局部偏移是两个坐标。索引范围只是查看窗口，不是再次分配。'}],
   necessity:[padding?'若想移除20 B留空，可将stride改为12并同步所有寻址；本示例没有证据证明32 B不可改变。':field?'删去该字段必须同时删除或调整对应赋值及依赖它的接口；本合成函数没有展示消费者，所以不能推断业务后果。':'当前地址公式依赖固定32 B步长。更紧凑的布局可以设计，但必须改动malloc容量与循环寻址，不能只缩小图上面积。'],lifecycle,
   example:['当前count='+count+'，父申请 '+count+'×32='+count*32n+' B。所选'+kind+'占 '+n.bytes+' B，首个相关记录编号为 '+i+'。'],
   boundaries:['没有独立业务读取、发布协议、清零或并发同步的证据。malloc返回值检查也未包含在教学片段中；不要直接用此合成代码作为生产实现。'],related:record?[{id:'records',label:'回到父申请'}]:[]
  };
 };
})();
