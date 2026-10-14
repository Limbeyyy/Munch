import axios from 'axios';
import { apiClient } from '../api';

/**
 * Where the turnout figures are asked for.
 *
 * There were two methods for one question. `getAttendance` asked the
 * event's own endpoint and `getAttendanceReport` asked
 * `/admin/attendance/<id>/`, which no longer exists: it answered 404,
 * both callers swallow a failure and fall back to zero, and so an event
 * with four invited and one who came reported "0/0, 0%" on its summary
 * and on its moderation card while the attendance screen - reading the
 * live endpoint - had the same event right.
 *
 * Nothing in those two screens could catch it, because both mock the
 * client. The address itself was the thing that was wrong, so the
 * address is what is pinned here.
 */
jest.mock('axios', () => {
  const client = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
  };
  return {
    __esModule: true,
    // Held where the test can reach it: create-react-app turns
    // resetMocks on, which strips every implementation before each
    // test, so they are put back below rather than here.
    __client: client,
    default: { create: () => client, get: jest.fn(), post: jest.fn() },
  };
});

const client = (axios as any).__client ?? (jest.requireMock('axios') as any).__client;

const asked: string[] = [];

beforeEach(() => {
  asked.length = 0;
  client.get.mockImplementation((url: string) => {
    asked.push(url);
    return Promise.resolve({ data: {} });
  });
});

describe('where the turnout is asked for', () => {
  it('asks the event, not an admin route that is not there', async () => {
    await apiClient.getAttendanceReport('e1');

    expect(asked).toEqual(['/events/e1/attendance/']);
  });

  /*
   * One question, so one answer.
   *
   * A second address is a second thing to keep right, and that is
   * exactly how these two drifted apart.
   */
  it('asks for the same thing the attendance screen asks for', async () => {
    await apiClient.getAttendanceReport('e1');
    const viaReport = [...asked];

    asked.length = 0;
    await apiClient.getAttendance('e1');

    expect(viaReport).toEqual(asked);
  });
});
