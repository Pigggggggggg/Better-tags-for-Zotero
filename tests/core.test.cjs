const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const records = [
  { id: 1, title: '图神经网络综述', creator: '张三', year: '2024', tags: [{ tag: '主题/机器学习' }, { tag: '进度/待读' }] },
  { id: 2, title: '注意力机制', creator: '李四', year: '2025', tags: [{ tag: '主题/机器学习' }, { tag: 'Transformer', type: 1 }] },
  { id: 3, title: 'Research methods', creator: 'Smith', year: '2022', tags: [{ tag: '进度/待读' }] },
  { id: 4, title: '<script>ordinary title</script>', creator: '', year: '', tags: [] }
];
const ids = values => values.map(v => v.id);
test('AND and OR produce exact intersections and unions across records', () => {
  const tags = ['主题/机器学习', '进度/待读'];
  assert.deepEqual(ids(core.filter(records, { tags, mode: 'all' })), [1]);
  assert.deepEqual(ids(core.filter(records, { tags, mode: 'any' })), [1, 2, 3]);
  assert.deepEqual(ids(core.filter(records, { tags: ['missing'] })), []);
  assert.deepEqual(ids(core.filter(records, { tags: ['主题'] })), []);
});
test('empty filters, untagged and combined case-insensitive word search', () => {
  assert.equal(core.filter(records, {}).length, 4);
  assert.deepEqual(ids(core.filter(records, { untagged: true })), [4]);
  assert.deepEqual(ids(core.filter(records, { query: 'SMITH 2022' })), [3]);
  assert.deepEqual(ids(core.filter(records, { tags: ['主题/机器学习'], query: '李四' })), [2]);
});
test('tag counts deduplicate a tag per record and distinguish automatic tags', () => {
  assert.equal(core.facets(records).find(f => f.tag === '主题/机器学习').count, 2);
  assert.equal(core.facets(records, true).some(f => f.tag === 'Transformer'), false);
  const duplicates = [{ ...records[0], tags: [{ tag: 'A' }, { tag: 'A' }] }];
  assert.equal(core.facets(duplicates)[0].count, 1);
});
test('multiple tags use newlines, preserving punctuation and spaces', () => {
  assert.deepEqual(core.parseTags('  标签 A\n标签 A\r\nTopic, with commas\n主题/子主题\n'), ['标签 A', 'Topic, with commas', '主题/子主题']);
});
test('adding preserves existing automatic tags and unrelated tags', () => {
  const tags = [{ tag: 'auto', type: 1 }, { tag: 'old', type: 0 }];
  const result = core.planChange(tags, ['auto', 'new'], 'add');
  assert.deepEqual(result.tags, [...tags, { tag: 'new', type: 0 }]);
  assert.deepEqual(result.changes, [{ name: 'new', before: null, after: 0 }]);
  assert.deepEqual(tags, [{ tag: 'auto', type: 1 }, { tag: 'old', type: 0 }]);
});
test('remove and undo restore the original tag type without reverting other tags', () => {
  const removed = core.planChange([{ tag: 'auto', type: 1 }, { tag: 'keep' }], ['auto'], 'remove');
  const undone = core.planUndo([...removed.tags, { tag: 'external' }], removed.changes);
  assert.equal(core.tagType(undone, 'auto'), 1);
  assert.equal(core.tagType(undone, 'external'), 0);
  assert.equal(core.tagType(undone, 'keep'), 0);
});
test('undo refuses overlapping external changes instead of overwriting', () => {
  const plan = core.planChange([], ['new'], 'add');
  assert.throws(() => core.planUndo([], plan.changes), /其他操作修改/);
  assert.throws(() => core.planUndo([{ tag: 'new', type: 1 }], plan.changes), /其他操作修改/);
});
test('state validation ignores malformed persisted fields', () => {
  assert.deepEqual(core.normalizeState({ tags: ['A', 1, 'A'], mode: 'garbage', query: {}, untagged: false }), {
    tags: ['A'], mode: 'all', query: '', untagged: false, groupID: null
  });
});
test('year sorting is descending and never mutates the source', () => {
  assert.deepEqual(ids(core.sorted(records, 'year')), [2, 1, 3, 4]);
  assert.deepEqual(ids(records), [1, 2, 3, 4]);
});
