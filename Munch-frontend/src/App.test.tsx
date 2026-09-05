import React from 'react';
import { render, screen } from '@testing-library/react';
import App from './App';

test('a visitor who is not signed in lands on the sign-in screen', () => {
  render(<App />);
  expect(screen.getByText(/Meeting & Agenda Network/i)).toBeInTheDocument();
});
