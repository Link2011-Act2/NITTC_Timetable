import test from 'node:test';
import assert from 'node:assert/strict';
import { attributeTokens, toggleAttribute, setCustomAttributes } from '../web/attribute-selection.js';

test('attribute selections preserve custom IDs and distinguish inclusion from exclusion', () => {
  const included = toggleAttribute('CUSTOM, INTERNATIONAL', 'DD', true);
  assert.deepEqual(attributeTokens(included), ['CUSTOM', 'INTERNATIONAL', 'DD']);
  assert.deepEqual(attributeTokens(toggleAttribute(included, 'DD', false)), ['CUSTOM', 'INTERNATIONAL']);
  assert.deepEqual(attributeTokens(setCustomAttributes('DD, CUSTOM', 'OTHER')), ['DD', 'OTHER']);
  assert.deepEqual(attributeTokens(toggleAttribute('DD', 'INTERNATIONAL', true)), ['DD', 'INTERNATIONAL']);
  const excluded = toggleAttribute('CUSTOM', 'DD', true);
  assert.deepEqual(attributeTokens(excluded), ['CUSTOM', 'DD']);
});
