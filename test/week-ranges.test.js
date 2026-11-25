import test from 'node:test';
import assert from 'node:assert/strict';
import {parseWeekRange,weekRangeApplies} from '../web/week-ranges.js';

test('extracts inclusive start and end weeks while retaining the source notation',()=>{
  assert.deepEqual(parseWeekRange('卒研（9週〜）'),{subject:'卒研',activeWeekRange:{start:9,end:null},notation:'（9週〜）'});
  assert.deepEqual(parseWeekRange('工学実験・実習III（〜10週）'),{subject:'工学実験・実習III',activeWeekRange:{start:null,end:10},notation:'（〜10週）'});
  assert.deepEqual(parseWeekRange('数学II (5～10週)'),{subject:'数学II',activeWeekRange:{start:5,end:10},notation:'(5～10週)'});
  assert.equal(parseWeekRange('数学II (10～5週)'),null);
  assert.equal(parseWeekRange('数学II (選択)'),null);
});

test('evaluates boundaries only with explicit date mappings',()=>{
  const dates={'2026-11-18':8,'2026-11-25':9,'2026-12-02':10,'2026-12-09':11};
  assert.equal(weekRangeApplies({start:9,end:null},'2026-11-18',dates),false);
  assert.equal(weekRangeApplies({start:9,end:null},'2026-11-25',dates),true);
  assert.equal(weekRangeApplies({start:null,end:10},'2026-12-02',dates),true);
  assert.equal(weekRangeApplies({start:null,end:10},'2026-12-09',dates),false);
  assert.equal(weekRangeApplies({start:9,end:null},'2026-12-10',dates),null);
});
