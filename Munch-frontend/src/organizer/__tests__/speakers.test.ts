import { groupBySpeaker, speakerKey } from '../speakers';

const named = (speaker_name: string, email?: string) => ({
  speaker_name,
  speaker_contact: email ? { email, phone: '' } : null,
});

describe('who counts as one speaker', () => {
  it('ignores a session with nobody named', () => {
    expect(speakerKey(named(''))).toBeNull();
    expect(speakerKey({ speaker_name: undefined })).toBeNull();
  });

  it('treats two slots by the same person as one speaker', () => {
    const rows = [named('Surya Chandra Adhikari', 'a@x.com'),
                  named('Surya Chandra Adhikari', 'a@x.com')];
    expect(groupBySpeaker(rows, (r) => r)).toHaveLength(1);
  });

  it('keeps two people apart when they share a contact address', () => {
    // The reported inconsistency: the organizer had typed one address for
    // both speakers, so one screen said one speaker and the other said two.
    const rows = [named('Surya Chandra Adhikari', 'tithighadi@gmail.com'),
                  named('Manmohan Aeir', 'tithighadi@gmail.com')];

    const found = groupBySpeaker(rows, (r) => r);

    expect(found.map((s) => s.name)).toEqual([
      'Surya Chandra Adhikari',
      'Manmohan Aeir',
    ]);
  });

  it('keeps two people apart when they share a name but not an address', () => {
    const rows = [named('Ram Bahadur', 'ram@x.com'), named('Ram Bahadur', 'ram2@x.com')];
    expect(groupBySpeaker(rows, (r) => r)).toHaveLength(2);
  });

  it('matches a name and address whatever their case or padding', () => {
    const rows = [named('Surya Chandra Adhikari', 'A@X.com'),
                  named('  surya chandra adhikari  ', 'a@x.com ')];
    expect(groupBySpeaker(rows, (r) => r)).toHaveLength(1);
  });

  it('groups somebody with no address on file by name alone', () => {
    const rows = [named('Laxman Rimal'), named('Laxman Rimal')];
    expect(groupBySpeaker(rows, (r) => r)).toHaveLength(1);
  });

  it('keeps the order they first appear in the day', () => {
    const rows = [named('Second', 'b@x.com'), named('First', 'a@x.com'),
                  named('Second', 'b@x.com')];

    const found = groupBySpeaker(rows, (r) => r);

    expect(found.map((s) => s.name)).toEqual(['Second', 'First']);
    expect(found[0].rows).toHaveLength(2);
  });
});
