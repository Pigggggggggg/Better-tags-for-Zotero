const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
const records = [
  { id: 1, title: 'A', tags: [{ tag: '锂氧电池' }, { tag: '待读' }] },
  { id: 2, title: 'B', tags: [{ tag: '钠电池' }, { tag: '自动', type: 1 }] },
  { id: 3, title: 'C', tags: [] }
];
const tree = [
  { id: 'root', name: '研究主题', parentID: null, tags: [] },
  { id: 'battery', name: '电池', parentID: 'root', tags: ['钠电池'] },
  { id: 'oxygen', name: '锂氧', parentID: 'battery', tags: ['锂氧电池'] },
  { id: 'other', name: '阅读计划', parentID: null, tags: ['锂氧电池', '待读'] },
  { id: 'empty', name: '空组', parentID: null, tags: ['已消失的标签'] }
];
test('disappearing tag is removed while other filters and hidden automatic tags survive', () => {
  const input = { tags: ['已删除', '锂氧电池', '自动'], query: 'A', mode: 'any', groupID: 'battery' };
  const result = core.reconcileState(input, records);
  assert.deepEqual(result.removed, ['已删除']);
  assert.deepEqual(result.state.tags, ['锂氧电池', '自动']);
  assert.equal(result.state.query, 'A'); assert.equal(result.state.mode, 'any');
  assert.equal(result.state.groupID, 'battery');
  assert.equal(input.tags.length, 3);
});
test('valid tags that do not co-occur must not be pruned by empty intersection', () => {
  const state = { tags: ['锂氧电池', '钠电池'], mode: 'all' };
  assert.deepEqual(core.reconcileState(state, records).removed, []);
  assert.deepEqual(core.filter(records, state), []);
});
test('an empty successful library removes all stale selected tags', () => {
  const result = core.reconcileState({ tags: ['A', 'B'] }, []);
  assert.deepEqual(result.state.tags, []); assert.equal(result.removed.length, 2);
});
test('parent group resolves nested tags uniquely across multiple membership', () => {
  assert.deepEqual(new Set(core.groupTags(tree, 'root')), new Set(['钠电池', '锂氧电池']));
  assert.deepEqual(new Set(core.groupTags(tree, 'other')), new Set(['锂氧电池', '待读']));
  assert.equal(core.groupPath(tree, 'oxygen'), '研究主题 / 电池 / 锂氧');
  assert.deepEqual(core.filter(records, { groupID: 'root' }, core.groupTags(tree, 'root')).map(r => r.id), [1, 2]);
});
test('group OR scope intersects with explicit tags and never turns empty groups into all items', () => {
  assert.deepEqual(core.filter(records, { groupID: 'root', tags: ['待读'], mode: 'all' }, core.groupTags(tree, 'root')).map(r => r.id), [1]);
  assert.deepEqual(core.filter(records, { groupID: 'empty' }, core.groupTags(tree, 'empty')), []);
  assert.deepEqual(core.filter(records, { groupID: 'empty' }, []), []);
});
test('group edits preserve IDs, membership, expansion and allow equal names in different parents', () => {
  const original = core.normalizeGroups(tree); original[1].collapsed = true;
  const edited = core.upsertGroup(original, { ...original[1], name: '储能' });
  assert.equal(edited[1].id, 'battery'); assert.equal(edited[1].collapsed, true);
  assert.equal(original[1].name, '电池');
  assert.equal(core.upsertGroup(edited, { id: 'dup', name: '储能', parentID: 'other', tags: [] }).length, 6);
});
test('rejects self-parenting, moving a parent below a descendant and same-level duplicates', () => {
  assert.throws(() => core.upsertGroup(tree, { ...tree[0], parentID: 'oxygen' }), /子分组/);
  assert.throws(() => core.upsertGroup(tree, { ...tree[1], parentID: 'battery' }), /自身/);
  assert.throws(() => core.upsertGroup(tree, { id: 'dup', name: '电池', parentID: 'root' }), /同名/);
  assert.throws(() => core.upsertGroup(tree, { id: 'new', name: 'x', parentID: 'missing' }), /父分组/);
});
test('moving a subtree changes ancestry without dropping descendant or tag membership', () => {
  const moved = core.upsertGroup(tree, { ...tree[1], parentID: 'other' });
  assert.equal(core.groupPath(moved, 'oxygen'), '阅读计划 / 电池 / 锂氧');
  assert.deepEqual(core.groupTags(moved, 'root'), []);
});
test('removing a group removes only its subtree and leaves other tag memberships', () => {
  const remaining = core.removeGroup(tree, 'battery');
  assert.deepEqual(remaining.map(g => g.id), ['root', 'other', 'empty']);
  assert.deepEqual(core.groupTags(remaining, 'other'), ['锂氧电池', '待读']);
  assert.equal(records[0].tags[0].tag, '锂氧电池');
});
test('malformed persisted trees have duplicates removed, dangling parents rooted and cycles repaired', () => {
  const normalized = core.normalizeGroups([
    { id: 'a', name: 'A', parentID: 'b', tags: ['T', 'T', 1] },
    { id: 'b', name: 'B', parentID: 'a' },
    { id: 'c', name: 'C', parentID: 'missing' },
    { id: 'a', name: 'duplicate' }, null
  ]);
  assert.equal(normalized.length, 3);
  assert.deepEqual(normalized[0].tags, ['T']);
  assert.equal(normalized.find(n => n.id === 'c').parentID, null);
  for (const node of normalized) assert.ok(core.groupPath(normalized, node.id).length);
});

test('reordering root groups preserves complete subtrees and does not mutate the input', () => {
  const moved = core.reorderGroup(tree, 'other', 'root');
  assert.deepEqual(moved.filter(n => !n.parentID).map(n => n.id), ['other', 'root', 'empty']);
  assert.equal(core.groupPath(moved, 'oxygen'), '研究主题 / 电池 / 锂氧');
  assert.deepEqual(core.groupTags(moved, 'root'), core.groupTags(tree, 'root'));
  assert.equal(tree[0].id, 'root');
});
test('nested sibling ordering supports both directions and rejects accidental reparenting', () => {
  const nodes = core.upsertGroup(tree, { id: 'child2', name: '另一子组', parentID: 'root', tags: ['B'] });
  const moved = core.reorderGroup(nodes, 'child2', 'battery', false);
  assert.deepEqual(moved.filter(n => n.parentID === 'root').map(n => n.id), ['child2', 'battery']);
  const back = core.reorderGroup(moved, 'child2', 'battery', true);
  assert.deepEqual(back.filter(n => n.parentID === 'root').map(n => n.id), ['battery', 'child2']);
  assert.throws(() => core.reorderGroup(nodes, 'root', 'battery'), /同一层级/);
  assert.throws(() => core.reorderGroup(nodes, 'missing', 'root'), /分组已变化/);
});
test('tag order is alphabetic and numeric regardless of insertion order', () => {
  const sorted = core.facets([{ tags: ['zeta', 'Beta10', 'Alpha', 'Beta2'].map(tag => ({ tag })) }]);
  assert.deepEqual(sorted.map(n => n.tag), ['Alpha', 'Beta2', 'Beta10', 'zeta']);
});
