'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const corePath = path.resolve(__dirname, '../assets/recursive-memory.js');
const R = require(corePath);
let checks = 0;
function test(name, run) {
  try { run(); checks++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}
const leaf = (id, offset, bytes) => ({ id, offset, bytes });

test('浏览器与 CommonJS 导出', () => {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(corePath, 'utf8'), context);
  assert.equal(typeof context.RecursiveMemory.treemap, 'function');
  assert.deepEqual(Object.keys(R).sort(), ['childrenOf', 'highlightSegments', 'repeatNode', 'treemap', 'validateChildren', 'validateTree'].sort());
});

test('惰性工厂函数仅调用一次，包含失败情形', () => {
  let calls = 0;
  const node = { id: 'root', bytes: 8n, childrenFactory() { calls++; return [leaf('a', 0n, 8n)]; } };
  assert.equal(R.childrenOf(node), R.childrenOf(node));
  R.validateChildren(node);
  assert.equal(calls, 1);
  let failures = 0;
  const bad = { childrenFactory() { failures++; throw new Error('工厂函数失败'); } };
  assert.throws(() => R.childrenOf(bad), /工厂函数失败/);
  assert.throws(() => R.childrenOf(bad), /工厂函数失败/);
  assert.equal(failures, 1);
  const cyclic = { childrenFactory() { return R.childrenOf(cyclic); } };
  assert.throws(() => R.childrenOf(cyclic), /递归/);
});

test('子区账本使用精确 BigInt 与父区局部 offset', () => {
  const huge = (1n << 110n) + 13n;
  const node = { id: 'root', offset: 999n, bytes: huge + 21n, children: [leaf('a', 0n, huge), leaf('b', huge, 21n)] };
  assert.equal(R.validateChildren(node)[1].offset, huge);
  assert.deepEqual(R.validateTree(node), { nodes: 3, leaves: 2, deferred: 0, complete: true });
  assert.deepEqual(R.validateChildren({ id: 'zero', bytes: 0n, children: [] }), []);
  assert.deepEqual(R.validateChildren(leaf('opaque', 0n, 10n)), []);
});

test('拒绝篡改账本与非法数据', () => {
  const cases = [
    { id: 'root', bytes: 8n, children: [leaf('a', 1n, 7n)] },
    { id: 'root', bytes: 8n, children: [leaf('a', 0n, 5n), leaf('b', 4n, 4n)] },
    { id: 'root', bytes: 8n, children: [leaf('a', 0n, 4n)] },
    { id: 'root', bytes: 8n, children: [leaf('a', 0n, 9n)] },
    { id: 'root', bytes: 8n, children: [leaf('a', 0n, 4n), leaf('a', 4n, 4n)] },
    { id: 'root', bytes: 8n, children: [leaf('root', 0n, 8n)] },
    { id: 'root', bytes: 8, children: [leaf('a', 0n, 8n)] },
    { id: 'root', bytes: 8n, children: [leaf('a', 0, 8n)] },
    { id: 'root', bytes: 8n, children: [leaf('a', 0n, -1n)] },
    { id: 'root', bytes: 8n, children: [] },
    { id: 'root', bytes: 0n, children: [], childrenFactory: () => [] },
    { id: 'root', bytes: 0n, childrenFactory: () => null },
  ];
  for (const node of cases) assert.throws(() => R.validateChildren(node));
  const duplicated = { id: 'root', bytes: 8n, children: [
    { id: 'left', offset: 0n, bytes: 4n, children: [leaf('duplicate', 0n, 4n)] },
    { id: 'right', offset: 4n, bytes: 4n, children: [leaf('duplicate', 0n, 4n)] },
  ] };
  assert.throws(() => R.validateTree(duplicated), /重复/);
  assert.throws(() => R.validateTree(leaf('r', 0n, 1n), { maxNodes: 0 }));
  assert.throws(() => R.validateTree(leaf('r', 0n, 1n), { expandDepth: -1 }));
});

