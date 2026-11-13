const assert = require('node:assert/strict');
const model = require('./model_architecture.cjs');

const scene = new model.Scene(400, 200, '中文技术图');
scene.node('input', 20, 60, 130, 50, '输入请求');
scene.node('cache', 240, 60, 130, 50, 'KV 缓存');
scene.edge('input', 'cache');
assert.equal(model.audit(scene).ok, true);
assert.match(model.svg(scene), /输入请求/);
assert.match(model.svg(scene), /KV 缓存/);
assert.match(model.drawio(scene), /输入请求/);
assert.match(model.drawio(scene), /KV 缓存/);
console.log('中文标签在 SVG 和 draw.io 中保留，结构检查通过');
