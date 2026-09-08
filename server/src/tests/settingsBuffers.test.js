const { buffers } = require('../services/settings.service');
const { DEFAULT_STRATEGY_ID } = require('../services/geofenceLogic.service');

describe('settings.service buffers()', () => {
  test('passes through admin-configured near/far distances and strategy ids', () => {
    const result = buffers({
      nearBufferM: 30,
      farBufferM: 200,
      nearBufferLogic: 'any_point_within',
      farBufferLogic: 'best_accuracy_fix',
    });
    expect(result).toEqual({
      nearBufferM: 30,
      farBufferM: 200,
      nearBufferLogic: 'any_point_within',
      farBufferLogic: 'best_accuracy_fix',
    });
  });

  test('defaults nearBufferM/farBufferM to 50/100 when missing or non-finite', () => {
    expect(buffers({})).toMatchObject({ nearBufferM: 50, farBufferM: 100 });
    expect(buffers({ nearBufferM: null, farBufferM: undefined })).toMatchObject({
      nearBufferM: 50, farBufferM: 100,
    });
    expect(buffers({ nearBufferM: NaN, farBufferM: 'not a number' })).toMatchObject({
      nearBufferM: 50, farBufferM: 100,
    });
  });

  // An admin could otherwise misconfigure farBufferM < nearBufferM, which would make
  // the far band strictly narrower than the near band it's supposed to contain.
  test('clamps farBufferM up to nearBufferM when an admin sets far below near', () => {
    const result = buffers({ nearBufferM: 150, farBufferM: 80 });
    expect(result.nearBufferM).toBe(150);
    expect(result.farBufferM).toBe(150);
  });

  test('leaves farBufferM untouched when it is already >= nearBufferM', () => {
    expect(buffers({ nearBufferM: 50, farBufferM: 50 }).farBufferM).toBe(50);
    expect(buffers({ nearBufferM: 50, farBufferM: 100 }).farBufferM).toBe(100);
  });

  test('falls back to the default strategy id for each band when unset', () => {
    const result = buffers({ nearBufferM: 50, farBufferM: 100 });
    expect(result.nearBufferLogic).toBe(DEFAULT_STRATEGY_ID);
    expect(result.farBufferLogic).toBe(DEFAULT_STRATEGY_ID);
  });

  test('falls back to the default strategy id for an empty-string id', () => {
    const result = buffers({
      nearBufferM: 50, farBufferM: 100, nearBufferLogic: '', farBufferLogic: '',
    });
    expect(result.nearBufferLogic).toBe(DEFAULT_STRATEGY_ID);
    expect(result.farBufferLogic).toBe(DEFAULT_STRATEGY_ID);
  });

  // buffers() itself doesn't validate the id against STRATEGIES — that happens one
  // layer down, in geofenceLogic.service.evaluate(), which falls back to the default
  // for any id it doesn't recognize (e.g. saved before a strategy was renamed/removed).
  test('passes an unrecognized strategy id through unchanged (validated downstream)', () => {
    const result = buffers({ nearBufferM: 50, farBufferM: 100, nearBufferLogic: 'not_a_real_strategy' });
    expect(result.nearBufferLogic).toBe('not_a_real_strategy');
  });
});
