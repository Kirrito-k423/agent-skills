/* 递归内存布局核心：不依赖 DOM，不执行源码字符串。 */
(function (scope, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (scope) scope.RecursiveMemory = api;
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const cache = new WeakMap();
  const owns = (object, name) => Object.prototype.hasOwnProperty.call(object, name);

  function uint(value, name) {
    if (typeof value !== 'bigint' || value < 0n) {
      throw new TypeError(name + ' 必须是非负 BigInt');
    }
    return value;
  }

  function object(node) {
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('内存节点必须是对象');
    }
    return node;
  }

  function checkNode(node, needsOffset) {
    object(node);
    if (typeof node.id !== 'string' || !node.id) throw new TypeError('node.id 必须是非空字符串');
    uint(node.bytes, node.id + '.bytes');
    if (needsOffset || owns(node, 'offset')) uint(node.offset, node.id + '.offset');
    if (owns(node, 'children') && !Array.isArray(node.children)) throw new TypeError(node.id + '.children 必须是数组');
    if (owns(node, 'childrenFactory') && typeof node.childrenFactory !== 'function') {
      throw new TypeError(node.id + '.childrenFactory 必须是函数');
    }
    if (owns(node, 'children') && owns(node, 'childrenFactory')) {
      throw new TypeError(node.id + ' 不能同时声明 children 与 childrenFactory');
    }
    return node;
  }

  /** 同一节点的工厂函数仅调用一次，包括抛出异常的情况。 */
  function childrenOf(node) {
    object(node);
    if (owns(node, 'children') && owns(node, 'childrenFactory')) {
      throw new TypeError('节点不能同时声明 children 与 childrenFactory');
    }
    if (owns(node, 'children')) {
      if (!Array.isArray(node.children)) throw new TypeError('children 必须是数组');
      return node.children;
    }
    if (!owns(node, 'childrenFactory')) return [];
    if (typeof node.childrenFactory !== 'function') throw new TypeError('childrenFactory 必须是函数');
    if (cache.has(node)) {
      const saved = cache.get(node);
      if (saved.error) throw saved.error;
      if (!saved.done) throw new Error('childrenFactory 出现递归求值');
      return saved.children;
    }
    const saved = { done: false, children: null, error: null };
    cache.set(node, saved);
    try {
      const children = node.childrenFactory();
      if (!Array.isArray(children)) throw new TypeError('childrenFactory 必须返回数组');
      saved.children = children;
      saved.done = true;
      return children;
    } catch (error) {
      saved.error = error instanceof Error ? error : new Error(String(error));
      throw saved.error;
    }
  }

  /** 子节点采用父区局部字节坐标，必须连续、精确地覆盖父区。 */
  function validateChildren(parent) {
    checkNode(parent, false);
    const children = childrenOf(parent);
    if (!owns(parent, 'children') && !owns(parent, 'childrenFactory')) return children;
    const ids = new Set();
    let end = 0n;
    for (const child of children) {
      checkNode(child, true);
      if (ids.has(child.id) || child.id === parent.id) throw new Error('节点 id 重复：' + child.id);
      ids.add(child.id);
      if (child.offset !== end) {
        throw new Error(parent.id + '：子节点 ' + child.id + ' 不连续，offset 为 ' + child.offset + '，应为 ' + end);
      }
      end += child.bytes;
      if (end > parent.bytes) throw new Error(parent.id + '：子节点超出父区容量');
    }
    if (end !== parent.bytes) throw new Error(parent.id + '：子区合计 ' + end + ' 不等于父区字节数 ' + parent.bytes);
    return children;
  }

  /**
   * 校验全部已物化分支。expandDepth: 1 还会展开根工厂函数；
   * expandDepth: 2 还会展开根的直接子节点，依此类推。
   * 未展开分支通过 deferred 报告，不视为整树验证完成；maxNodes 限制工作量。
   */
  function validateTree(root, options) {
    const { maxNodes = 10000, expandDepth = 0 } = options || {};
    if (!Number.isSafeInteger(maxNodes) || maxNodes < 1) throw new TypeError('maxNodes 必须是安全范围内的正整数');
    if (!Number.isSafeInteger(expandDepth) || expandDepth < 0) throw new TypeError('expandDepth 必须是安全范围内的非负整数');
    const stack = [{ node: root, depth: 0 }];
    const seen = new Set();
    const identities = new Set();
    let nodes = 0, leaves = 0, deferred = 0;
    while (stack.length) {
      const { node, depth } = stack.pop();
      if (++nodes > maxNodes) throw new Error('validateTree 超出 maxNodes 节点上限');
      checkNode(node, depth > 0);
      if (seen.has(node.id)) throw new Error('树内节点 id 重复：' + node.id);
      if (identities.has(node)) throw new Error('树内出现循环或复用同一节点对象');
      seen.add(node.id);
      identities.add(node);
      const lazy = owns(node, 'childrenFactory');
      if (lazy && !cache.has(node) && depth >= expandDepth) {
        deferred++;
        continue;
      }
      const children = validateChildren(node);
      if (nodes + stack.length + children.length > maxNodes) throw new Error('validateTree 超出 maxNodes 节点上限');
      if (!children.length) leaves++;
      for (let index = children.length - 1; index >= 0; index--) stack.push({ node: children[index], depth: depth + 1 });
    }
    return { nodes, leaves, deferred, complete: deferred === 0 };
  }

  // 先截取有效位再计算比例，避免把巨大 BigInt 直接转换为 Number。
  function ratio(numerator, denominator) {
    if (numerator === 0n) return 0;
    if (numerator === denominator) return 1;
    const ns = Math.max(0, numerator.toString(2).length - 53);
    const ds = Math.max(0, denominator.toString(2).length - 53);
    return (Number(numerator >> BigInt(ns)) / Number(denominator >> BigInt(ds))) * Math.pow(2, ns - ds);
  }

  /**
   * 按输入顺序二分的矩形树图。面积与字节数成比例，不人为设置最小面积。
   * 零字节项目使用零面积矩形。像素几何使用 Number，字节总数与分组判断保留 BigInt 精度。
   */
  function treemap(items, width, height) {
    if (!Array.isArray(items)) throw new TypeError('treemap 的 items 必须是数组');
    for (const [name, value] of [['width', width], ['height', height]]) {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) throw new TypeError(name + ' 必须是有限的非负数');
    }
    const ids = new Set();
    const output = items.map((item) => {
      object(item);
      if (typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('treemap 要求各节点 id 非空且唯一');
      ids.add(item.id);
      uint(item.bytes, item.id + '.bytes');
      return { id: item.id, bytes: item.bytes, x: 0, y: 0, w: 0, h: 0 };
    });
    const positive = output.filter(item => item.bytes > 0n);
    if (!positive.length) return output;
    const total = positive.reduce((sum, item) => sum + item.bytes, 0n);
    const stack = [{ items: positive, sum: total, x: 0, y: 0, w: width, h: height }];
    while (stack.length) {
      const rect = stack.pop();
      if (rect.items.length === 1) {
        Object.assign(rect.items[0], { x: rect.x, y: rect.y, w: rect.w, h: rect.h });
        continue;
      }
      let leftSum = 0n, split = 1, bestSum = 0n, bestDistance = null;
      for (let i = 1; i < rect.items.length; i++) {
        leftSum += rect.items[i - 1].bytes;
        const doubled = 2n * leftSum - rect.sum;
        const distance = doubled < 0n ? -doubled : doubled;
        if (bestDistance === null || distance < bestDistance) {
          bestDistance = distance;
          split = i;
          bestSum = leftSum;
        }
        if (doubled >= 0n) break;
      }
      const rightSum = rect.sum - bestSum;
      // 直接计算较小一侧，避免先计算「1 − 极小值」时因浮点相消而丢失末尾小块。
      const leftIsSmaller = bestSum <= rightSum;
      const fraction = ratio(leftIsSmaller ? bestSum : rightSum, rect.sum);
      const a = { items: rect.items.slice(0, split), sum: bestSum, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      const b = { items: rect.items.slice(split), sum: rect.sum - bestSum, x: rect.x, y: rect.y, w: rect.w, h: rect.h };
      if (rect.w >= rect.h) {
        const smallerWidth = rect.w * fraction;
        a.w = leftIsSmaller ? smallerWidth : rect.w - smallerWidth;
        b.x = rect.x + a.w;
        b.w = leftIsSmaller ? rect.w - smallerWidth : smallerWidth;
      } else {
        const smallerHeight = rect.h * fraction;
        a.h = leftIsSmaller ? smallerHeight : rect.h - smallerHeight;
        b.y = rect.y + a.h;
        b.h = leftIsSmaller ? rect.h - smallerHeight : smallerHeight;
      }
      stack.push(b, a);
    }
    return output;
  }

  const identifier = /^[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*$/u;
  const codeToken = /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|(?<![$\u200C\u200D_\p{ID_Continue}])[$_\p{ID_Start}][$\u200C\u200D_\p{ID_Continue}]*/gu;

  /** 返回纯文本片段而非 HTML；字符串和注释中的名字不视为变量访问。 */
  function highlightSegments(code, identifiers) {
    if (typeof code !== 'string') throw new TypeError('code 必须是字符串');
    if (!identifiers || typeof identifiers === 'string' || typeof identifiers[Symbol.iterator] !== 'function') {
      throw new TypeError('identifiers 必须是由标识符字符串组成的可迭代集合');
    }
    const selected = new Set(identifiers);
    for (const name of selected) {
      if (typeof name !== 'string' || !identifier.test(name)) throw new TypeError('标识符无效：' + String(name));
    }
    const segments = [];
    const append = (text, highlight) => {
      if (!text) return;
      const previous = segments[segments.length - 1];
      if (previous && previous.highlight === highlight) previous.text += text;
      else segments.push({ text, highlight });
    };
    const scanner = new RegExp(codeToken.source, codeToken.flags);
    let cursor = 0;
    for (const match of code.matchAll(scanner)) {
      if (!selected.has(match[0])) continue;
      append(code.slice(cursor, match.index), false);
      append(match[0], true);
      cursor = match.index + match[0].length;
    }
    append(code.slice(cursor), false);
    return segments;
  }

  /**
   * 惰性分组的固定步长序列。make(index) 接收相对重复根的 BigInt 全局索引，
   * 可以省略 id/label/offset/bytes；若提供 offset，必须等于 index * stride，
   * bytes 必须等于 stride。返回实例的 offset 将转换为其直接父组的局部坐标。
   * 每层最多 8 个子节点。范围分组仅是查看方式，不是额外申请。
   * 实例只缺省继承 evidence/codeNames/why，避免把父区矩阵、地址、token 标记
   * 或容量公式当作实例语义。make 未提供实例公式时，缺省解释为一份 stride。
   * 范围组只继承上述证据和 kind；地址以重复根的 address 加上 start * stride
   * 单独换算，元素下标必须整除 elementBytes。根节点保留原属性及原 offset。
   * 可用 rangeLabel 指明范围索引所对应的对象；缺省标题为「label · 子项」。
   */
  function repeatNode(configuration) {
    object(configuration);
    const { id, label = id, rangeLabel = label + ' · 子项', offset = 0n, count, stride, make, ...detail } = configuration;
    if (typeof id !== 'string' || !id) throw new TypeError('重复节点 id 必须是非空字符串');
    if (typeof label !== 'string') throw new TypeError('重复节点 label 必须是字符串');
    if (typeof rangeLabel !== 'string') throw new TypeError('重复节点 rangeLabel 必须是字符串');
    uint(offset, 'offset'); uint(count, 'count'); uint(stride, 'stride');
    if (count > 0n && stride === 0n) throw new TypeError('非空重复序列的 stride 必须为正数');
    if (typeof make !== 'function') throw new TypeError('重复节点的 make 必须是函数');
    if (owns(detail, 'children') || owns(detail, 'childrenFactory')) throw new TypeError('repeatNode 会自行生成子节点，不能传入 children 或 childrenFactory');

    const inherited = {};
    for (const name of ['evidence', 'codeNames', 'why']) {
      if (owns(detail, name)) inherited[name] = detail[name];
    }
    const rangeInherited = { ...inherited };
    if (owns(detail, 'kind')) rangeInherited.kind = detail.kind;

    function rangeAddress(start, nodeId) {
      if (detail.address === undefined || detail.address === null) return {};
      const source = object(detail.address);
      uint(source.byteOffset, 'address.byteOffset');
      if (source.terms !== undefined && !Array.isArray(source.terms)) throw new TypeError('address.terms 必须是数组');
      const extra = start * stride;
      const byteOffset = source.byteOffset + extra;
      const { elementIndex, ...address } = source;
      address.byteOffset = byteOffset;
      address.terms = [
        ...(source.terms || []).map(term => ({ ...term })),
        { label: '跳过范围起点前的实例', expression: 'rangeStart × stride', value: extra, unit: 'B', nodeId },
      ];
      if (source.elementBytes !== undefined) {
        uint(source.elementBytes, 'address.elementBytes');
        if (source.elementBytes === 0n) throw new TypeError('address.elementBytes 必须大于零');
        if (byteOffset % source.elementBytes !== 0n) throw new Error('范围组字节偏移不能整除 address.elementBytes，无法生成精确元素下标');
        address.elementIndex = byteOffset / source.elementBytes;
      }
      return { address };
    }

    function strideFormula(nodeId, nodeLabel, length) {
      return {
        id: nodeId + ':formula',
        label: nodeLabel + '容量',
        expression: length === 1n ? '1 × stride' : 'rangeCount × stride',
        substitution: length + ' × ' + stride + ' B',
        value: length * stride,
        unit: 'B',
        why: length === 1n ? '当前实例占一份固定步长；内部字段与留空由该实例的子节点解释。' : '当前范围包含 ' + length + ' 份实例，每份预留 ' + stride + ' B；范围只是父序列的一段切片。',
        count: length,
        stride,
      };
    }

    function group(start, length, localOffset, root) {
      const nodeId = root ? id : id + ':range:' + start + ':' + length;
      const nodeLabel = root ? label : rangeLabel + ' [' + start + ', ' + (start + length) + ')';
      return {
        ...(root ? detail : { ...rangeInherited, ...rangeAddress(start, nodeId) }),
        id: nodeId,
        label: nodeLabel,
        offset: localOffset,
        bytes: length * stride,
        rangeStart: start,
        rangeCount: length,
        stride,
        formula: root && detail.formula !== undefined ? detail.formula : strideFormula(nodeId, nodeLabel, length),
        childrenFactory() {
          if (length > 8n) {
            const left = length / 2n;
            return [group(start, left, 0n, false), group(start + left, length - left, left * stride, false)];
          }
          const children = [];
          for (let i = start; i < start + length; i++) {
            const supplied = object(make(i));
            if (owns(supplied, 'offset') && supplied.offset !== i * stride) throw new Error('make(' + i + ') 的 offset 必须相对重复根，等于 index * stride');
            if (owns(supplied, 'bytes') && supplied.bytes !== stride) throw new Error('make(' + i + ') 的 bytes 必须等于 stride');
            const itemId = supplied.id === undefined ? id + ':item:' + i : supplied.id;
            const itemLabel = supplied.label === undefined ? label + ' #' + i : supplied.label;
            children.push({
              ...inherited,
              ...supplied,
              id: itemId,
              label: itemLabel,
              offset: (i - start) * stride,
              bytes: stride,
              repeatIndex: i,
              formula: supplied.formula === undefined ? strideFormula(itemId, itemLabel, 1n) : supplied.formula,
            });
          }
          return children;
        },
      };
    }
    return group(0n, count, offset, true);
  }

  return Object.freeze({ childrenOf, validateChildren, validateTree, treemap, highlightSegments, repeatNode });
});