test('验证不自动展开未物化的分支', () => {
  let calls = 0;
  const root = { id: 'root', bytes: 1n, childrenFactory() { calls++; return [leaf('a', 0n, 1n)]; } };
  assert.deepEqual(R.validateTree(root), { nodes: 1, leaves: 0, deferred: 1, complete: false });
  assert.equal(calls, 0);
  assert.deepEqual(R.validateTree(root, { expandDepth: 1 }), { nodes: 2, leaves: 1, deferred: 0, complete: true });
  assert.equal(calls, 1);
  assert.throws(() => R.validateTree(root, { maxNodes: 1 }), /maxNodes/);
});

function inspectGeometry(items, width, height) {
  const rectangles = R.treemap(items, width, height);
  const total = items.reduce((sum, item) => sum + item.bytes, 0n);
  const area = width * height;
  let actualArea = 0;
  const tolerance = Math.max(1e-7, area * 1e-11);
  for (const rect of rectangles) {
    assert.ok([rect.x, rect.y, rect.w, rect.h].every(Number.isFinite));
    assert.ok(rect.w >= 0 && rect.h >= 0 && rect.x >= 0 && rect.y >= 0);
    assert.ok(rect.x + rect.w <= width + 1e-9);
    assert.ok(rect.y + rect.h <= height + 1e-9);
    const fraction = total ? Number(rect.bytes * 1000000000000000n / total) / 1e15 : 0;
    assert.ok(Math.abs(rect.w * rect.h - fraction * area) < tolerance, rect.id + ' 的面积必须与字节数成比例');
    if (rect.bytes === 0n) assert.equal(rect.w * rect.h, 0);
    actualArea += rect.w * rect.h;
  }
  for (let i = 0; i < rectangles.length; i++) {
    for (let j = i + 1; j < rectangles.length; j++) {
      const a = rectangles[i], b = rectangles[j];
      const overlapX = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
      const overlapY = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
      assert.ok(overlapX * overlapY < tolerance, '矩形树图中的矩形出现重叠');
    }
  }
  assert.ok(Math.abs(actualArea - (total ? area : 0)) < tolerance, '面积必须守恒');
  return rectangles;
}

test('矩形树图的面积、边界、重叠、零字节与超大容量', () => {
  inspectGeometry([8n, 3n, 0n, 1n, 2n, 10n, 7n, 1n].map((bytes, i) => ({ id: 'r' + i, bytes })), 1173, 611);
  inspectGeometry(Array.from({ length: 67 }, (_, i) => ({ id: 'r' + i, bytes: BigInt((i * 37) % 131) })), 510, 933);
  inspectGeometry([2n ** 2100n, 2n ** 2099n, 2n ** 2098n].map((bytes, i) => ({ id: 'huge' + i, bytes })), 800, 400);
  inspectGeometry([{ id: 'zero', bytes: 0n }], 800, 400);
  inspectGeometry([{ id: 'only', bytes: 1n }], 0, 400);
  const tiny = R.treemap([{ id: 'small', bytes: 1n }, { id: 'large', bytes: 1000000n }], 1000, 1000);
  assert.ok(tiny[0].w * tiny[0].h < 1, '极小区域不能被放大为人为规定的最小面积');
  const finalTiny = R.treemap([{ id: 'large', bytes: 10n ** 24n }, { id: 'small', bytes: 1n }], 1000, 1000);
  assert.ok(finalTiny[1].w * finalTiny[1].h > 0, '末尾极小矩形不能因浮点相减而消失');
  assert.ok(Math.abs(finalTiny[1].w * finalTiny[1].h - 1e-18) < 1e-30);
  assert.deepEqual(R.treemap([], 10, 10), []);
  assert.throws(() => R.treemap([{ id: 'x', bytes: 1 }], 10, 10));
  assert.throws(() => R.treemap([{ id: 'x', bytes: 1n }, { id: 'x', bytes: 1n }], 10, 10));
  assert.throws(() => R.treemap([], Infinity, 10));
  assert.throws(() => R.treemap([], -1, 10));
});

