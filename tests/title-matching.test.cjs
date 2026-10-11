const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compileTagMatcher } = require('../src/core.js');
test('battery alone cannot activate a longer phrase; flow batteries activates both existing tags', () => {
  const match = compileTagMatcher(['battery','Flow battery','redox flow battery']);
  assert.deepEqual(match('A BATTERY study'),['battery']);
  assert.deepEqual(match('XXX Flow batteries'),['battery','Flow battery']);
  assert.deepEqual(match('Redox flow batteries for storage'),['battery','Flow battery','redox flow battery']);
});
test('phrases require every word in order and do not match substrings', () => {
  const match=compileTagMatcher(['battery','Flow battery','flow','catalyst']);
  assert.deepEqual(match('flow-assisted rechargeable batteries'),['battery','flow']);
  assert.deepEqual(match('batteries with flow'),['battery','flow']);
  assert.deepEqual(match('batteryless systems with overflow and electrocatalysts'),[]);
});
test('plural and singular forms work in both directions; original tag names are retained', () => {
  const match=compileTagMatcher(['Batteries','catalyst','oxide','process','analysis']);
  assert.deepEqual(match('A battery: catalysts, oxides, processes and analyses'),['Batteries','catalyst','oxide','process','analysis']);
});
test('case, typographic dashes and spaces normalize without losing chemical charges', () => {
  const match=compileTagMatcher(['Flow battery','Li-O','Fe2+','Fe3+']);
  assert.deepEqual(match('FLOW–BATTERIES with Li–O and Fe2+'),['Flow battery','Li-O','Fe2+']);
});
test('Chinese phrases, invariant nouns, digits and empty inputs are handled', () => {
  const match=compileTagMatcher(['液流电池','电池','physics','species','Li2O2','battery']);
  assert.deepEqual(match('液流电池性能研究 Li2O2 physics species'),['液流电池','电池','physics','species','Li2O2']);
  assert.deepEqual(match(''),[]); assert.deepEqual(compileTagMatcher([])('Battery'),[]);
});
