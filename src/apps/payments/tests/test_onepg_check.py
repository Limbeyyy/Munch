"""The things that look right in a .env file and are not.

"Signature Not Valid" is the gateway's answer to several different
mistakes and names none of them, so the check has to name them
instead.
"""
from django.test import TestCase

from src.apps.payments.management.commands.onepg_check import mask, suspicious


class WhatLooksRightAndIsNotTests(TestCase):
    def test_an_inline_comment_is_part_of_the_value(self):
        """The same trap that took LOG_LEVEL down.

        An .env file does not strip them, so the secret becomes the
        secret plus a sentence about the secret - and hashes to
        something the gateway has never seen.
        """
        notes = suspicious('abc123  # the hmac key from the email')

        self.assertTrue(any('#' in n for n in notes))

    def test_so_are_surrounding_quotes(self):
        notes = suspicious('"abc123"')

        self.assertTrue(any('quotes' in n for n in notes))

    def test_and_trailing_whitespace(self):
        notes = suspicious('abc123   ')

        self.assertTrue(any('whitespace' in n for n in notes))

    def test_an_ordinary_secret_raises_nothing(self):
        self.assertEqual(suspicious('aB3dEf9hJk2mNp5q'), [])

    def test_a_secret_is_never_printed_whole(self):
        shown = mask('super-secret-signing-key')

        self.assertNotIn('secret-signing', shown)
        self.assertTrue(shown.startswith('supe'))

    def test_and_a_short_one_shows_only_its_first_character(self):
        self.assertEqual(mask('abcd'), 'a***')

    def test_an_empty_one_says_so_rather_than_looking_set(self):
        self.assertEqual(mask(''), '(empty)')
