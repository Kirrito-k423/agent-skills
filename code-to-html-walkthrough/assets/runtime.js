(() => {
  "use strict";

  const payloadNode = document.getElementById("walkthrough-data");
  const payload = JSON.parse(payloadNode.textContent);
  const analysis = payload.analysis;
  const lines = payload.lines;
  const modules = analysis.modules;
  const functions = analysis.functions;
  const symbols = analysis.symbols || [];
  const memoryModel = analysis.memory_model || null;
  const memoryRegions = memoryModel?.regions || [];
  const memoryTransfers = memoryModel?.transfers || [];
  const memoryPaths = memoryModel?.paths || [];
  const memoryAllocations = memoryModel?.allocations || [];
  const resourceBudget = memoryModel?.resource_budget || null;
  const memoryReview = memoryModel?.review || null;
  const symbolMap = new Map(symbols.map((item) => [item.name, item]));
  const functionMap = new Map(functions.map((item) => [item.id, item]));
  const moduleMap = new Map(modules.map((item) => [item.id, item]));
  const memorySpaceMap = new Map((memoryModel?.spaces || []).map((item) => [item.id, item]));
  const memoryRegionMap = new Map(memoryRegions.map((item) => [item.id, item]));
  const memoryTransferMap = new Map(memoryTransfers.map((item) => [item.id, item]));
  const memoryPathMap = new Map(memoryPaths.map((item) => [item.id, item]));
  const declaredPrimaryPath = Array.isArray(analysis.primary_path)
    ? analysis.primary_path.filter((moduleId) => moduleMap.has(moduleId) && !moduleMap.get(moduleId).inactive)
    : [];
  const primaryPath = declaredPrimaryPath.length >= 2
    ? declaredPrimaryPath
    : modules.filter((item) => !item.inactive).map((item) => item.id);
  const primaryPathSet = new Set(primaryPath);
  const orderedModules = [
    ...primaryPath.map((moduleId) => moduleMap.get(moduleId)),
    ...modules.filter((item) => !primaryPathSet.has(item.id) && !item.inactive),
    ...modules.filter((item) => !primaryPathSet.has(item.id) && item.inactive),
  ];
  const moduleNumberMap = new Map(orderedModules.map((item, index) => [item.id, index + 1]));
  const lineNoteMap = new Map();
  for (const fn of functions) {
    for (const note of fn.line_notes || []) lineNoteMap.set(note.line, { ...note, functionId: fn.id });
  }
  const keywords = new Set([
    "alignas", "auto", "bool", "break", "case", "catch", "char", "class", "const", "constexpr",
    "continue", "default", "delete", "do", "double", "else", "enum", "explicit", "extern", "false",
    "float", "for", "friend", "if", "inline", "int", "long", "namespace", "new", "noexcept", "nullptr",
    "operator", "private", "protected", "public", "register", "reinterpret_cast", "return", "short", "signed",
    "sizeof", "static", "static_cast", "struct", "switch", "template", "this", "throw", "true", "try",
    "typedef", "typename", "union", "unsigned", "using", "virtual", "void", "volatile", "while"
  ]);

  const entryFunction = functions.find((item) => /^(Process|main)$/i.test(item.name)) || functions[0];
  const state = {
    moduleId: entryFunction.module_id,
    functionId: entryFunction.id,
    segmentId: entryFunction.segments[0]?.id || null,
    activeLine: entryFunction.start,
    drawerOpen: false,
    search: "",
    searchMatches: [],
    matchesByLine: new Map(),
    searchIndex: -1,
    e2eZoom: .78,
    graphInfoPinned: null,
    functionHistory: [],
    pendingHistoryRestore: false,
    workspaceView: memoryModel ? "memory" : "logic",
    memoryPathId: memoryPaths[0]?.id || null,
    transferId: memoryPaths[0]?.transfer_ids?.[0] || memoryTransfers[0]?.id || null,
    layout: {
      leftRatio: .30,
      middleRatio: .31,
      memoryRatio: .61,
      functionTopRatio: memoryModel ? .52 : .38,
    },
  };

  const esc = (value) => String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="shell ${payload.draftMode ? "draft-mode" : ""}">
      <header class="topbar ${memoryModel ? "has-workspace-tabs" : ""}">
        <div class="title-block">
          <p class="eyebrow">完整源码 · ${memoryModel ? "双模式联动" : "三轨联动"} · ${esc(analysis.language)}
            ${payload.draftMode
              ? '<span class="review-badge review-pending">函数复查未完成</span>'
              : `<span class="review-badge review-pass">独立复查 ${analysis.review_summary?.reviewed_count || functions.length}/${analysis.review_summary?.inventory_count || functions.length} PASS</span>`}
          </p>
          <h1 title="${esc(payload.sourcePath)}">${esc(analysis.title)} · ${esc(payload.sourceName)}</h1>
        </div>
        ${memoryModel ? `<div class="workspace-view-tabs" role="tablist" aria-label="切换代码逻辑与内存通信阅读模式">
          <button type="button" role="tab" data-workspace-view="memory">内存与通信</button>
          <button type="button" role="tab" data-workspace-view="logic">代码逻辑</button>
        </div>` : ""}
        <label class="search-box" aria-label="搜索全部源码">
          <span class="search-icon">⌕</span>
          <input id="source-search" type="search" autocomplete="off" spellcheck="false" placeholder="搜索全部源码" />
          <output id="search-count" class="search-count">0 / 0 · 0 行</output>
          <button id="search-prev" class="icon-button" type="button" title="上一处（Shift+Enter）" disabled>↑</button>
          <button id="search-next" class="icon-button" type="button" title="下一处（Enter）" disabled>↓</button>
        </label>
        <div class="topbar-actions">
          <button id="layout-reset" class="layout-reset" type="button" title="恢复当前阅读模式的默认布局比例">重置布局</button>
          <button id="drawer-toggle" class="drawer-toggle" type="button">图例与 Tips</button>
        </div>
      </header>
      <section class="tracks">
        <article class="track" data-track="e2e">
          <header class="track-head">
            <div>
              <h2 class="track-title"><span class="track-index">1</span>E2E 执行 DAG</h2>
              <p class="track-subtitle">编号与源码范围 · 居中关键路径 · 支持缩放</p>
            </div>
            <span id="module-stat" class="track-stat"></span>
          </header>
          <div id="e2e-body" class="track-body"></div>
        </article>
        <div class="column-resizer" data-column-resizer="left-middle" role="separator" tabindex="0" aria-label="调整 E2E 与函数列宽度" aria-orientation="vertical" aria-valuemin="20" aria-valuemax="60" title="拖拽调整左右宽度；方向键微调；双击重置"></div>
        <article class="track" data-track="function">
          <header class="track-head">
            <div>
              <h2 id="workspace-track-title" class="track-title"><span class="track-index" data-workspace-index>2</span><span data-workspace-title>函数逻辑</span></h2>
              <p id="workspace-track-subtitle" class="track-subtitle">上：函数调用 DAG · 下：当前函数逐段理解</p>
            </div>
            <span id="function-stat" class="track-stat"></span>
          </header>
          <div id="function-body" class="track-body function-body"></div>
        </article>
        <div class="column-resizer" data-column-resizer="middle-code" role="separator" tabindex="0" aria-label="调整函数与源码列宽度" aria-orientation="vertical" aria-valuemin="20" aria-valuemax="60" title="拖拽调整左右宽度；方向键微调；双击重置"></div>
        <article class="track code-track" data-track="code">
          <header class="track-head">
            <div>
              <h2 class="track-title"><span class="track-index" data-code-index>3</span>完整源码</h2>
              <p class="track-subtitle">悬浮行首 ↩ 可反向定位；F3 切换搜索结果</p>
            </div>
            <div>
              <div id="coverage-stat" class="track-stat"></div>
              <div class="code-legend">
                <span class="legend-dot" style="--legend:var(--amber-bg)">输入</span>
                <span class="legend-dot" style="--legend:var(--blue-bg)">输出</span>
                <span class="legend-dot" style="--legend:var(--purple-bg)">API</span>
                ${memoryModel ? '<span class="legend-dot" style="--legend:#dff7ed">当前搬运</span>' : ""}
              </div>
            </div>
          </header>
          <div class="track-body code-body"><div id="code-scroll" class="code-scroll"><div id="code-table" class="code-table"></div></div></div>
        </article>
      </section>
    </div>
    <aside id="graph-node-popover" class="graph-node-popover" role="tooltip" aria-hidden="true"></aside>
    <div id="drawer-backdrop" class="drawer-backdrop" aria-hidden="true"><aside id="drawer" class="drawer"></aside></div>
  `;

  const e2eBody = document.getElementById("e2e-body");
  const functionBody = document.getElementById("function-body");
  const tracks = app.querySelector(".tracks");
  const codeTable = document.getElementById("code-table");
  const searchInput = document.getElementById("source-search");
  const searchCount = document.getElementById("search-count");
  const searchPrev = document.getElementById("search-prev");
  const searchNext = document.getElementById("search-next");
  const graphNodePopover = document.getElementById("graph-node-popover");
  const drawerBackdrop = document.getElementById("drawer-backdrop");
  const drawer = document.getElementById("drawer");
  let graphInfoAnchor = null;
  let graphInfoFrame = 0;
  let resizeSession = null;
  let layoutFrame = 0;

  const layoutLimits = {
    left: 240,
    middle: 300,
    code: 420,
    functionTop: 150,
    functionBottom: 180,
    splitter: 8,
  };
  const defaultLayout = { leftRatio: .30, middleRatio: .31, memoryRatio: .61, functionTopRatio: .38 };
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  function applyWorkspaceMode() {
    const memoryMode = state.workspaceView === "memory" && memoryModel;
    const leftTrack = tracks.querySelector('[data-track="e2e"]');
    const leftSeparator = tracks.querySelector('[data-column-resizer="left-middle"]');
    leftTrack.hidden = Boolean(memoryMode);
    leftSeparator.hidden = Boolean(memoryMode);
    tracks.classList.toggle("memory-workspace-mode", Boolean(memoryMode));
    functionBody.classList.toggle("memory-workspace-body", Boolean(memoryMode));
    document.querySelector("[data-workspace-title]").textContent = memoryMode ? "内存申请、容量与通信流" : "函数逻辑";
    document.querySelector("[data-workspace-index]").textContent = memoryMode ? "1" : "2";
    document.querySelector("[data-code-index]").textContent = memoryMode ? "2" : "3";
    document.getElementById("workspace-track-subtitle").textContent = memoryMode
      ? "大块申请与峰值预算 · 空间切片 · 关键传输路径 · 点击定位源码"
      : "上：函数调用 DAG · 下：当前函数逐段理解";
    document.querySelectorAll("[data-workspace-view]").forEach((button) => {
      const active = button.dataset.workspaceView === state.workspaceView;
      button.classList.toggle("active", active);
      button.setAttribute("aria-selected", String(active));
    });
  }

  function applyLayout() {
    applyWorkspaceMode();
    if (state.workspaceView === "memory" && memoryModel) {
      const availableWidth = Math.max(1, tracks.clientWidth - layoutLimits.splitter);
      const workspaceWidth = clamp(
        availableWidth * state.layout.memoryRatio,
        layoutLimits.left + layoutLimits.middle,
        availableWidth - layoutLimits.code,
      );
      state.layout.memoryRatio = workspaceWidth / availableWidth;
      tracks.style.gridTemplateColumns = `${Math.round(workspaceWidth)}px ${layoutLimits.splitter}px minmax(${layoutLimits.code}px, 1fr)`;
      const rightSeparator = tracks.querySelector('[data-column-resizer="middle-code"]');
      rightSeparator?.setAttribute("aria-valuenow", String(Math.round(state.layout.memoryRatio * 100)));
      return;
    }
    const availableWidth = Math.max(1, tracks.clientWidth - layoutLimits.splitter * 2);
    let leftWidth = clamp(
      availableWidth * state.layout.leftRatio,
      layoutLimits.left,
      availableWidth - layoutLimits.middle - layoutLimits.code,
    );
    let middleWidth = clamp(
      availableWidth * state.layout.middleRatio,
      layoutLimits.middle,
      availableWidth - leftWidth - layoutLimits.code,
    );
    if (availableWidth - leftWidth - middleWidth < layoutLimits.code) {
      middleWidth = Math.max(layoutLimits.middle, availableWidth - leftWidth - layoutLimits.code);
    }
    state.layout.leftRatio = leftWidth / availableWidth;
    state.layout.middleRatio = middleWidth / availableWidth;
    tracks.style.gridTemplateColumns = `${Math.round(leftWidth)}px ${layoutLimits.splitter}px ${Math.round(middleWidth)}px ${layoutLimits.splitter}px minmax(${layoutLimits.code}px, 1fr)`;

    const availableHeight = Math.max(1, functionBody.clientHeight - layoutLimits.splitter);
    const topHeight = clamp(
      availableHeight * state.layout.functionTopRatio,
      layoutLimits.functionTop,
      Math.max(layoutLimits.functionTop, availableHeight - layoutLimits.functionBottom),
    );
    state.layout.functionTopRatio = topHeight / availableHeight;
    functionBody.style.setProperty("--function-top-height", `${Math.round(topHeight)}px`);

    const leftSeparator = tracks.querySelector('[data-column-resizer="left-middle"]');
    const rightSeparator = tracks.querySelector('[data-column-resizer="middle-code"]');
    const rowSeparator = functionBody.querySelector("[data-function-row-resizer]");
    leftSeparator?.setAttribute("aria-valuenow", String(Math.round(state.layout.leftRatio * 100)));
    rightSeparator?.setAttribute("aria-valuenow", String(Math.round((state.layout.leftRatio + state.layout.middleRatio) * 100)));
    rowSeparator?.setAttribute("aria-valuenow", String(Math.round(state.layout.functionTopRatio * 100)));
  }

  function settleLayout() {
    if (state.workspaceView === "logic") {
      renderE2E();
      centerE2EOnModule(state.moduleId, "auto");
    }
    requestAnimationFrame(() => {
      const graphScroll = functionBody.querySelector(".function-dag-scroll");
      const activeNode = graphScroll?.querySelector(".function-node.active");
      if (graphScroll && activeNode) {
        graphScroll.scrollLeft = Math.max(0, activeNode.offsetLeft - graphScroll.clientWidth / 2);
        graphScroll.scrollTop = Math.max(0, activeNode.offsetTop - graphScroll.clientHeight / 2);
      }
      const selectedStep = functionBody.querySelector(".memory-transfer-step.selected");
      selectedStep?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
      restorePinnedGraphNodeInfo();
    });
  }

  function resetLayout(scope = "all") {
    if (scope === "all" || scope === "columns") {
      state.layout.leftRatio = defaultLayout.leftRatio;
      state.layout.middleRatio = defaultLayout.middleRatio;
      state.layout.memoryRatio = defaultLayout.memoryRatio;
    }
    if (scope === "all" || scope === "rows") {
      state.layout.functionTopRatio = defaultLayout.functionTopRatio;
    }
    applyLayout();
    settleLayout();
  }

  function resizeColumns(kind, delta, start) {
    if (state.workspaceView === "memory" && memoryModel) {
      const workspaceWidth = clamp(
        start.middle + delta,
        layoutLimits.left + layoutLimits.middle,
        start.available - layoutLimits.code,
      );
      state.layout.memoryRatio = workspaceWidth / start.available;
      applyLayout();
      return;
    }
    let leftWidth = start.left;
    let middleWidth = start.middle;
    if (kind === "left-middle") {
      const pairWidth = start.left + start.middle;
      leftWidth = clamp(start.left + delta, layoutLimits.left, pairWidth - layoutLimits.middle);
      middleWidth = pairWidth - leftWidth;
    } else {
      const pairWidth = start.middle + start.code;
      middleWidth = clamp(start.middle + delta, layoutLimits.middle, pairWidth - layoutLimits.code);
    }
    state.layout.leftRatio = leftWidth / start.available;
    state.layout.middleRatio = middleWidth / start.available;
    applyLayout();
  }

  function resizeFunctionRows(delta, start) {
    const topHeight = clamp(
      start.top + delta,
      layoutLimits.functionTop,
      start.available - layoutLimits.functionBottom,
    );
    state.layout.functionTopRatio = topHeight / start.available;
    applyLayout();
  }

  function activeModule() {
    return moduleMap.get(state.moduleId) || modules[0];
  }

  function activeFunction() {
    return functionMap.get(state.functionId) || null;
  }

  function activeSegment() {
    return activeFunction()?.segments.find((item) => item.id === state.segmentId) || null;
  }

  function functionHistoryFrame(returnLine = null) {
    const fn = activeFunction();
    if (!fn) return null;
    const activeLine = Number.isInteger(returnLine) ? returnLine : state.activeLine;
    const segment = fn.segments.find((item) => activeLine >= item.start && activeLine <= item.end)
      || activeSegment()
      || fn.segments[0]
      || null;
    return {
      moduleId: fn.module_id,
      functionId: fn.id,
      segmentId: segment?.id || null,
      activeLine,
    };
  }

  function inRanges(line, ranges) {
    return ranges.some(([start, end]) => line >= start && line <= end);
  }

  function functionForLine(line) {
    return functions
      .filter((item) => line >= item.start && line <= item.end)
      .sort((a, b) => (a.end - a.start) - (b.end - b.start))[0] || null;
  }

  function moduleForLine(line) {
    const fn = functionForLine(line);
    if (fn) return moduleMap.get(fn.module_id);
    return modules.find((item) => inRanges(line, item.ranges)) || modules[0];
  }

  function moduleRangeLabel(module) {
    const ranges = module.ranges || [];
    if (ranges.length === 1) return `L${ranges[0][0]}–${ranges[0][1]}`;
    const visible = ranges.slice(0, 2).map(([start, end]) => `L${start}–${end}`).join(" · ");
    return ranges.length > 2 ? `${visible} · +${ranges.length - 2} 段` : visible;
  }

  function graphEdgePath(from, to) {
    const deltaY = to.y - from.y;
    const bend = Math.max(42, Math.abs(deltaY) * .42);
    const direction = deltaY >= 0 ? 1 : -1;
    return `M ${from.x} ${from.y} C ${from.x} ${from.y + bend * direction}, ${to.x} ${to.y - bend * direction}, ${to.x} ${to.y}`;
  }

  function calculateE2ELayout() {
    const worldWidth = 780;
    const nodeHeight = 112;
    const top = 86;
    const gap = 170;
    const centerX = worldWidth / 2;
    const positions = new Map();
    const pathIndex = new Map(primaryPath.map((moduleId, index) => [moduleId, index]));
    primaryPath.forEach((moduleId, index) => positions.set(moduleId, { x: centerX, y: top + index * gap }));

    const sideModules = modules.filter((item) => !primaryPathSet.has(item.id) && !item.inactive);
    const laneYs = { left: [], right: [] };
    for (const module of sideModules) {
      const anchors = [];
      for (const edge of module.edges || []) {
        if (pathIndex.has(edge.to)) anchors.push(pathIndex.get(edge.to));
      }
      primaryPath.forEach((sourceId, index) => {
        if ((moduleMap.get(sourceId)?.edges || []).some((edge) => edge.to === module.id)) anchors.push(index);
      });
      const sourceRatio = Math.min(1, Math.max(0, ((module.ranges?.[0]?.[0] || 1) - 1) / Math.max(1, lines.length - 1)));
      const anchor = anchors.length
        ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length
        : sourceRatio * Math.max(0, primaryPath.length - 1);
      const lane = Number(module.position?.x || 50) < 50 ? "left" : "right";
      let y = top + anchor * gap;
      while (laneYs[lane].some((usedY) => Math.abs(usedY - y) < nodeHeight + 24)) y += nodeHeight + 32;
      laneYs[lane].push(y);
      positions.set(module.id, { x: lane === "left" ? 132 : worldWidth - 132, y });
    }

    let currentBottom = Math.max(
      top + Math.max(0, primaryPath.length - 1) * gap,
      ...[...positions.values()].map((item) => item.y)
    );
    const inactiveModules = modules.filter((item) => item.inactive);
    inactiveModules.forEach((module, index) => {
      const row = Math.floor(index / 2);
      const isLeft = index % 2 === 0;
      positions.set(module.id, {
        x: isLeft ? 210 : worldWidth - 210,
        y: currentBottom + 155 + row * (nodeHeight + 34),
      });
    });
    if (inactiveModules.length) currentBottom += 155 + Math.ceil(inactiveModules.length / 2) * (nodeHeight + 34);
    const worldHeight = Math.max(720, currentBottom + nodeHeight / 2 + 90);
    return { worldWidth, worldHeight, positions };
  }

  function renderE2E() {
    const oldScrollTop = e2eBody.scrollTop;
    const oldScrollLeft = e2eBody.scrollLeft;
    const layout = calculateE2ELayout();
    const primaryPairs = new Set(primaryPath.slice(0, -1).map((sourceId, index) => `${sourceId}->${primaryPath[index + 1]}`));
    const edgeRecords = modules.flatMap((source) => (source.edges || []).map((edge) => ({
      source,
      target: moduleMap.get(edge.to),
      edge,
    }))).filter((item) => item.target);
    const edges = edgeRecords.map(({ source, target, edge }) => {
      const pair = `${source.id}->${target.id}`;
      const related = source.id === state.moduleId || target.id === state.moduleId;
      return `<path class="edge-path ${esc(edge.kind)} ${primaryPairs.has(pair) ? "primary" : ""} ${related ? "related" : ""}"
        d="${graphEdgePath(layout.positions.get(source.id), layout.positions.get(target.id))}"
        marker-end="url(#arrow-${esc(edge.kind)})"></path>`;
    }).join("");
    const edgeLabels = edgeRecords.map(({ source, target, edge }) => {
      if (!edge.label) return "";
      const from = layout.positions.get(source.id);
      const to = layout.positions.get(target.id);
      const pair = `${source.id}->${target.id}`;
      const related = source.id === state.moduleId || target.id === state.moduleId;
      return `<span class="edge-label ${primaryPairs.has(pair) ? "primary" : ""} ${related ? "related" : ""}"
        style="left:${(from.x + to.x) / 2}px;top:${(from.y + to.y) / 2}px" title="${esc(edge.label)}">${esc(edge.label)}</span>`;
    }).join("");
    const nodes = orderedModules.map((module) => {
      const position = layout.positions.get(module.id);
      const number = String(moduleNumberMap.get(module.id)).padStart(2, "0");
      return `
        <button type="button" class="module-node ${module.id === state.moduleId ? "active" : ""} ${module.inactive ? "inactive" : ""} ${primaryPathSet.has(module.id) ? "primary" : "side"}"
          data-module="${esc(module.id)}" data-graph-info="module" data-info-name="${esc(module.name)}"
          data-info-meta="第 ${number} 模块 · ${esc(moduleRangeLabel(module))}${module.inactive ? " · 未激活" : ""}"
          data-info-summary="${esc(module.summary)}" aria-pressed="${String(module.id === state.moduleId)}"
          aria-label="${esc(module.name)}：${esc(module.summary)}" style="left:${position.x}px;top:${position.y}px;--node-color:${esc(module.color || "#2457d6")}">
          <span class="module-meta"><b class="module-order">${number}</b><span class="module-range">${esc(moduleRangeLabel(module))}</span></span>
          ${module.inactive ? '<span class="module-badge">未激活</span>' : ""}
          <span class="module-name">${esc(module.name)}</span>
          <span class="module-summary">${esc(module.summary)}</span>
        </button>`;
    }).join("");
    const scaledWidth = Math.round(layout.worldWidth * state.e2eZoom);
    const scaledHeight = Math.round(layout.worldHeight * state.e2eZoom);
    const horizontalGutter = Math.max(96, Math.round(e2eBody.clientWidth / 2));
    const verticalGutter = Math.max(96, Math.round(e2eBody.clientHeight / 2));
    e2eBody.innerHTML = `
      <div class="e2e-toolbar" aria-label="E2E DAG 缩放工具">
        <span class="primary-path-key"><i></i>典型路径 ${primaryPath.length} 步</span>
        <button type="button" data-e2e-zoom="out" title="缩小 E2E DAG">−</button>
        <output id="e2e-zoom-level">${Math.round(state.e2eZoom * 100)}%</output>
        <button type="button" data-e2e-zoom="in" title="放大 E2E DAG">＋</button>
        <button type="button" data-e2e-zoom="fit" title="适合当前列宽">适合</button>
      </div>
      <div class="e2e-stage" style="width:${scaledWidth + horizontalGutter * 2}px;height:${scaledHeight + verticalGutter * 2}px">
        <div class="e2e-canvas" style="left:${horizontalGutter}px;top:${verticalGutter}px;width:${layout.worldWidth}px;height:${layout.worldHeight}px;transform:scale(${state.e2eZoom})">
          <svg class="edge-layer" viewBox="0 0 ${layout.worldWidth} ${layout.worldHeight}" aria-hidden="true">
            <defs>
              <marker id="arrow-control" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#aab5c5"></path></marker>
              <marker id="arrow-data" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#2d7eaa"></path></marker>
              <marker id="arrow-sync" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#7a4db3"></path></marker>
              <marker id="arrow-handshake" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#7a4db3"></path></marker>
            </defs>
            ${edges}
          </svg>
          ${edgeLabels}
          ${nodes}
        </div>
      </div>`;
    requestAnimationFrame(() => {
      e2eBody.scrollTop = oldScrollTop;
      e2eBody.scrollLeft = oldScrollLeft;
    });
    document.getElementById("module-stat").textContent = `${modules.length} 模块 · ${edgeRecords.length} 边`;
  }

  function centerE2EOnModule(moduleId, behavior = "smooth") {
    requestAnimationFrame(() => {
      const node = e2eBody.querySelector(`[data-module="${moduleId}"]`);
      if (!node) return;
      const bodyRect = e2eBody.getBoundingClientRect();
      const nodeRect = node.getBoundingClientRect();
      const left = e2eBody.scrollLeft
        + nodeRect.left + nodeRect.width / 2
        - bodyRect.left - bodyRect.width / 2;
      const top = e2eBody.scrollTop
        + nodeRect.top + nodeRect.height / 2
        - bodyRect.top - bodyRect.height / 2;
      e2eBody.scrollTo({
        left: Math.max(0, left),
        top: Math.max(0, top),
        behavior,
      });
    });
  }

  function setE2EZoom(action) {
    const oldZoom = state.e2eZoom;
    if (action === "in") state.e2eZoom = Math.min(1.35, state.e2eZoom + .1);
    if (action === "out") state.e2eZoom = Math.max(.5, state.e2eZoom - .1);
    if (action === "fit") {
      const { worldWidth } = calculateE2ELayout();
      state.e2eZoom = Math.min(1, Math.max(.5, (e2eBody.clientWidth - 24) / worldWidth));
    }
    if (state.e2eZoom === oldZoom && action !== "fit") return;
    renderE2E();
    centerE2EOnModule(state.moduleId, "auto");
  }

  function renderIo(items, type) {
    if (!items?.length) return '<span class="io-token">—</span>';
    return items.map((item) => `<span class="io-token ${type}" title="${esc(symbolMap.get(item)?.description || item)}">${esc(item)}</span>`).join("");
  }

  function buildFunctionCallGraph(moduleFunctions) {
    const localIds = new Set(moduleFunctions.map((item) => item.id));
    const nodes = new Map(moduleFunctions.map((item) => [item.id, { fn: item, local: true }]));
    const edgeMap = new Map();
    for (const fn of moduleFunctions) {
      for (const segment of fn.segments || []) {
        for (const call of segment.calls || []) {
          if (call.type !== "internal" || !call.target || !functionMap.has(call.target)) continue;
          const target = functionMap.get(call.target);
          if (!nodes.has(target.id)) nodes.set(target.id, { fn: target, local: localIds.has(target.id) });
          const key = `${fn.id}->${target.id}`;
          if (!edgeMap.has(key)) edgeMap.set(key, { from: fn.id, to: target.id, lines: [] });
          edgeMap.get(key).lines.push(call.line);
        }
      }
    }
    const edges = [...edgeMap.values()];
    const indegree = new Map([...nodes.keys()].map((id) => [id, 0]));
    const outgoing = new Map([...nodes.keys()].map((id) => [id, []]));
    for (const edge of edges) {
      indegree.set(edge.to, (indegree.get(edge.to) || 0) + 1);
      outgoing.get(edge.from)?.push(edge.to);
    }
    const levels = new Map([...nodes.keys()].map((id) => [id, 0]));
    const queue = [...nodes.keys()]
      .filter((id) => indegree.get(id) === 0)
      .sort((a, b) => Number(nodes.get(b).local) - Number(nodes.get(a).local) || nodes.get(a).fn.start - nodes.get(b).fn.start);
    const remaining = new Map(indegree);
    while (queue.length) {
      const sourceId = queue.shift();
      for (const targetId of outgoing.get(sourceId) || []) {
        levels.set(targetId, Math.max(levels.get(targetId), levels.get(sourceId) + 1));
        remaining.set(targetId, remaining.get(targetId) - 1);
        if (remaining.get(targetId) === 0) queue.push(targetId);
      }
    }
    const groups = new Map();
    for (const [id, node] of nodes) {
      const level = levels.get(id) || 0;
      if (!groups.has(level)) groups.set(level, []);
      groups.get(level).push({ id, ...node });
    }
    for (const group of groups.values()) {
      group.sort((a, b) => Number(b.local) - Number(a.local) || a.fn.start - b.fn.start || a.fn.name.localeCompare(b.fn.name));
    }
    const maxGroupSize = Math.max(1, ...[...groups.values()].map((group) => group.length));
    const worldWidth = Math.max(560, maxGroupSize * 148 + 48);
    const maxLevel = Math.max(0, ...groups.keys());
    const worldHeight = Math.max(190, (maxLevel + 1) * 104 + 36);
    const positions = new Map();
    for (const [level, group] of groups) {
      group.forEach((node, index) => positions.set(node.id, {
        x: worldWidth * (index + 1) / (group.length + 1),
        y: 54 + level * 104,
      }));
    }
    return { nodes, edges, positions, worldWidth, worldHeight, localIds };
  }

  function renderFunctionCallGraph(moduleFunctions) {
    const graph = buildFunctionCallGraph(moduleFunctions);
    const edges = graph.edges.map((edge) => {
      const from = graph.positions.get(edge.from);
      const to = graph.positions.get(edge.to);
      return `<path class="function-edge" d="${graphEdgePath(from, to)}" marker-end="url(#function-arrow)"></path>`;
    }).join("");
    const labels = graph.edges.map((edge) => {
      const from = graph.positions.get(edge.from);
      const to = graph.positions.get(edge.to);
      const uniqueLines = [...new Set(edge.lines)].sort((a, b) => a - b);
      const label = uniqueLines.length === 1 ? `L${uniqueLines[0]}` : `${uniqueLines.length} 处调用`;
      return `<span class="function-edge-label" style="left:${(from.x + to.x) / 2}px;top:${(from.y + to.y) / 2}px">${label}</span>`;
    }).join("");
    const nodes = [...graph.nodes.entries()].map(([id, node]) => {
      const position = graph.positions.get(id);
      const owner = moduleMap.get(node.fn.module_id);
      const ownerLabel = node.local ? "本模块函数" : `跨模块 · ${owner?.name || "其他模块"}`;
      return `<button type="button" class="function-node ${id === state.functionId ? "active" : ""} ${node.local ? "local" : "cross-module"}"
        data-function="${esc(id)}" data-graph-info="function" data-info-name="${esc(node.fn.name)}"
        data-info-meta="${esc(ownerLabel)} · L${node.fn.start}–${node.fn.end}" data-info-summary="${esc(node.fn.summary)}"
        aria-pressed="${String(id === state.functionId)}" aria-label="${esc(node.fn.name)}：${esc(node.fn.summary)}"
        style="left:${position.x}px;top:${position.y}px">
        <span class="function-node-name">${esc(node.fn.name)}</span>
        <span class="function-node-meta">L${node.fn.start}–${node.fn.end}${node.local ? "" : ` · ${esc(owner?.name || "其他模块")}`}</span>
      </button>`;
    }).join("");
    return {
      html: `<div class="function-graph-canvas" style="width:${graph.worldWidth}px;height:${graph.worldHeight}px">
        <svg class="function-edge-layer" viewBox="0 0 ${graph.worldWidth} ${graph.worldHeight}" aria-hidden="true">
          <defs><marker id="function-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M0 0 L8 4 L0 8 Z" fill="#8d9bb0"></path></marker></defs>
          ${edges}
        </svg>
        ${labels}
        ${nodes}
      </div>`,
      edgeCount: graph.edges.length,
      crossCount: [...graph.nodes.values()].filter((node) => !node.local).length,
    };
  }

  function activeMemoryPath() {
    return memoryPathMap.get(state.memoryPathId) || memoryPaths[0] || null;
  }

  function activeMemoryTransfer() {
    return memoryTransferMap.get(state.transferId) || memoryTransfers[0] || null;
  }

  function memoryEdgePath(from, to, curve = 0) {
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    if (Math.abs(deltaX) >= Math.abs(deltaY)) {
      const bendX = Math.max(55, Math.abs(deltaX) * .44);
      const direction = deltaX >= 0 ? 1 : -1;
      return `M ${from.x} ${from.y} C ${from.x + bendX * direction} ${from.y + curve}, ${to.x - bendX * direction} ${to.y + curve}, ${to.x} ${to.y}`;
    }
    const bendY = Math.max(55, Math.abs(deltaY) * .44);
    const direction = deltaY >= 0 ? 1 : -1;
    return `M ${from.x} ${from.y} C ${from.x + curve} ${from.y + bendY * direction}, ${to.x + curve} ${to.y - bendY * direction}, ${to.x} ${to.y}`;
  }

  function memoryEdgeCurve(transfer) {
    const siblings = memoryTransfers.filter((item) => item.from === transfer.from && item.to === transfer.to);
    if (siblings.length <= 1) return (transfer.curve || 0) * 1.45;
    const index = siblings.findIndex((item) => item.id === transfer.id);
    const siblingLane = (index - (siblings.length - 1) / 2) * 52;
    return siblingLane + (transfer.curve || 0) * .35;
  }

  function renderMemoryModel() {
    if (!memoryModel) return '<div class="empty-state">当前分析数据没有内存与搬运模型。</div>';
    const path = activeMemoryPath();
    const pathTransferIds = new Set(path?.transfer_ids || []);
    const selectedTransfer = activeMemoryTransfer();
    const moduleTransferIds = new Set(memoryTransfers
      .filter((item) => (item.module_ids || []).includes(state.moduleId))
      .map((item) => item.id));
    const selectedRegionIds = new Set(
      selectedTransfer ? [selectedTransfer.from, selectedTransfer.to] : []
    );
    const canvas = memoryModel.canvas;
    const budgetCards = (resourceBudget?.cards || []).map((card) => `
      <article class="resource-budget-card ${esc(card.level || "info")}" title="${esc((card.evidence || []).join("\n"))}">
        <span>${esc(card.label)}</span>
        <b>${esc(card.value)}</b>
        <p>${esc(card.detail)}</p>
      </article>
    `).join("");
    const allocationCards = memoryAllocations.map((allocation) => {
      const relatedRegions = (allocation.region_ids || [])
        .map((regionId) => memoryRegionMap.get(regionId)?.name || regionId)
        .join(" · ");
      return `<article class="memory-allocation-card" title="${esc((allocation.evidence || []).join("\n"))}">
        <header><span>${esc(allocation.kind)} · ${esc(allocation.scope)}</span><b>${esc(allocation.name)}</b></header>
        <div><small>容量 / 申请</small><code>${esc(allocation.capacity)}</code></div>
        <div><small>基址 / 对齐</small><code>${esc(allocation.base)} · ${esc(allocation.alignment)}</code></div>
        <div><small>生命周期 / 复用</small><span>${esc(allocation.lifetime)} · ${esc(allocation.reuse)}</span></div>
        <p>${esc(allocation.purpose)}</p>
        ${relatedRegions ? `<footer>切片：${esc(relatedRegions)}</footer>` : ""}
      </article>`;
    }).join("");
    const spaces = (memoryModel.spaces || []).map((space) => `
      <span class="memory-space-key"><i style="--space-color:${esc(space.color)}"></i>${esc(space.name)}</span>
    `).join("");
    const pathButtons = memoryPaths.map((item) => `
      <button type="button" class="memory-path-tab ${item.id === path?.id ? "active" : ""}"
        data-memory-path="${esc(item.id)}" title="${esc(item.description)}"
        style="--path-color:${esc(item.color)}">${esc(item.name)}</button>
    `).join("");
    const edges = memoryTransfers.map((transfer) => {
      const from = memoryRegionMap.get(transfer.from)?.position;
      const to = memoryRegionMap.get(transfer.to)?.position;
      if (!from || !to) return "";
      const isPath = pathTransferIds.has(transfer.id);
      const isModule = moduleTransferIds.has(transfer.id);
      const isSelected = transfer.id === selectedTransfer?.id;
      const stepIndex = path?.transfer_ids?.indexOf(transfer.id) ?? -1;
      const stepLabel = stepIndex >= 0 ? `${String(stepIndex + 1).padStart(2, "0")} · ` : "";
      const edgePath = memoryEdgePath(from, to, memoryEdgeCurve(transfer));
      return `<g class="memory-edge-group">
        <path id="memory-edge-${esc(transfer.id)}"
          class="memory-edge ${esc(transfer.kind)} ${isPath ? "active-path" : "off-path"} ${isModule ? "module-related" : ""} ${isSelected ? "selected" : ""}"
          d="${edgePath}" marker-end="url(#memory-arrow-${esc(transfer.kind)})"></path>
        <path class="memory-edge-hit" d="${edgePath}" data-transfer="${esc(transfer.id)}" role="button"
          aria-label="${esc(stepLabel + transfer.api)}：${esc(transfer.description)}" tabindex="0">
          <title>${esc(stepLabel + transfer.api)} · L${transfer.line} · ${esc(transfer.description)}</title>
        </path>
      </g>`;
    }).join("");
    const railTransferIds = [...(path?.transfer_ids || [])];
    if (selectedTransfer && !railTransferIds.includes(selectedTransfer.id)) railTransferIds.push(selectedTransfer.id);
    const transferRail = railTransferIds.map((transferId, index) => {
      const transfer = memoryTransferMap.get(transferId);
      if (!transfer) return "";
      const fromRegion = memoryRegionMap.get(transfer.from);
      const toRegion = memoryRegionMap.get(transfer.to);
      const selected = transfer.id === selectedTransfer?.id;
      return `<button type="button" class="memory-transfer-step ${selected ? "selected" : ""} ${esc(transfer.kind)}"
        data-transfer="${esc(transfer.id)}" title="${esc(fromRegion?.name || transfer.from)} → ${esc(toRegion?.name || transfer.to)} · ${esc(transfer.description)} · L${transfer.line}">
        <span>${String(index + 1).padStart(2, "0")}</span><b>${esc(transfer.api)}</b><small>L${transfer.line}</small>
      </button>`;
    }).join("");
    const regions = memoryRegions.map((region) => {
      const space = memorySpaceMap.get(region.space_id);
      const active = selectedRegionIds.has(region.id);
      const usedByPath = memoryTransfers.some((transfer) =>
        pathTransferIds.has(transfer.id) && (transfer.from === region.id || transfer.to === region.id)
      );
      return `<button type="button" class="memory-region ${active ? "active" : ""} ${usedByPath ? "on-path" : "off-path"}"
        data-memory-region="${esc(region.id)}"
        style="left:${region.position.x}px;top:${region.position.y}px;--space-color:${esc(space?.color || "#657084")}"
        title="${esc(region.owner)} · ${esc(region.address)} · ${esc(region.size)}">
        <span class="memory-region-space">${esc(space?.name || region.space_id)}</span>
        <b>${esc(region.name)}</b>
        <small>${esc(region.owner)}</small>
        <code>${esc(region.address)}</code>
      </button>`;
    }).join("");
    const transfer = selectedTransfer;
    const fromRegion = transfer ? memoryRegionMap.get(transfer.from) : null;
    const toRegion = transfer ? memoryRegionMap.get(transfer.to) : null;
    const detail = transfer ? `
      <article class="memory-transfer-detail">
        <header><div><span>${esc(transfer.kind)} · ${esc(transfer.engine)}</span><b>${esc(transfer.api)}</b></div>
          <button type="button" data-call-line="${transfer.line}">定位 L${transfer.line}</button></header>
        <p>${esc(transfer.description)}</p>
        <div class="memory-transfer-grid">
          <div><b>源 · ${esc(fromRegion?.owner || "")}</b><code>${esc(transfer.source_address)}</code></div>
          <div><b>目标 · ${esc(toRegion?.owner || "")}</b><code>${esc(transfer.target_address)}</code></div>
          <div><b>长度</b><code>${esc(transfer.size)}</code></div>
          <div><b>可见性 / 同步</b><span>${esc(transfer.sync)}</span></div>
        </div>
      </article>` : "";
    return `
      ${resourceBudget ? `<div class="resource-budget-summary" title="${esc((resourceBudget.assumptions || []).join("\n"))}"><b>容量口径</b><span>${esc(resourceBudget.summary)}</span><em>悬浮查看变量与完整公式</em></div>` : ""}
      ${budgetCards ? `<section class="resource-budget-overview" aria-label="内存资源预算">${budgetCards}</section>` : ""}
      ${allocationCards ? `<section class="memory-allocation-strip" aria-label="大块申请与空间切片">${allocationCards}</section>` : ""}
      <div class="memory-toolbar">
        <div class="memory-path-tabs">${pathButtons}</div>
        <div class="memory-space-legend">${spaces}</div>
      </div>
      <div class="memory-summary" title="${esc((memoryModel.facts || []).join("\n"))}">${esc(memoryModel.summary)} · 悬浮查看空间判定依据</div>
      <div class="memory-transfer-rail" aria-label="当前关键路径搬运步骤">${transferRail}</div>
      <div class="memory-topology-scroll">
        <div class="memory-canvas" style="width:${canvas.width}px;height:${canvas.height}px">
          <svg class="memory-edge-layer" viewBox="0 0 ${canvas.width} ${canvas.height}" aria-hidden="true">
            <defs>
              <marker id="memory-arrow-data" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 Z"></path></marker>
              <marker id="memory-arrow-control" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 Z"></path></marker>
              <marker id="memory-arrow-sync" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 L8 4 L0 8 Z"></path></marker>
            </defs>
            ${edges}
          </svg>
          ${regions}
        </div>
      </div>
      ${detail}`;
  }

  function renderMiddleTop(moduleFunctions, callGraph) {
    return `<section class="function-dag-pane">
      <header class="pane-head">
        <div><b>模块函数调用 DAG</b><span>实线为内部调用，虚线框为跨模块被调函数</span></div>
        <div class="pane-head-side"><em>${moduleFunctions.length} 本模块 · ${callGraph.crossCount} 跨模块 · ${callGraph.edgeCount} 边</em></div>
      </header>
      <div class="function-dag-scroll">${callGraph.html}</div>
    </section>`;
  }

  function renderMiddle() {
    if (state.workspaceView === "memory" && memoryModel) {
      const path = activeMemoryPath();
      functionBody.innerHTML = `<section class="memory-full-pane">
        <header class="pane-head memory-full-head"><div><b>资源分配与关键路径</b><span>先看整块容量与切片，再沿箭头阅读真实 GM/UB/远端通信</span></div>
          <div class="pane-head-side"><em>内存复核 r${memoryReview?.revision || "?"} ${esc(memoryReview?.status || "待复核")} · ${memoryAllocations.length} 个申请/预算 · ${memoryRegions.length} 区域 · ${memoryTransfers.length} 搬运 · 当前路径 ${path?.transfer_ids?.length || 0} 步</em></div></header>
        <div class="memory-view memory-view-full">${renderMemoryModel()}</div>
      </section>`;
      applyLayout();
      document.getElementById("function-stat").textContent = `${memoryAllocations.length} 申请 · ${memoryRegions.length} 区域 · ${memoryTransfers.length} 搬运`;
      requestAnimationFrame(() => {
        functionBody.querySelector(".memory-transfer-step.selected")
          ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "auto" });
      });
      return;
    }
    const module = activeModule();
    const moduleFunctions = functions.filter((item) => item.module_id === module.id);
    let fn = activeFunction();
    if (!fn || fn.module_id !== module.id) fn = moduleFunctions[0] || null;
    const callGraph = renderFunctionCallGraph(moduleFunctions);
    const topPane = renderMiddleTop(moduleFunctions, callGraph);
    if (!fn) {
      functionBody.innerHTML = `
        ${topPane}
        <div class="function-row-resizer" data-function-row-resizer role="separator" tabindex="0" aria-label="调整函数 DAG 与逐段理解高度" aria-orientation="horizontal" aria-valuemin="20" aria-valuemax="80" title="上下拖拽调整高度；方向键微调；双击重置"></div>
        <section class="function-detail-pane"><div class="empty-state">这个模块尚未声明可下钻函数。请在分析 JSON 中补充对应函数及连续语义块。</div></section>`;
      applyLayout();
      document.getElementById("function-stat").textContent = "0 个函数";
      return;
    }
    const segments = fn.segments.map((segment) => {
      const calls = (segment.calls || []).map((call) => {
        if (call.type === "internal") {
          return `<button type="button" class="call-chip" data-function="${esc(call.target)}" data-call-line="${call.line}" title="进入子函数 · 返回时恢复到 L${call.line}">${esc(call.name)} ↗</button>`;
        }
        return `<button type="button" class="call-chip external" data-call-line="${call.line}" title="外部 API · L${call.line}">${esc(call.name)}</button>`;
      }).join("");
      const reviewedMeaning = segment.mechanism && segment.why && segment.input_state && segment.output_state;
      const semanticFlow = reviewedMeaning ? `
        <div class="segment-flow">
          <div class="flow-field"><b>输入</b><span>${segment.input_state.map(esc).join("；")}</span></div>
          <div class="flow-field"><b>机制</b><span>${esc(segment.mechanism)}</span></div>
          <div class="flow-field"><b>输出</b><span>${segment.output_state.map(esc).join("；")}</span></div>
          <div class="flow-field"><b>为什么</b><span>${esc(segment.why)}</span></div>
        </div>
      ` : '<div class="segment-unreviewed">待逐函数独立复查：旧骨架标签不作为代码解释。</div>';
      return `
        <div class="segment-row ${segment.id === state.segmentId ? "active" : ""}">
          <button type="button" class="segment-card" data-segment="${esc(segment.id)}">
            <span class="segment-kind">${esc(segment.kind)}</span>
            <h4>${esc(segment.title)}</h4>
            ${reviewedMeaning ? `<p>${esc(segment.detail)}</p>` : ""}
            ${semanticFlow}
            <span class="segment-range">L${segment.start}–${segment.end}</span>
          </button>
          ${calls ? `<div class="call-lane">${calls}</div>` : "<div></div>"}
        </div>
      `;
    }).join("");
    const parentFrame = state.functionHistory[state.functionHistory.length - 1] || null;
    const parentFunction = parentFrame ? functionMap.get(parentFrame.functionId) : null;
    const breadcrumbs = state.functionHistory.map((frame, index) => {
      const item = functionMap.get(frame.functionId);
      if (!item) return "";
      return `<button type="button" data-function-history-index="${index}" title="返回 ${esc(item.name)} 的调用现场 L${frame.activeLine}">${esc(item.name)}</button><i aria-hidden="true">›</i>`;
    }).join("") + `<span aria-current="page" title="当前函数 L${fn.start}–${fn.end}">${esc(fn.name)}</span>`;
    functionBody.innerHTML = `
      ${topPane}
      <div class="function-row-resizer" data-function-row-resizer role="separator" tabindex="0" aria-label="调整函数 DAG 与逐段理解高度" aria-orientation="horizontal" aria-valuemin="20" aria-valuemax="80" title="上下拖拽调整高度；方向键微调；双击重置"></div>
      <section class="function-detail-pane">
        <header class="pane-head detail-head">
          <div><b>当前函数逐段理解</b><span>${esc(fn.name)} · L${fn.start}–${fn.end}</span></div>
          <div class="detail-head-actions">
            ${parentFunction ? `<button type="button" class="function-back" data-function-back title="返回 ${esc(parentFunction.name)} 的调用位置 L${parentFrame.activeLine}">← 返回 ${esc(parentFunction.name)}</button>` : ""}
            <em>${fn.segments.length} 块</em>
          </div>
        </header>
        <nav class="function-breadcrumbs" aria-label="函数下钻路径"><b>调用路径</b>${breadcrumbs}</nav>
        <div class="function-detail-scroll">
          <section class="function-card ${fn.inactive ? "inactive" : ""}">
            <span class="range-badge">L${fn.start}–${fn.end}</span>
            <h3>${esc(fn.name)}</h3>
            <p>${esc(fn.summary)}</p>
            <span class="function-review ${fn.review?.status === "PASS" ? "pass" : "pending"}">${fn.review?.status === "PASS" ? `独立复查 PASS · ${esc(fn.review.reviewer)}` : "待独立函数复查"}</span>
            <div class="io-row">
              <div class="io-box"><span class="io-label">关键输入</span>${renderIo(fn.inputs, "input")}</div>
              <div class="io-box"><span class="io-label">关键输出</span>${renderIo(fn.outputs, "output")}</div>
            </div>
          </section>
          <div class="segment-list">${segments}</div>
        </div>
      </section>`;
    applyLayout();
    requestAnimationFrame(() => {
      const graphScroll = functionBody.querySelector(".function-dag-scroll");
      const activeNode = graphScroll?.querySelector(".function-node.active");
      if (graphScroll && activeNode) {
        graphScroll.scrollLeft = Math.max(0, activeNode.offsetLeft - graphScroll.clientWidth / 2);
        graphScroll.scrollTop = Math.max(0, activeNode.offsetTop - graphScroll.clientHeight / 2);
      }
      const memoryScroll = functionBody.querySelector(".memory-topology-scroll");
      const selectedLabel = memoryScroll?.querySelector(".memory-edge-label.selected");
      selectedLabel?.scrollIntoView({ block: "center", inline: "center", behavior: "auto" });
      if (state.pendingHistoryRestore) {
        state.pendingHistoryRestore = false;
        functionBody.querySelector(".segment-row.active")?.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
    document.getElementById("function-stat").textContent = `${moduleFunctions.length} 函数 · ${callGraph.edgeCount} 调用 · ${fn.segments.length} 块`;
  }

  function lineTokens(raw, lineNumber) {
    const identifierRanges = [];
    const identifierPattern = /[A-Za-z_][A-Za-z0-9_]*|\b(?:0x[\da-fA-F]+|\d+(?:\.\d+)?)\b/g;
    let match;
    while ((match = identifierPattern.exec(raw)) !== null) {
      identifierRanges.push({ start: match.index, end: match.index + match[0].length, text: match[0] });
    }
    const searchRanges = state.matchesByLine.get(lineNumber) || [];
    const boundaries = new Set([0, raw.length]);
    for (const item of identifierRanges) { boundaries.add(item.start); boundaries.add(item.end); }
    for (const item of searchRanges) { boundaries.add(item.start); boundaries.add(item.end); }
    const points = [...boundaries].sort((a, b) => a - b);
    const commentStart = raw.indexOf("//");
    const current = state.searchMatches[state.searchIndex] || null;
    let result = "";
    for (let index = 0; index < points.length - 1; index += 1) {
      const start = points[index];
      const end = points[index + 1];
      if (start === end) continue;
      const text = raw.slice(start, end);
      const identifier = identifierRanges.find((item) => start >= item.start && end <= item.end);
      const search = searchRanges.find((item) => start >= item.start && end <= item.end);
      const semantic = identifier ? symbolMap.get(identifier.text) : null;
      const classes = [];
      let title = "";
      if (commentStart !== -1 && start >= commentStart) {
        classes.push("tok-comment");
      } else if (semantic) {
        classes.push(`tok-${semantic.type}`);
        title = semantic.description;
      } else if (identifier && keywords.has(identifier.text)) {
        classes.push("tok-keyword");
      } else if (identifier && /^(?:0x[\da-fA-F]+|\d)/.test(identifier.text)) {
        classes.push("tok-number");
      }
      let inner = esc(text);
      if (classes.length) inner = `<span class="${classes.join(" ")}"${title ? ` title="${esc(title)}"` : ""}>${inner}</span>`;
      if (search) {
        const isCurrent = current && current.line === lineNumber && current.start === search.start;
        inner = `<mark class="search-hit ${isCurrent ? "current" : ""}">${inner}</mark>`;
      }
      result += inner;
    }
    return result || "&nbsp;";
  }

  function codeRowClass(line) {
    const fn = activeFunction();
    const segment = activeSegment();
    const module = activeModule();
    const focused = fn ? line >= fn.start && line <= fn.end : inRanges(line, module.ranges);
    const segmentFocused = segment && line >= segment.start && line <= segment.end;
    const searchLine = state.matchesByLine.has(line);
    const transferFocused = activeMemoryTransfer()?.evidence_lines?.includes(line);
    return [
      "code-line",
      focused ? "focus" : "dim",
      segmentFocused ? "segment-focus" : "",
      transferFocused ? "memory-transfer-focus" : "",
      line === state.activeLine ? "active-line" : "",
      searchLine ? "search-line" : "",
    ].filter(Boolean).join(" ");
  }

  function renderCode() {
    const rows = lines.map((raw, index) => {
      const line = index + 1;
      const note = lineNoteMap.get(line);
      const lineTitle = note?.explanation || (payload.draftMode ? "该行尚未完成函数级复查" : "");
      return `<div id="L${line}" class="${codeRowClass(line)}" data-line="${line}"${lineTitle ? ` title="${esc(lineTitle)}"` : ""}>
        <button type="button" class="reverse-button" data-reverse-line="${line}" title="反向定位到当前阅读模式" aria-label="反向定位第 ${line} 行到当前阅读模式">↩</button>
        <span class="line-no">${line}</span><code class="code-text">${lineTokens(raw, line)}</code>
      </div>`;
    }).join("");
    codeTable.innerHTML = rows;
    document.getElementById("coverage-stat").textContent = `覆盖 ${lines.length} / ${lines.length} 行`;
  }

  function refreshCodeLines(lineNumbers) {
    for (const line of new Set(lineNumbers)) {
      if (!line || line < 1 || line > lines.length) continue;
      const row = document.getElementById(`L${line}`);
      if (!row) continue;
      row.className = codeRowClass(line);
      const code = row.querySelector(".code-text");
      if (code) code.innerHTML = lineTokens(lines[line - 1], line);
    }
  }

  function renderDrawer() {
    const module = activeModule();
    const lineNote = lineNoteMap.get(state.activeLine);
    const lineReview = lineNote ? `
      <p class="line-review-text">${esc(lineNote.explanation)}</p>
      <p><strong>读取：</strong>${lineNote.reads?.length ? lineNote.reads.map(esc).join("、") : "无"}<br>
      <strong>写入：</strong>${lineNote.writes?.length ? lineNote.writes.map(esc).join("、") : "无"}<br>
      <strong>类型：</strong>${esc(lineNote.kind)}</p>
    ` : `<p class="line-review-missing">${payload.draftMode ? "该行尚未完成独立函数复查，不能把自动骨架当作语义说明。" : "该行不在函数定义内，使用模块级说明。"}</p>`;
    const tips = (module.tips || []).length
      ? `<ul>${module.tips.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
      : "<p>当前模块没有额外 Tips。</p>";
    const glossary = (analysis.glossary || []).length
      ? analysis.glossary.map((item) => `<p><strong>${esc(item.term)}</strong><br>${esc(item.description)}</p>`).join("")
      : "<p>未提供术语表。</p>";
    const symbolItems = symbols.map((item) => `
      <div class="symbol-item"><code class="tok-${esc(item.type)}">${esc(item.name)}</code><span>${esc(item.description)}</span></div>
    `).join("");
    const memoryFacts = memoryModel ? `
      <section class="drawer-section"><h3>内存判定依据</h3>
        <p>${esc(memoryModel.summary)}</p>
        <ul>${(memoryModel.facts || []).map((item) => `<li>${esc(item)}</li>`).join("")}</ul>
      </section>` : "";
    drawer.innerHTML = `
      <div class="drawer-head"><h2>阅读辅助</h2><button type="button" class="icon-button" data-close-drawer>×</button></div>
      <section class="drawer-section"><h3>当前行 L${state.activeLine} · 逐行理解</h3>${lineReview}</section>
      <section class="drawer-section"><h3>${esc(module.name)} · Tips</h3>${tips}</section>
      <section class="drawer-section"><h3>颜色语言</h3><p>琥珀色是关键输入，蓝色是关键输出，紫色胶囊是核心外部 API，紫色下划线是内部函数，青色是同步边界。</p></section>
      <section class="drawer-section"><h3>关键符号</h3><div class="symbol-list">${symbolItems || "<p>未提供符号索引。</p>"}</div></section>
      ${memoryFacts}
      <section class="drawer-section"><h3>术语表</h3>${glossary}</section>
      <section class="drawer-section"><h3>源码位置</h3><p>${esc(payload.sourcePath)}</p></section>
    `;
    drawerBackdrop.classList.toggle("open", state.drawerOpen);
    drawerBackdrop.setAttribute("aria-hidden", String(!state.drawerOpen));
  }

  function positionGraphNodeInfo(anchor) {
    if (!anchor?.isConnected || !graphNodePopover.classList.contains("visible")) return;
    const anchorRect = anchor.getBoundingClientRect();
    const popoverRect = graphNodePopover.getBoundingClientRect();
    const margin = 12;
    const gap = 10;
    const topFloor = 76;
    let left = anchorRect.right + gap;
    if (left + popoverRect.width > window.innerWidth - margin) {
      left = anchorRect.left - popoverRect.width - gap;
    }
    left = Math.max(margin, Math.min(left, window.innerWidth - popoverRect.width - margin));
    const top = Math.max(
      topFloor,
      Math.min(anchorRect.top, window.innerHeight - popoverRect.height - margin),
    );
    graphNodePopover.style.left = `${Math.round(left)}px`;
    graphNodePopover.style.top = `${Math.round(top)}px`;
  }

  function showGraphNodeInfo(anchor, pinned = false) {
    if (!anchor) return;
    graphInfoAnchor = anchor;
    graphNodePopover.innerHTML = `
      <div class="graph-node-popover-head">
        <div><b>${esc(anchor.dataset.infoName)}</b><span>${esc(anchor.dataset.infoMeta)}</span></div>
        ${pinned ? '<button type="button" data-close-graph-info title="关闭完整说明" aria-label="关闭完整说明">×</button>' : ""}
      </div>
      <p>${esc(anchor.dataset.infoSummary)}</p>
      <small>${pinned ? "已固定 · 点击 × 或空白处关闭" : "悬浮查看全文 · 单击节点固定"}</small>`;
    graphNodePopover.classList.toggle("pinned", pinned);
    graphNodePopover.classList.add("visible");
    graphNodePopover.setAttribute("aria-hidden", "false");
    requestAnimationFrame(() => positionGraphNodeInfo(anchor));
  }

  function hideGraphNodeInfo() {
    graphInfoAnchor = null;
    graphNodePopover.classList.remove("visible", "pinned");
    graphNodePopover.setAttribute("aria-hidden", "true");
  }

  function clearPinnedGraphNodeInfo() {
    state.graphInfoPinned = null;
    hideGraphNodeInfo();
  }

  function restorePinnedGraphNodeInfo() {
    const pinned = state.graphInfoPinned;
    if (!pinned) return hideGraphNodeInfo();
    const idAttribute = pinned.kind === "module" ? "data-module" : "data-function";
    const anchor = app.querySelector(`[data-graph-info="${pinned.kind}"][${idAttribute}="${pinned.id}"]`);
    if (!anchor) return hideGraphNodeInfo();
    showGraphNodeInfo(anchor, true);
  }

  function scheduleGraphNodeInfoPosition() {
    if (!graphInfoAnchor || graphInfoFrame) return;
    graphInfoFrame = requestAnimationFrame(() => {
      graphInfoFrame = 0;
      positionGraphNodeInfo(graphInfoAnchor);
    });
  }

  function scrollToLine(line, behavior = "smooth") {
    requestAnimationFrame(() => document.getElementById(`L${line}`)?.scrollIntoView({ block: "center", behavior }));
  }

  function renderAll(scroll = false) {
    applyWorkspaceMode();
    if (state.workspaceView === "logic") renderE2E();
    renderMiddle();
    renderCode();
    renderDrawer();
    updateSearchMeta();
    requestAnimationFrame(restorePinnedGraphNodeInfo);
    if (scroll) scrollToLine(state.activeLine);
  }

  function chooseModule(moduleId) {
    const module = moduleMap.get(moduleId);
    if (!module) return;
    let relatedTransfer = null;
    if (memoryModel && state.workspaceView === "memory") {
      const pathIds = new Set(activeMemoryPath()?.transfer_ids || []);
      const belongsToModule = (item) => (item.module_ids || []).includes(moduleId);
      const functionLivesInModule = (item) => functionMap.get(item.function_id)?.module_id === moduleId;
      relatedTransfer = memoryTransfers.find((item) =>
        pathIds.has(item.id) && belongsToModule(item) && functionLivesInModule(item)
      ) || memoryTransfers.find((item) => belongsToModule(item) && functionLivesInModule(item))
        || memoryTransfers.find((item) => pathIds.has(item.id) && belongsToModule(item))
        || memoryTransfers.find(belongsToModule)
        || null;
      if (relatedTransfer) state.transferId = relatedTransfer.id;
    }
    const fn = functionMap.get(relatedTransfer?.function_id)
      || functions.find((item) => item.module_id === moduleId)
      || null;
    state.functionHistory = [];
    state.moduleId = moduleId;
    state.functionId = fn?.id || null;
    state.segmentId = fn?.segments[0]?.id || null;
    state.activeLine = relatedTransfer?.line || fn?.start || module.ranges[0][0];
    if (relatedTransfer) {
      state.segmentId = fn?.segments.find((item) =>
        relatedTransfer.line >= item.start && relatedTransfer.line <= item.end
      )?.id || state.segmentId;
    }
    renderAll(true);
    if (state.workspaceView === "logic") centerE2EOnModule(module.id);
  }

  function chooseFunction(functionId, { pushHistory = false, returnLine = null } = {}) {
    const fn = functionMap.get(functionId);
    if (!fn) return;
    if (pushHistory) {
      const frame = functionHistoryFrame(returnLine);
      if (frame) state.functionHistory.push(frame);
    }
    const moduleChanged = state.moduleId !== fn.module_id;
    state.moduleId = fn.module_id;
    state.functionId = fn.id;
    state.segmentId = fn.segments[0]?.id || null;
    state.activeLine = fn.start;
    const relatedTransfer = memoryTransfers.find((item) => item.function_id === fn.id);
    if (relatedTransfer) state.transferId = relatedTransfer.id;
    renderAll(true);
    if (moduleChanged && state.workspaceView === "logic") centerE2EOnModule(fn.module_id);
  }

  function restoreFunctionHistory(index) {
    if (!Number.isInteger(index) || index < 0 || index >= state.functionHistory.length) return;
    const frame = state.functionHistory[index];
    state.functionHistory = state.functionHistory.slice(0, index);
    state.moduleId = frame.moduleId;
    state.functionId = frame.functionId;
    state.segmentId = frame.segmentId;
    state.activeLine = frame.activeLine;
    state.pendingHistoryRestore = true;
    state.graphInfoPinned = null;
    renderAll(true);
    if (state.workspaceView === "logic") centerE2EOnModule(frame.moduleId);
  }

  function chooseSegment(segmentId) {
    const fn = activeFunction();
    const segment = fn?.segments.find((item) => item.id === segmentId);
    if (!segment) return;
    state.segmentId = segmentId;
    state.activeLine = segment.start;
    functionBody.querySelectorAll(".segment-row").forEach((row) => {
      row.classList.toggle("active", row.querySelector("[data-segment]")?.dataset.segment === segmentId);
    });
    renderCode();
    functionBody.querySelector(".segment-row.active")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    scrollToLine(segment.start);
  }

  function chooseWorkspaceView(view) {
    if (!['memory', 'logic'].includes(view) || (view === 'memory' && !memoryModel)) return;
    state.workspaceView = view;
    state.graphInfoPinned = null;
    renderAll(false);
    requestAnimationFrame(() => {
      applyLayout();
      settleLayout();
    });
  }

  function chooseTransfer(transferId, { preservePath = false } = {}) {
    const transfer = memoryTransferMap.get(transferId);
    if (!transfer) return;
    if (!preservePath && !activeMemoryPath()?.transfer_ids?.includes(transfer.id)) {
      const ownerPath = memoryPaths.find((item) => item.transfer_ids.includes(transfer.id));
      if (ownerPath) state.memoryPathId = ownerPath.id;
    }
    const fn = functionMap.get(transfer.function_id);
    const moduleId = transfer.module_ids.find((item) => moduleMap.has(item)) || fn?.module_id;
    state.workspaceView = "memory";
    state.transferId = transfer.id;
    state.functionHistory = [];
    if (moduleId) state.moduleId = moduleId;
    if (fn) {
      state.functionId = fn.id;
      state.segmentId = fn.segments.find((item) =>
        transfer.line >= item.start && transfer.line <= item.end
      )?.id || fn.segments[0]?.id || null;
    }
    state.activeLine = transfer.line;
    renderAll(true);
    requestAnimationFrame(() => {
      functionBody.querySelector(".memory-transfer-step.selected")
        ?.scrollIntoView({ block: "nearest", inline: "center", behavior: "smooth" });
    });
    if (moduleId && state.workspaceView === "logic") centerE2EOnModule(moduleId);
  }

  function chooseMemoryPath(pathId) {
    const path = memoryPathMap.get(pathId);
    if (!path) return;
    state.memoryPathId = path.id;
    const currentStillVisible = path.transfer_ids.includes(state.transferId);
    chooseTransfer(currentStillVisible ? state.transferId : path.transfer_ids[0], { preservePath: true });
  }

  function chooseMemoryRegion(regionId) {
    if (!memoryRegionMap.has(regionId)) return;
    const pathIds = new Set(activeMemoryPath()?.transfer_ids || []);
    const transfer = memoryTransfers.find((item) =>
      pathIds.has(item.id) && (item.from === regionId || item.to === regionId)
    ) || memoryTransfers.find((item) => item.from === regionId || item.to === regionId);
    if (transfer) chooseTransfer(transfer.id);
  }

  function locateLine(line) {
    const fn = functionForLine(line);
    const module = fn ? moduleMap.get(fn.module_id) : moduleForLine(line);
    state.functionHistory = [];
    state.moduleId = module.id;
    state.functionId = fn?.id || null;
    state.segmentId = fn?.segments.find((item) => line >= item.start && line <= item.end)?.id || null;
    state.activeLine = line;
    const transfer = memoryTransfers.find((item) => item.evidence_lines?.includes(line));
    if (transfer) state.transferId = transfer.id;
    renderAll(true);
    if (state.workspaceView === "logic") centerE2EOnModule(module.id);
  }

  function updateSearchMeta() {
    const total = state.searchMatches.length;
    const current = total ? state.searchIndex + 1 : 0;
    const lineCount = state.matchesByLine.size;
    searchCount.textContent = state.search && !total ? "无结果" : `${current} / ${total} · ${lineCount} 行`;
    searchCount.classList.toggle("no-result", Boolean(state.search && !total));
    searchPrev.disabled = !total;
    searchNext.disabled = !total;
  }

  function runSearch(query) {
    const oldLines = [...state.matchesByLine.keys()];
    const oldActiveLine = state.activeLine;
    const oldCurrent = state.searchMatches[state.searchIndex] || null;
    state.search = query;
    state.searchMatches = [];
    state.matchesByLine = new Map();
    const needle = query.toLocaleLowerCase();
    if (needle) {
      lines.forEach((raw, index) => {
        const haystack = raw.toLocaleLowerCase();
        let cursor = 0;
        while (cursor <= haystack.length - needle.length) {
          const found = haystack.indexOf(needle, cursor);
          if (found === -1) break;
          const item = { line: index + 1, start: found, end: found + needle.length };
          state.searchMatches.push(item);
          if (!state.matchesByLine.has(item.line)) state.matchesByLine.set(item.line, []);
          state.matchesByLine.get(item.line).push(item);
          cursor = found + Math.max(needle.length, 1);
        }
      });
    }
    state.searchIndex = state.searchMatches.length ? 0 : -1;
    if (state.searchMatches.length) state.activeLine = state.searchMatches[0].line;
    const newCurrent = state.searchMatches[state.searchIndex] || null;
    refreshCodeLines([
      ...oldLines,
      ...state.matchesByLine.keys(),
      oldActiveLine,
      state.activeLine,
      oldCurrent?.line,
      newCurrent?.line,
    ]);
    updateSearchMeta();
    if (state.searchMatches.length) scrollToLine(state.activeLine, "auto");
  }

  function navigateSearch(delta) {
    const total = state.searchMatches.length;
    if (!total) return;
    const oldCurrent = state.searchMatches[state.searchIndex];
    const oldActiveLine = state.activeLine;
    state.searchIndex = (state.searchIndex + delta + total) % total;
    const newCurrent = state.searchMatches[state.searchIndex];
    state.activeLine = newCurrent.line;
    refreshCodeLines([oldCurrent?.line, newCurrent.line, oldActiveLine]);
    updateSearchMeta();
    scrollToLine(state.activeLine);
  }

  app.addEventListener("click", (event) => {
    if (event.target.closest("[data-close-graph-info]")) return clearPinnedGraphNodeInfo();
    const graphInfoNode = event.target.closest("[data-graph-info]");
    if (!graphInfoNode && !event.target.closest("#graph-node-popover")) clearPinnedGraphNodeInfo();
    const workspaceViewButton = event.target.closest("[data-workspace-view]");
    if (workspaceViewButton) return chooseWorkspaceView(workspaceViewButton.dataset.workspaceView);
    const memoryPathButton = event.target.closest("[data-memory-path]");
    if (memoryPathButton) return chooseMemoryPath(memoryPathButton.dataset.memoryPath);
    const transferButton = event.target.closest("[data-transfer]");
    if (transferButton) return chooseTransfer(transferButton.dataset.transfer);
    const memoryRegionButton = event.target.closest("[data-memory-region]");
    if (memoryRegionButton) return chooseMemoryRegion(memoryRegionButton.dataset.memoryRegion);
    const zoomButton = event.target.closest("[data-e2e-zoom]");
    if (zoomButton) return setE2EZoom(zoomButton.dataset.e2eZoom);
    const historyButton = event.target.closest("[data-function-history-index]");
    if (historyButton) return restoreFunctionHistory(Number(historyButton.dataset.functionHistoryIndex));
    const backButton = event.target.closest("[data-function-back]");
    if (backButton) return restoreFunctionHistory(state.functionHistory.length - 1);
    const moduleButton = event.target.closest("[data-module]");
    if (moduleButton) {
      state.graphInfoPinned = { kind: "module", id: moduleButton.dataset.module };
      return chooseModule(moduleButton.dataset.module);
    }
    const functionButton = event.target.closest("[data-function]");
    if (functionButton) {
      state.graphInfoPinned = graphInfoNode
        ? { kind: "function", id: functionButton.dataset.function }
        : null;
      const targetFunctionId = functionButton.dataset.function;
      const isCallChip = functionButton.classList.contains("call-chip");
      const shouldPushHistory = isCallChip || targetFunctionId !== state.functionId;
      let returnLine = Number(functionButton.dataset.callLine);
      if (!Number.isInteger(returnLine) || returnLine <= 0) {
        const caller = activeFunction();
        const matchingCall = caller?.segments.flatMap((item) => item.calls || [])
          .find((call) => call.type === "internal" && call.target === targetFunctionId);
        returnLine = matchingCall?.line || state.activeLine;
      }
      return chooseFunction(targetFunctionId, { pushHistory: shouldPushHistory, returnLine });
    }
    const segmentButton = event.target.closest("[data-segment]");
    if (segmentButton) return chooseSegment(segmentButton.dataset.segment);
    const callButton = event.target.closest("[data-call-line]");
    if (callButton) return locateLine(Number(callButton.dataset.callLine));
    const reverseButton = event.target.closest("[data-reverse-line]");
    if (reverseButton) {
      event.preventDefault();
      event.stopPropagation();
      return locateLine(Number(reverseButton.dataset.reverseLine));
    }
  });

  app.addEventListener("pointerdown", (event) => {
    const columnSeparator = event.target.closest("[data-column-resizer]");
    const rowSeparator = event.target.closest("[data-function-row-resizer]");
    if (!columnSeparator && !rowSeparator) return;
    event.preventDefault();
    const leftTrack = tracks.querySelector('[data-track="e2e"]');
    const middleTrack = tracks.querySelector('[data-track="function"]');
    const codeTrack = tracks.querySelector('[data-track="code"]');
    const available = Math.max(
      1,
      tracks.clientWidth - layoutLimits.splitter * (state.workspaceView === "memory" ? 1 : 2),
    );
    if (columnSeparator) {
      resizeSession = {
        type: "column",
        kind: columnSeparator.dataset.columnResizer,
        separator: columnSeparator,
        startX: event.clientX,
        available,
        left: state.workspaceView === "memory" ? 0 : leftTrack.getBoundingClientRect().width,
        middle: middleTrack.getBoundingClientRect().width,
        code: codeTrack.getBoundingClientRect().width,
      };
    } else {
      const topPane = functionBody.querySelector(".function-dag-pane");
      if (!topPane) return;
      resizeSession = {
        type: "row",
        separator: rowSeparator,
        startY: event.clientY,
        available: Math.max(1, functionBody.clientHeight - layoutLimits.splitter),
        top: topPane.getBoundingClientRect().height,
      };
    }
    resizeSession.separator.classList.add("active");
    document.documentElement.classList.add("layout-resizing", resizeSession.type === "column" ? "resize-columns" : "resize-rows");
  });

  document.addEventListener("pointermove", (event) => {
    if (!resizeSession) return;
    event.preventDefault();
    if (resizeSession.type === "column") resizeColumns(resizeSession.kind, event.clientX - resizeSession.startX, resizeSession);
    else resizeFunctionRows(event.clientY - resizeSession.startY, resizeSession);
  });

  document.addEventListener("pointerup", () => {
    if (!resizeSession) return;
    resizeSession.separator.classList.remove("active");
    resizeSession = null;
    document.documentElement.classList.remove("layout-resizing", "resize-columns", "resize-rows");
    settleLayout();
  });

  app.addEventListener("keydown", (event) => {
    const transferEdge = event.target.closest(".memory-edge-hit[data-transfer]");
    if (transferEdge && ["Enter", " "].includes(event.key)) {
      event.preventDefault();
      return chooseTransfer(transferEdge.dataset.transfer);
    }
    const columnSeparator = event.target.closest("[data-column-resizer]");
    const rowSeparator = event.target.closest("[data-function-row-resizer]");
    if (!columnSeparator && !rowSeparator) return;
    const step = event.shiftKey ? 48 : 20;
    if (columnSeparator && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const leftTrack = tracks.querySelector('[data-track="e2e"]');
      const middleTrack = tracks.querySelector('[data-track="function"]');
      const codeTrack = tracks.querySelector('[data-track="code"]');
      const start = {
        available: Math.max(1, tracks.clientWidth - layoutLimits.splitter * (state.workspaceView === "memory" ? 1 : 2)),
        left: state.workspaceView === "memory" ? 0 : leftTrack.getBoundingClientRect().width,
        middle: middleTrack.getBoundingClientRect().width,
        code: codeTrack.getBoundingClientRect().width,
      };
      resizeColumns(columnSeparator.dataset.columnResizer, event.key === "ArrowRight" ? step : -step, start);
      settleLayout();
    }
    if (rowSeparator && ["ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      const start = {
        available: Math.max(1, functionBody.clientHeight - layoutLimits.splitter),
        top: functionBody.querySelector(".function-dag-pane").getBoundingClientRect().height,
      };
      resizeFunctionRows(event.key === "ArrowDown" ? step : -step, start);
      settleLayout();
    }
  });

  app.addEventListener("dblclick", (event) => {
    if (event.target.closest("[data-column-resizer]")) resetLayout("columns");
    if (event.target.closest("[data-function-row-resizer]")) resetLayout("rows");
  });

  app.addEventListener("pointerover", (event) => {
    const node = event.target.closest("[data-graph-info]");
    if (!node || node.contains(event.relatedTarget)) return;
    showGraphNodeInfo(node, Boolean(
      state.graphInfoPinned
      && state.graphInfoPinned.kind === node.dataset.graphInfo
      && state.graphInfoPinned.id === (node.dataset.module || node.dataset.function),
    ));
  });
  app.addEventListener("pointerout", (event) => {
    const node = event.target.closest("[data-graph-info]");
    if (!node || node.contains(event.relatedTarget)) return;
    if (state.graphInfoPinned) restorePinnedGraphNodeInfo();
    else hideGraphNodeInfo();
  });
  app.addEventListener("focusin", (event) => {
    const node = event.target.closest("[data-graph-info]");
    if (node) showGraphNodeInfo(node, false);
  });
  app.addEventListener("focusout", (event) => {
    if (!event.target.closest("[data-graph-info]")) return;
    if (state.graphInfoPinned) restorePinnedGraphNodeInfo();
    else hideGraphNodeInfo();
  });
  app.addEventListener("scroll", scheduleGraphNodeInfoPosition, true);
  window.addEventListener("resize", scheduleGraphNodeInfoPosition);
  window.addEventListener("resize", () => {
    if (layoutFrame) cancelAnimationFrame(layoutFrame);
    layoutFrame = requestAnimationFrame(() => {
      layoutFrame = 0;
      applyLayout();
      settleLayout();
    });
  });

  searchInput.addEventListener("input", (event) => runSearch(event.target.value));
  searchInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      navigateSearch(event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      searchInput.value = "";
      runSearch("");
    }
  });
  searchPrev.addEventListener("click", () => navigateSearch(-1));
  searchNext.addEventListener("click", () => navigateSearch(1));
  e2eBody.addEventListener("wheel", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    event.preventDefault();
    setE2EZoom(event.deltaY < 0 ? "in" : "out");
  }, { passive: false });
  document.getElementById("drawer-toggle").addEventListener("click", () => {
    state.drawerOpen = !state.drawerOpen;
    renderDrawer();
  });
  document.getElementById("layout-reset").addEventListener("click", () => resetLayout("all"));
  drawerBackdrop.addEventListener("click", (event) => {
    if (event.target === drawerBackdrop || event.target.closest("[data-close-drawer]")) {
      state.drawerOpen = false;
      renderDrawer();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "F3" && document.activeElement !== searchInput) {
      event.preventDefault();
      if (!state.searchMatches.length) searchInput.focus();
      else navigateSearch(event.shiftKey ? -1 : 1);
    }
    if (event.key === "Escape" && state.drawerOpen) {
      state.drawerOpen = false;
      renderDrawer();
    }
    if (event.key === "Escape" && state.graphInfoPinned) clearPinnedGraphNodeInfo();
  });

  applyLayout();
  renderAll(true);
  if (state.workspaceView === "logic") centerE2EOnModule(state.moduleId, "auto");
})();
