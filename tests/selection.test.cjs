const { test } = require('node:test');
const assert = require('node:assert/strict');
const core = require('../src/core.js');
test('plain tag selection removes a prior group filter and all previous tags', () => {
  const next = core.selectTag({tags:['A','A','B'],groupID:'A-group',untagged:true,mode:'any'},'C');
  assert.deepEqual(next.tags,['C']); assert.equal(next.groupID,null); assert.equal(next.untagged,false);
  assert.equal(next.mode,'any');
});
test('modifier clicks deduplicate names and toggle them across repeated groups', () => {
  let next = core.selectTag({tags:['A','A'],groupID:'group'},'B',true);
  assert.deepEqual(next.tags,['A','B']); assert.equal(next.groupID,'group');
  next = core.selectTag(next,'A',true); assert.deepEqual(next.tags,['B']);
  next = core.selectTag(next,'B'); assert.deepEqual(next.tags,['B']);
});