test('仅高亮完整标识符，并保持原始源码文本', () => {
  const code = 'selfRankWinInGMTensor_[offset] = selfRankWinInGMTensor_extra + rscvStatusNum_ * STATE_OFFSET;\n' +
    'other_selfRankWinInGMTensor_ + 2selfRankWinInGMTensor_; // selfRankWinInGMTensor_\n' +
    '"rscvStatusNum_"; /* STATE_OFFSET */ stateBankBase + 值_;';
  const segments = R.highlightSegments(code, ['selfRankWinInGMTensor_', 'rscvStatusNum_', 'STATE_OFFSET', 'stateBankBase', '值_']);
  assert.equal(segments.map(segment => segment.text).join(''), code);
  assert.deepEqual(segments.filter(segment => segment.highlight).map(segment => segment.text), [
    'selfRankWinInGMTensor_', 'rscvStatusNum_', 'STATE_OFFSET', 'stateBankBase', '值_',
  ]);
  assert.deepEqual(R.highlightSegments('<script>alert(1)</script>', []), [{ text: '<script>alert(1)</script>', highlight: false }]);
  assert.deepEqual(R.highlightSegments('', []), []);
  assert.throws(() => R.highlightSegments('foo', ['foo + 1']), /标识符无效/);
  assert.throws(() => R.highlightSegments('foo', 'foo'));
});

function selectIndex(root, target) {
  let node = root, rootRelative = 0n, levels = 0;
  for (;;) {
    const children = R.validateChildren(node);
    assert.ok(children.length <= 8);
    levels++;
    const next = children.find(child => child.repeatIndex === target ||
      (child.rangeStart !== undefined && target >= child.rangeStart && target < child.rangeStart + child.rangeCount));
    assert.ok(next, '必须存在覆盖目标索引的子节点');
    rootRelative += next.offset;
    if (next.repeatIndex === target) return { node: next, offset: rootRelative, levels };
    node = next;
    assert.ok(levels < 3000, '展开路径必须结束');
  }
}

test('百万实例惰性展开有界，首中末坐标精确', () => {
  let made = 0;
  const root = R.repeatNode({ id: 'tokens', label: 'token', offset: 777n, count: 1000003n, stride: 512n,
    make(index) { made++; return { offset: index * 512n, bytes: 512n }; } });
  assert.equal(root.bytes, 512001536n);
  assert.equal(root.offset, 777n);
  assert.equal(made, 0);
  R.validateTree(root, { expandDepth: 2, maxNodes: 20 });
  assert.equal(made, 0);
  for (const index of [0n, 500001n, 1000002n]) {
    const selected = selectIndex(root, index);
    assert.equal(selected.offset, index * 512n);
    assert.equal(selected.node.repeatIndex, index);
    assert.ok(selected.levels < 30);
  }
  assert.ok(made <= 24, '仅创建选中范围分组内的实例');
  const report = R.validateTree(root, { maxNodes: 250 });
  assert.ok(report.nodes < 150);
  assert.ok(report.deferred > 0);
  assert.equal(report.complete, false);
});

test('任意深度 BigInt 重复序列与空序列', () => {
  const count = (1n << 150n) + 1n, stride = 33n;
  let made = 0;
  const root = R.repeatNode({ id: 'huge', count, stride, make(index) { made++; return { id: 'item:' + index }; } });
  const last = selectIndex(root, count - 1n);
  assert.equal(last.offset, (count - 1n) * stride);
  assert.equal(root.bytes, count * stride);
  assert.ok(last.levels >= 148);
  assert.ok(made <= 8);
  assert.ok(R.validateTree(root, { maxNodes: 500 }).nodes < 320);
  const empty = R.repeatNode({ id: 'empty', count: 0n, stride: 0n, make() { throw new Error('空序列不应调用 make'); } });
  assert.deepEqual(R.validateChildren(empty), []);
});

