import { apiClient } from '../../services/api';
import { ensureSingleLiveEvent } from '../ensureSingleLiveEvent';

jest.mock('../../services/api', () => ({
  apiClient: { getActiveEvents: jest.fn() },
}));

const getActiveEvents = apiClient.getActiveEvents as jest.Mock;

describe('ensureSingleLiveEvent', () => {
  beforeEach(() => jest.clearAllMocks());

  it('throws before starting when the host owns another live event', async () => {
    getActiveEvents.mockResolvedValue([{
      id: 'other',
      title: 'Already live',
      host: { id: 'host-1' },
    }]);

    await expect(ensureSingleLiveEvent('target', 'host-1'))
      .rejects.toThrow('You are already hosting "Already live"');
  });

  it('allows the same event and live events owned by other hosts', async () => {
    getActiveEvents.mockResolvedValue([
      { id: 'target', title: 'Current', host: { id: 'host-1' } },
      { id: 'other', title: 'Somebody else', host: { id: 'host-2' } },
    ]);

    await expect(ensureSingleLiveEvent('target', 'host-1')).resolves.toBeUndefined();
  });
});
