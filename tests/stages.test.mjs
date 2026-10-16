import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, buildStage, stageShape } from '../js/stages.js';

for (const [i, st] of STAGES.entries()) {
  test(`stage ${i + 1}: ${st.title}`, () => {
    const start = buildStage(st);
    const goal = buildStage(st, { solved: true });
    const a = stageShape(start, st), b = stageShape(goal, st);
    assert.ok(a && b, 'shape must exist');
    assert.notEqual(a, b, 'goal must differ from start');
    // 別々に作っても同じ形になる (IDに依存しない)
    assert.equal(stageShape(buildStage(st, { solved: true }), st), b);
    assert.ok(!goal.dirs['~/repo'].repo.op, 'goal must not be mid-operation');
  });
}