test('物化重复节点时拒绝篡改', () => {
  assert.throws(() => R.repeatNode({ id: 'bad', count: 10, stride: 1n, make: () => ({}) }));
  assert.throws(() => R.repeatNode({ id: 'bad', count: 1n, stride: 0n, make: () => ({}) }));
  const wrongOffset = R.repeatNode({ id: 'offset', count: 2n, stride: 4n, make: () => ({ offset: 0n }) });
  assert.throws(() => R.validateChildren(wrongOffset), /offset/);
  const wrongBytes = R.repeatNode({ id: 'bytes', count: 1n, stride: 4n, make: () => ({ bytes: 3n }) });
  assert.throws(() => R.validateChildren(wrongBytes), /bytes/);
  const duplicate = R.repeatNode({ id: 'duplicate', count: 2n, stride: 4n, make: () => ({ id: 'same' }) });
  assert.throws(() => R.validateChildren(duplicate), /重复/);
  const root = R.repeatNode({ id: 'mutated', count: 17n, stride: 4n, make: () => ({}) });
  R.childrenOf(root)[1].offset += 1n;
  assert.throws(() => R.validateChildren(root), /不连续/);
});

test('重复实例只继承证据元数据，范围和实例分别使用正确容量公式', () => {
  const parentFormula = { id: 'parent-formula', expression: 'count × stride', substitution: '17 × 32 B', value: 544n, unit: 'B', why: '完整矩阵预留' };
  const itemFormula = { id: 'item-formula', expression: '8 × sizeof(float)', substitution: '8 × 4 B', value: 32n, unit: 'B', why: '当前行字段' };
  const evidence = ['placement-source'], codeNames = ['selfRankWinInGMTensor_'];
  const root = R.repeatNode({ id: 'rows', count: 17n, stride: 32n,
    matrix: { rows: 17n, columns: 8n }, address: { baseId: 'parentBase', byteOffset: 0n, terms: [] }, token: true,
    arbitraryParentOnly: '父区专属', formula: parentFormula, evidence, codeNames, why: '行切片',
    make(index) {
      if (index === 0n) return { formula: itemFormula, address: { base: 'rowZeroBase' }, evidence: ['row-specific-source'], token: false };
      return {};
    },
  });
  assert.equal(root.formula, parentFormula);
  const groups = R.validateChildren(root);
  for (const group of groups) {
    assert.equal(group.formula.value, group.bytes);
    assert.equal(group.formula.count, group.rangeCount);
    assert.equal(group.formula.stride, 32n);
    assert.equal(group.formula.expression, 'rangeCount × stride');
    assert.notEqual(group.formula.id, parentFormula.id);
    for (const key of ['matrix', 'token', 'arbitraryParentOnly']) assert.equal(Object.hasOwn(group, key), false, key + ' 不应从重复根继承到范围组');
  }
  const first = selectIndex(root, 0n).node;
  assert.equal(first.formula, itemFormula);
  assert.deepEqual(first.evidence, ['row-specific-source']);
  assert.deepEqual(first.address, { base: 'rowZeroBase' });
  assert.equal(first.token, false);
  const last = selectIndex(root, 16n).node;
  for (const key of ['matrix', 'address', 'token', 'arbitraryParentOnly']) assert.equal(Object.hasOwn(last, key), false, key + ' 不应从父区继承');
  assert.equal(last.evidence, evidence);
  assert.equal(last.codeNames, codeNames);
  assert.equal(last.why, '行切片');
  assert.equal(last.formula.value, 32n);
  assert.equal(last.formula.count, 1n);
  assert.equal(last.formula.expression, '1 × stride');
  assert.notEqual(last.formula.id, parentFormula.id);
  R.validateTree(root, { maxNodes: 100 });
});

