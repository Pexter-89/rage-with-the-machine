import { wheelValues, snapToWheel, parseWeightInput, parseRepsInput, sameLoading, plateTotal, platesFor } from './loading';
import { DUMBBELL_LOADING, BARBELL_LOADING, BODYWEIGHT_LOADING } from './catalog';
test('stack sorted', () => expect(wheelValues({type:'stack',weights:[15,5,10]})).toEqual([5,10,15]));
test('plate from base', () => {
  const v = wheelValues({type:'plate',base:62,step:2.5});
  expect(v.slice(0,3)).toEqual([62,64.5,67]); expect(v.at(-1)).toBe(462);
});
test('dumbbell', () => {
  const v = wheelValues(DUMBBELL_LOADING);
  expect(v.slice(0,12)).toEqual([1,2,3,4,5,6,7,8,9,10,12,14]); expect(v.at(-1)).toBe(60);
});
test('barbell loads plates in pairs from a 20 kg bar', () => {
  const v = wheelValues(BARBELL_LOADING); expect(v.slice(0,2)).toEqual([20,25]); expect(v.at(-1)).toBe(420);
});
test('free preset intervals', () => {
  const v = wheelValues({ type: 'free', start: 20, step: 2.5, max: 300 }); expect(v.slice(0,2)).toEqual([20,22.5]); expect(v.at(-1)).toBe(300);
});

describe('plates', () => {
  const pairs = { type: 'plates' as const, base: 20, plates: [2.5, 5, 10, 15, 20, 25], sides: 2 as const };
  test('plateTotal adds each plate on both sides', () => {
    expect(plateTotal(pairs, [])).toBe(20);
    expect(plateTotal(pairs, [25, 10, 2.5])).toBe(95);
    expect(plateTotal({ ...pairs, base: 50, sides: 1 }, [20, 5])).toBe(75);
  });
  test('platesFor picks the heaviest plates first and reports what is left over', () => {
    expect(platesFor(pairs, 100)).toEqual({ plates: [25, 15], rest: 0 });
    expect(platesFor(pairs, 20)).toEqual({ plates: [], rest: 0 });
    expect(platesFor(pairs, 10)).toEqual({ plates: [], rest: 0 });
    expect(platesFor(pairs, 62.5)).toEqual({ plates: [20], rest: 1.25 });
    expect(platesFor({ ...pairs, sides: 1 }, 47.5)).toEqual({ plates: [25, 2.5], rest: 0 });
  });
  test('wheel steps by the smallest pair', () => {
    expect(wheelValues(pairs).slice(0, 3)).toEqual([20, 25, 30]);
    expect(wheelValues({ ...pairs, sides: 1 }).slice(0, 3)).toEqual([20, 22.5, 25]);
  });
});
test('bodyweight', () => { const v = wheelValues(BODYWEIGHT_LOADING); expect(v.slice(0,3)).toEqual([0,2.5,5]); expect(v.at(-1)).toBe(100); });
test('snap', () => { expect(snapToWheel([5,10,15],12)).toBe(10); expect(snapToWheel([5,10,15],13)).toBe(15); expect(snapToWheel([5,10,15],12.5)).toBe(15); });
test('parseWeightInput', () => {
  expect(parseWeightInput('62,5')).toBe(62.5); expect(parseWeightInput(' 70 ')).toBe(70);
  expect(parseWeightInput('0')).toBe(0); expect(parseWeightInput('-5')).toBeNull(); expect(parseWeightInput('abc')).toBeNull();
  expect(parseWeightInput('')).toBeNull();
});
test('parseRepsInput', () => {
  expect(parseRepsInput('8')).toBe(8); expect(parseRepsInput('8.5')).toBeNull(); expect(parseRepsInput('0')).toBeNull();
});
test('non-positive steps do not hang and yield a single value', () => {
  for (const step of [0, -2.5]) {
    expect(wheelValues({ type: 'plate', base: 62, step })).toEqual([62]);
    expect(wheelValues({ type: 'free', start: 20, step, max: 300 })).toEqual([20]);
    expect(wheelValues({ type: 'free', start: 1, step: 1, max: 60, bigStepFrom: 10, bigStep: step })).toEqual([1]);
    expect(wheelValues({ type: 'bodyweight', step, max: 100 })).toEqual([0]);
  }
});

test('sameLoading is a deep equality, independent of key order', () => {
  expect(sameLoading({ type: 'plate', base: 62, step: 2.5 }, { step: 2.5, base: 62, type: 'plate' })).toBe(true);
  expect(sameLoading({ type: 'plate', base: 62, step: 2.5 }, { type: 'plate', base: 60, step: 2.5 })).toBe(false);
  expect(sameLoading({ type: 'stack', weights: [5, 10] }, { type: 'stack', weights: [5, 10] })).toBe(true);
  expect(sameLoading({ type: 'stack', weights: [5, 10] }, { type: 'stack', weights: [5, 10, 15] })).toBe(false);
  expect(sameLoading({ type: 'stack', weights: [5, 10] }, { type: 'stack', weights: [5, 10], unit: 'level' })).toBe(false);
  expect(sameLoading({ type: 'stack', weights: [1] }, { type: 'plate', base: 1, step: 1 })).toBe(false);
});
