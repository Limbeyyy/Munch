import { doorway, howFarOff, ENTRY_WINDOW_MINUTES } from '../sessionState';

const MIN = 60000;
const NOW = +new Date('2026-09-08T09:00:00Z');
const at = (minutesFromNow: number) => new Date(NOW + minutesFromNow * MIN).toISOString();

describe('when a screen may offer the room', () => {
  it('opens a quarter of an hour before the session', () => {
    const door = doorway(at(ENTRY_WINDOW_MINUTES), NOW);

    expect(door.canEnter).toBe(true);
    expect(door.canStart).toBe(false);
  });

  it('is shut a minute before that', () => {
    const door = doorway(at(ENTRY_WINDOW_MINUTES + 1), NOW);

    expect(door.canEnter).toBe(false);
    expect(door.untilOpen).toBe(1);
  });

  it('is shut for something eight hours away', () => {
    expect(doorway(at(8 * 60), NOW).canEnter).toBe(false);
  });

  it('allows starting only once the session has come round', () => {
    expect(doorway(at(1), NOW).canStart).toBe(false);
    expect(doorway(at(0), NOW).canStart).toBe(true);
    expect(doorway(at(-1), NOW).canStart).toBe(true);
  });

  it('never refuses somebody who is late', () => {
    const door = doorway(at(-90), NOW);

    expect(door.canEnter).toBe(true);
    expect(door.canStart).toBe(true);
  });

  it('offers nothing for a session with no time at all', () => {
    const door = doorway(null, NOW);

    expect(door.canEnter).toBe(false);
    expect(door.canStart).toBe(false);
  });
});

describe('saying how far off something is', () => {
  it('counts minutes within the hour', () => {
    expect(howFarOff(at(9), NOW)).toEqual({ amount: 9, unit: 'minute' });
  });

  it('counts hours beyond it', () => {
    expect(howFarOff(at(8 * 60), NOW)).toEqual({ amount: 8, unit: 'hour' });
  });

  it('counts days beyond that', () => {
    expect(howFarOff(at(3 * 24 * 60), NOW)).toEqual({ amount: 3, unit: 'day' });
  });

  it('does not count backwards for something already begun', () => {
    expect(howFarOff(at(-40), NOW)).toEqual({ amount: 0, unit: 'minute' });
  });
});