test('范围组保留原基址并精确累加全局范围起点，根 offset 与地址不变', () => {
  const rootOffset = 123456n, baseOffset = (1n << 90n) + 384n, stride = 48n;
  const address = { baseId: 'stateBankBase', byteOffset: baseOffset, elementBytes: 4n, elementIndex: baseOffset / 4n,
    terms: [{ label: '跳过前部空间', expression: '状态表 + 核间矩阵', value: baseOffset, unit: 'B', nodeId: 'state-prefix' }] };
  const root = R.repeatNode({ id: 'address-rows', label: '前缀和副本', offset: rootOffset, count: 1000003n, stride,
    address, matrix: { rows: 1000003n }, token: true, base: '父区坐标', kind: 'payload', make: () => ({}) });
  assert.equal(root.offset, rootOffset);
  assert.equal(root.address, address);
  for (const target of [0n, 500001n, 1000002n]) {
    let current = root, accumulated = 0n;
    for (;;) {
      const children = R.validateChildren(current);
      const next = children.find(child => child.repeatIndex === target ||
        (child.rangeStart !== undefined && target >= child.rangeStart && target < child.rangeStart + child.rangeCount));
      assert.ok(next);
      accumulated += next.offset;
      if (next.repeatIndex !== undefined) {
        assert.equal(accumulated, target * stride);
        assert.equal(Object.hasOwn(next, 'address'), false);
        break;
      }
      const range = next.address;
      assert.equal(range.baseId, address.baseId);
      assert.equal(range.byteOffset, baseOffset + next.rangeStart * stride);
      assert.equal(range.byteOffset, baseOffset + accumulated);
      assert.equal(range.elementIndex * range.elementBytes, range.byteOffset);
      assert.equal(range.terms.reduce((sum, term) => sum + term.value, 0n), range.byteOffset);
      assert.equal(range.terms.length, address.terms.length + 1);
      assert.equal(range.terms.at(-1).nodeId, next.id);
      assert.notEqual(range, address);
      assert.notEqual(range.terms, address.terms);
      assert.notEqual(range.terms[0], address.terms[0]);
      for (const key of ['matrix', 'token', 'base']) assert.equal(Object.hasOwn(next, key), false, key + ' 不应作为范围组元数据继承');
      assert.equal(next.kind, 'payload');
      current = next;
    }
  }
  assert.equal(root.offset, rootOffset);
  assert.equal(address.byteOffset, baseOffset);
  assert.equal(address.terms.length, 1);
  assert.equal(address.elementIndex, baseOffset / 4n);
  const unaligned = R.repeatNode({ id: 'unaligned', count: 19n, stride: 6n,
    address: { baseId: 'base', byteOffset: 0n, elementBytes: 4n, elementIndex: 0n, terms: [] }, make: () => ({}) });
  assert.throws(() => R.validateChildren(unaligned), /不能整除/);
});

test('范围标题区分重复根与实际索引对象，支持缺省和自定义名称', () => {
  const options = { id: 'token', label: '本地 token [0]', count: 30n, stride: 512n, make: () => ({}) };
  const custom = R.repeatNode({ ...options, rangeLabel: '物理 block 范围' });
  assert.equal(custom.label, '本地 token [0]');
  const customGroups = R.validateChildren(custom);
  assert.deepEqual(customGroups.map(node => node.label), ['物理 block 范围 [0, 15)', '物理 block 范围 [15, 30)']);
  assert.deepEqual(R.validateChildren(customGroups[1]).map(node => node.label), ['物理 block 范围 [15, 22)', '物理 block 范围 [22, 30)']);
  const defaults = R.repeatNode(options);
  assert.equal(defaults.label, '本地 token [0]');
  assert.equal(R.validateChildren(defaults)[1].label, '本地 token [0] · 子项 [15, 30)');
  const defaultId = R.repeatNode({ id: 'items', count: 9n, stride: 1n, make: () => ({}) });
  assert.equal(defaultId.label, 'items');
  assert.equal(R.validateChildren(defaultId)[0].label, 'items · 子项 [0, 4)');
  for (const rangeLabel of [null, 1, 1n, {}, [], false]) {
    assert.throws(() => R.repeatNode({ ...options, rangeLabel }), /rangeLabel 必须是字符串/);
  }
});

console.log('通过：' + checks + ' 组递归内存核心测试（BigInt 账本与篡改反例、面积比例与不重叠、完整变量名高亮、百万记录有界懒展开、超安全整数首末坐标、父子元数据与公式隔离、范围组基址换算、范围索引标题）。');
