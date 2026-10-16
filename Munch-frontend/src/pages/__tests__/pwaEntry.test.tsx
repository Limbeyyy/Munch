import fs from 'fs';
import path from 'path';
import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Navigate, Route, Routes } from 'react-router-dom';

/**
 * Where an installed app opens, and what happens to anything else.
 *
 * The manifest said `/attendee`. No such route has ever existed, and
 * there was no catch-all either - so the installed app opened on a
 * path the router did not know, matched nothing, and drew a white
 * screen. Nothing in the log said so: the server answers a navigation
 * with index.html whatever the path, so every request was a 200 and
 * the app loaded perfectly before rendering nothing.
 *
 * The browser never opens that start_url, so no rendering test could
 * have caught it. What was wrong was the agreement between a JSON file
 * and a route table, so that is what is checked.
 */
const read = (where: string) =>
  fs.readFileSync(path.join(__dirname, '..', '..', '..', where), 'utf8');

const manifest = JSON.parse(read('public/manifest.json'));
const appSource = read('src/App.tsx');

/** Every path the route table declares. */
const routePaths = Array.from(appSource.matchAll(/<Route\s+path="([^"]+)"/g))
  .map((hit) => hit[1]);

describe('the route table', () => {
  /* If this ever finds nothing the two tests below would pass on an
     empty list, which would be worse than failing. */
  it('is where this test thinks it is', () => {
    expect(routePaths.length).toBeGreaterThan(10);
    expect(routePaths).toContain('/login');
  });

  it('answers anything it does not know, rather than drawing nothing', () => {
    expect(routePaths).toContain('*');
  });
});

describe('where an installed app opens', () => {
  it('opens on a path the router actually has', () => {
    const start: string = manifest.start_url;

    expect(start).toBeTruthy();
    // No parameters here: a start_url cannot fill one in.
    expect(start).not.toContain(':');
    expect(routePaths).toContain(start);
  });

  /** It is the attendee app that is installed - the manifest says so. */
  it('opens on the attendee app', () => {
    expect(manifest.start_url).toBe('/app');
    expect(manifest.name).toMatch(/attending/i);
  });

  it('stays inside the scope it declares', () => {
    expect(manifest.start_url.startsWith(manifest.scope)).toBe(true);
  });
});

describe('a path nobody routes', () => {
  const show = (at: string) =>
    render(
      <MemoryRouter initialEntries={[at]}>
        <Routes>
          <Route path="/" element={<p>the way in</p>} />
          <Route path="/app" element={<p>attendee app</p>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </MemoryRouter>
    );

  it('lands on the way in instead of a blank page', async () => {
    show('/attendee');

    expect(await screen.findByText('the way in')).toBeInTheDocument();
  });

  it('does the same for a stale link or a typo', async () => {
    show('/organiser');

    expect(await screen.findByText('the way in')).toBeInTheDocument();
  });

  it('leaves a path that is routed alone', async () => {
    show('/app');

    expect(await screen.findByText('attendee app')).toBeInTheDocument();
  });
});
