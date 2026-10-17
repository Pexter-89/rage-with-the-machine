import { wheelValues, snapToWheel, parseWeightInput, parseRepsInput, sameLoading } from './loading';
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
test('barbell', () => { const v = wheelValues(BARBELL_LOADING); expect(v.slice(0,2)).toEqual([20,22.5]); expect(v.at(-1)).toBe(300); });
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
