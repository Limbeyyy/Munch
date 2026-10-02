import React from 'react';
import { render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { LoginPage } from '../LoginPage';
import { apiClient } from '../../services/api';
import { useAuthStore } from '../../store/authStore';

/**
 * Nothing is taken up until the sign-in has actually finished.
 *
 * Arriving at a desk now makes somebody a host, which is a real thing
 * to become - so it has to wait for the whole of Google's round trip
 * to come back good. An exchange that fails, or that somebody
 * abandons, must leave the account exactly as it was.
 */
jest.mock('../../services/api', () => ({
  apiClient: {
    googleConnect: jest.fn(),
    googleCallback: jest.fn(),
    getMyRoles: jest.fn(),
    startHosting: jest.fn(),
    guestKnock: jest.fn(),
    hasSession: jest.fn(() => false),
  },
}));

jest.mock('react-hot-toast', () => ({
  __esModule: true,
  default: { error: jest.fn(), success: jest.fn(), loading: jest.fn(), dismiss: jest.fn() },
}));


const show = (href: string) =>
  render(
    <MemoryRouter initialEntries={[href]}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/" element={<p>past the gate</p>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  window.sessionStorage.clear();
  useAuthStore.setState({
    user: null, isAuthenticated: false, isLoading: false, ready: true,
  } as any);
});

/*
 * There is no case here for "it stays on the sign-in page". Whether
 * the router moves cannot be told apart from whether it has not moved
 * *yet* in this harness - the assertion passed just as readily with a
 * navigate() wired into the failure path - so it would have been a
 * test that looked like cover and was not. What matters is below:
 * nothing is taken up, and nothing is marked as finished.
 */
describe('an exchange that does not come back good', () => {
  it('takes up no hosting on the way past', async () => {
    (apiClient.googleCallback as jest.Mock).mockRejectedValue(
      new Error('invalid_grant')
    );

    show('/login?code=abc123');

    await waitFor(() => expect(apiClient.googleCallback).toHaveBeenCalled());
    expect(apiClient.startHosting).not.toHaveBeenCalled();
  });

  /** The mark is what tells the next screen a sign-in just happened. */
  it('leaves no sign saying one just finished', async () => {
    (apiClient.googleCallback as jest.Mock).mockRejectedValue(
      new Error('invalid_grant')
    );

    show('/login?code=abc123');

    await waitFor(() => expect(apiClient.googleCallback).toHaveBeenCalled());
    expect(window.sessionStorage.getItem('manch.justSignedIn')).toBeNull();
  });
});

describe('an exchange that never happens', () => {
  /** Somebody who opens the page and walks away. */
  it('takes up nothing at all', async () => {
    show('/login');

    await waitFor(() => expect(apiClient.googleCallback).not.toHaveBeenCalled());
    expect(apiClient.startHosting).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem('manch.justSignedIn')).toBeNull();
  });
});
