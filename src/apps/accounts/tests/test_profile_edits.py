"""What somebody may change about themselves, and what they may not.

Google supplies a name and a picture at sign-in. This table has owned
them since, so editing one here changes nothing about the Google
account - which is the point: somebody who wants a different
photograph on their badge should not have to go and change their
Google profile to get one.

The address is different. It is what the account is identified by and
what an invitation is matched against, so it stays read only.
"""
from django.contrib.auth import get_user_model
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APITestCase

User = get_user_model()
PROFILE = '/api/v1/users/profile/'

#: The smallest valid PNG, so the image field has something real to take.
PNG = bytes.fromhex(
    '89504e470d0a1a0a0000000d4948445200000001000000010802000000907753'
    'de0000000c49444154789c63e0129103000068003d5408a3f70000000049454e'
    '44ae426082'
)


def a_photo(name='me.png'):
    return SimpleUploadedFile(name, PNG, content_type='image/png')


class WhatSomebodyMayChangeTests(APITestCase):
    def setUp(self):
        self.me = User.objects.create_user(
            username='me', email='me@gmail.com', password='pw',
            first_name='Sumin', last_name='Maharjan',
            avatar_url='https://lh3.googleusercontent.com/seeded',
        )
        self.client.force_authenticate(self.me)

    # --- the name -----------------------------------------------------

    def test_the_name_can_be_changed(self):
        answer = self.client.patch(
            PROFILE, {'first_name': 'Sumin K', 'last_name': 'Shrestha'},
            format='json',
        )

        self.assertEqual(answer.status_code, 200, answer.content)
        self.me.refresh_from_db()
        self.assertEqual(self.me.first_name, 'Sumin K')
        self.assertEqual(self.me.last_name, 'Shrestha')

    # --- the address --------------------------------------------------

    def test_the_address_cannot_be(self):
        self.client.patch(
            PROFILE, {'email': 'someone.else@gmail.com'}, format='json'
        )

        self.me.refresh_from_db()
        self.assertEqual(self.me.email, 'me@gmail.com')

    def test_and_sending_one_does_not_stop_the_rest_going_through(self):
        self.client.patch(
            PROFILE,
            {'email': 'someone.else@gmail.com', 'first_name': 'Sumin K'},
            format='json',
        )

        self.me.refresh_from_db()
        self.assertEqual(self.me.email, 'me@gmail.com')
        self.assertEqual(self.me.first_name, 'Sumin K')

    # --- the picture --------------------------------------------------

    def test_google_s_picture_is_what_is_shown_to_begin_with(self):
        body = self.client.get(PROFILE).json()

        self.assertEqual(
            body['avatar_url'], 'https://lh3.googleusercontent.com/seeded'
        )

    def test_their_own_can_be_put_up(self):
        answer = self.client.patch(
            PROFILE, {'avatar': a_photo()}, format='multipart'
        )

        self.assertEqual(answer.status_code, 200, answer.content)
        self.me.refresh_from_db()
        self.assertTrue(self.me.avatar)

    def test_and_is_shown_instead_of_google_s(self):
        self.client.patch(PROFILE, {'avatar': a_photo()}, format='multipart')

        body = self.client.get(PROFILE).json()

        self.assertNotIn('googleusercontent', body['avatar_url'])
        self.assertIn('avatars/', body['avatar_url'])

    def test_without_overwriting_what_google_gave(self):
        """So taking theirs down falls back to Google, not to nothing."""
        self.client.patch(PROFILE, {'avatar': a_photo()}, format='multipart')

        self.me.refresh_from_db()
        self.assertEqual(
            self.me.avatar_url, 'https://lh3.googleusercontent.com/seeded'
        )

    def test_an_address_cannot_be_written_in_as_the_picture(self):
        """The field takes a file. A URL would let anything be pointed at."""
        self.client.patch(
            PROFILE, {'avatar_url': 'https://evil.example/x.png'},
            format='json',
        )

        self.me.refresh_from_db()
        self.assertEqual(
            self.me.avatar_url, 'https://lh3.googleusercontent.com/seeded'
        )

    def test_it_comes_back_as_a_whole_address(self):
        self.client.patch(PROFILE, {'avatar': a_photo()}, format='multipart')

        body = self.client.get(PROFILE).json()

        self.assertTrue(body['avatar_url'].startswith('http'))

    # --- somebody else -------------------------------------------------

    def test_a_stranger_cannot_change_anything(self):
        self.client.force_authenticate(None)

        answer = self.client.patch(
            PROFILE, {'first_name': 'Nobody'}, format='json'
        )

        self.assertIn(answer.status_code, (401, 403))
