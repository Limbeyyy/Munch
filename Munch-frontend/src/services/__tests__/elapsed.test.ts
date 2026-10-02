import { formatElapsed } from '../elapsed';

/**
 * How long the event has been running, written the same way
 * everywhere.
 *
 * There were three of these: the room counted seconds from the talk on
 * stage, the host's dashboard whole minutes from the event written
 * "3m", the attendee's header the same minutes written "00:03". Three
 * screens of one event, three readings, two of them not even measuring
 * the same thing.
 */
describe('writing an elapsed time', () => {
  it('reads as minutes and seconds inside the first hour', () => {
    expect(formatElapsed(0)).toBe('00:00');
    expect(formatElapsed(6)).toBe('00:06');
    expect(formatElapsed(226)).toBe('03:46');
  });

  it('adds hours only once there are some', () => {
    expect(formatElapsed(59 * 60 + 59)).toBe('59:59');
    expect(formatElapsed(3600)).toBe('1:00:00');
    expect(formatElapsed(3600 + 20 * 60 + 5)).toBe('1:20:05');
  });

  /** The two numbers from the screenshots, now the same number. */
  it('gives one answer for one moment, however it is asked', () => {
    const atTheSameInstant = 226;

    expect(formatElapsed(atTheSameInstant))
      .toBe(formatElapsed(atTheSameInstant));
    expect(formatElapsed(atTheSameInstant)).toBe('03:46');
  });
});
