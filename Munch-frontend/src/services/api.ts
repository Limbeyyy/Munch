import axios, { AxiosInstance, AxiosError } from 'axios';
import { User, Event, AuthTokens, Transcript, TranscriptSummary, Artifact, Recording, Organization, Team, OrganizationMember, OrganizationInvite, SubscriptionData, Invoice, PaymentMethod, DriveFile, DriveSyncStatus, OrganizationAnalytics, ChatSettings, ChatMessage, EventParticipant, GuestAttendee, GuestSession, EventInviteList, AttendanceReport, ChatPerson, GuestResource, TranscriptionSegment, EventDraft, Session, SessionDraft, SessionAttendanceRow, SpeakerContact, ContactRequestRow, UserRoles, ProfileSummary, ReminderPage, EventPhoto, PhotoFolder, PhotoPage, ConclusionAction, ConclusionPage, SchedulingPrefs, SheetExport, UpgradeRequestRow, ResourceVisibility, HubBoard, HubKind, HubPost, SessionSummary, EventBoard, MessageTopic, ProgrammeRoles, RoleGrantRow, RoleScope } from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';
const PAYMENT_API_ROOT = API_BASE_URL.replace(/\/api\/v1\/?$/, '');

class ApiClient {
  private client: AxiosInstance;
  private accessToken: string | null = null;
  private refreshToken: string | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: API_BASE_URL,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    this.client.interceptors.request.use((config) => {
      if (this.accessToken) {
        config.headers.Authorization = `Bearer ${this.accessToken}`;
      }
      return config;
    });

    this.client.interceptors.response.use(
      (response) => response,
      async (error: AxiosError) => {
        const original = error.config as (typeof error.config & { _retried?: boolean });

        // Only a 401 is worth renewing for, only once per request, and only
        // if there is something to renew with. Retrying a request that
        // already came back 401 on a fresh token would loop.
        if (
          error.response?.status !== 401 ||
          !original ||
          original._retried ||
          !this.refreshToken
        ) {
          return Promise.reject(error);
        }

        try {
          await this.renewSession();
        } catch {
          // The session really is over. Drop the tokens so the app stops
          // pretending otherwise, and let the caller see the 401.
          this.clearTokens();
          return Promise.reject(error);
        }

        original._retried = true;
        return this.client(original);
      }
    );

    this.loadTokens();
  }

  /**
   * Get a new access token, once, however many requests are waiting.
   *
   * Refresh tokens rotate and the one they replace is revoked, so several
   * requests each renewing on their own would race: the first would
   * succeed and retire the token the others were about to present. They
   * all wait on the same attempt instead.
   */
  private renewing: Promise<void> | null = null;

  private renewSession(): Promise<void> {
    if (this.renewing) return this.renewing;

    this.renewing = (async () => {
      const presented = this.refreshToken;
      // A bare client: the refresh call must not carry the expired token,
      // and must not come back through this interceptor.
      const { data } = await axios.post(
        `${API_BASE_URL}/auth/token_refresh/`,
        { refresh: presented },
        { headers: { 'Content-Type': 'application/json' } }
      );
      // Rotation hands back a new refresh token, and the old one is dead
      // the moment it does. Keeping the old one was why sessions ended
      // after a single renewal.
      this.setTokens(data.access, data.refresh ?? presented);
    })().finally(() => {
      this.renewing = null;
    });

    return this.renewing;
  }

  /** Whether there is a stored session worth trying to restore. */
  hasSession(): boolean {
    return !!this.refreshToken;
  }

  private loadTokens() {
    this.accessToken = localStorage.getItem('access_token');
    this.refreshToken = localStorage.getItem('refresh_token');
  }

  setTokens(access: string, refresh: string) {
    this.accessToken = access;
    this.refreshToken = refresh;
    localStorage.setItem('access_token', access);
    localStorage.setItem('refresh_token', refresh);
  }

  private clearTokens() {
    this.accessToken = null;
    this.refreshToken = null;
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
  }

  // Auth endpoints
  async googleConnect(redirectUri: string): Promise<{ auth_url: string }> {
    const response = await this.client.post('/auth/google_connect/', { redirect_uri: redirectUri });
    return response.data;
  }

  async googleCallback(code: string, redirectUri: string, state?: string): Promise<AuthTokens & { user: User }> {
    const response = await this.client.post('/auth/google_callback/', {
      code,
      redirect_uri: redirectUri,
      state,
    });
    return response.data;
  }

  async getCurrentUser(): Promise<User> {
    const response = await this.client.get('/users/profile/');
    return response.data;
  }

  /** What this person may do here: host, attend, or both. */
  async getMyRoles(): Promise<UserRoles> {
    const response = await this.client.get('/users/roles/');
    return response.data;
  }

  /** Take up the free trial and become a host. */
  async startHosting(): Promise<UserRoles> {
    const response = await this.client.post('/users/start_hosting/');
    return response.data;
  }

  /**
   * Save a rearranged day in one request.
   *
   * One transaction rather than a patch per session, so a second organizer
   * saving at the same moment cannot interleave into an overlap.
   */
  async rescheduleSessions(
    changes: { id: string; starts_at?: string; duration_minutes?: number; hall?: string }[]
  ): Promise<{ moved: Session[]; moved_count: number }> {
    const response = await this.client.post('/sessions/reschedule/', { changes });
    return response.data;
  }

  /** Who helps run a programme, and over how much of it. */
  async getProgrammeRoles(eventId: string): Promise<ProgrammeRoles> {
    const response = await this.client.get(`/events/${eventId}/roles/`);
    return response.data;
  }

  /**
   * Give somebody a role over one part of the programme.
   *
   * The scope decides how far it reaches: the whole event, one event, or
   * a single session. Nothing spreads to a sibling.
   */
  async grantRole(
    eventId: string,
    grant: { email: string; role: 'co_host' | 'presenter'; scope: RoleScope; scope_id?: string }
  ): Promise<RoleGrantRow> {
    const response = await this.client.post(`/events/${eventId}/roles/`, grant);
    return response.data;
  }

  async revokeRole(eventId: string, grantId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}/roles/`, { data: { id: grantId } });
  }

  /** The questions and suggestions the host has put up. */
  async getEventBoard(eventId: string): Promise<EventBoard> {
    const response = await this.client.get(`/events/${eventId}/board/`);
    return response.data;
  }

  /** The same board, for a guest holding a event token. */
  async getGuestBoard(token: string): Promise<EventBoard> {
    const response = await this.client.get('/events/guest/board/', {
      params: { token },
    });
    return response.data;
  }

  /**
   * Put a message on the board, or take it off.
   *
   * This publishes: everyone in the event reads the board, so a direct
   * message sorted onto it stops being private.
   */
  async sortMessage(
    eventId: string,
    messageId: string,
    topic: MessageTopic
  ): Promise<ChatMessage> {
    const response = await this.client.post(`/events/${eventId}/sort_message/`, {
      message_id: messageId,
      topic,
    });
    return response.data;
  }

  /**
   * A session's summary. Unwritten, this comes back as a draft of the
   * transcript, which is what somebody writing one starts from.
   */
  async getSessionSummary(sessionId: string): Promise<SessionSummary> {
    const response = await this.client.get(`/sessions/${sessionId}/summary/`);
    return response.data;
  }

  async saveSessionSummary(
    sessionId: string, body: string, actions?: ConclusionAction[]
  ): Promise<SessionSummary> {
    const response = await this.client.put(`/sessions/${sessionId}/summary/`, {
      body,
      ...(actions ? { actions } : {}),
    });
    return response.data;
  }

  /** Let a summary out to everyone who was in the session. */
  async publishSessionSummary(sessionId: string): Promise<SessionSummary> {
    const response = await this.client.post(`/sessions/${sessionId}/publish_summary/`);
    return response.data;
  }

  /**
   * Direct messages the host has let through, split by who sent them.
   *
   * The record of what was passed on: account holders are answered in one
   * place and guests in another.
   */
  async getReviewedMessages(
    eventId: string
  ): Promise<{ from_users: ChatMessage[]; from_guests: ChatMessage[] }> {
    const response = await this.client.get(`/events/${eventId}/reviewed_messages/`);
    return response.data;
  }

  /**
   * The attendee hub. Guests pass their token; account holders their JWT.
   */
  async getHub(eventCode: string, guestToken?: string): Promise<HubBoard> {
    const response = await this.client.get(`/events/${eventCode}/hub/`, {
      params: guestToken ? { guest_token: guestToken } : undefined,
    });
    return response.data;
  }

  async addHubPost(
    eventCode: string,
    post: {
      kind: HubKind;
      body: string;
      category?: string;
      anonymous?: boolean;
      session?: string;
    },
    guestToken?: string
  ): Promise<HubPost> {
    const response = await this.client.post(`/events/${eventCode}/hub/`, {
      ...post,
      ...(guestToken ? { guest_token: guestToken } : {}),
    });
    return response.data;
  }

  /** Vote a post up or down. Pressing the same way again takes it back. */
  async voteHubPost(
    eventCode: string,
    postId: string,
    value: 1 | -1,
    guestToken?: string
  ): Promise<HubPost> {
    const response = await this.client.post(
      `/events/${eventCode}/hub/${postId}/vote/`,
      { value, ...(guestToken ? { guest_token: guestToken } : {}) }
    );
    return response.data;
  }

  /**
   * Answer a question on the board, or change the answer.
   *
   * An empty answer takes it back off, which is why this is not simply an
   * append.
   */
  async answerBoardMessage(
    eventId: string,
    messageId: string,
    answer: string
  ): Promise<ChatMessage> {
    const response = await this.client.post(`/events/${eventId}/answer_message/`, {
      message_id: messageId,
      answer,
    });
    return response.data;
  }

  /**
   * Vote a question or suggestion up or down, or take the vote back.
   *
   * Guests pass their token; account holders their JWT. Both get one vote.
   */
  async voteOnBoard(
    eventId: string,
    messageId: string,
    value: 1 | -1
  ): Promise<EventBoard> {
    const response = await this.client.post(`/events/${eventId}/vote_board/`, {
      message_id: messageId,
      value,
    });
    return response.data;
  }

  async guestVoteOnBoard(
    token: string,
    messageId: string,
    value: 1 | -1
  ): Promise<EventBoard> {
    const response = await this.client.post('/events/guest/board/vote/', {
      token,
      message_id: messageId,
      value,
    });
    return response.data;
  }

  /**
   * Say who may read a shared file, and where it sits in the order.
   *
   * Whoever uploaded it chose to begin with; the organizers change it
   * afterwards, which is the point of having the choice.
   */
  async setResourceSettings(
    eventId: string,
    resourceId: string,
    change: { visibility?: ResourceVisibility; position?: number }
  ): Promise<Artifact> {
    const response = await this.client.post(
      `/events/${eventId}/resource_settings/`,
      { resource_id: resourceId, ...change }
    );
    return response.data;
  }

  /** Who this person is here, and what their plan leaves them. */
  async getProfileSummary(): Promise<ProfileSummary> {
    const response = await this.client.get('/users/profile_summary/');
    return response.data;
  }

  /**
   * Ask to move to a bigger plan.
   *
   * No money changes hands - there is no checkout yet - so this records
   * the ask rather than pretending to charge.
   */
  async requestUpgrade(plan: string, note = ''): Promise<UpgradeRequestRow> {
    const response = await this.client.post('/users/upgrade/', { plan, note });
    return response.data;
  }

  async getUpgradeRequests(): Promise<{ requests: UpgradeRequestRow[] }> {
    const response = await this.client.get('/users/upgrade/');
    return response.data;
  }

  /** The interval this host keeps between sessions. */
  async getSchedulingPrefs(): Promise<SchedulingPrefs> {
    const response = await this.client.get('/users/scheduling/');
    return response.data;
  }

  /** Change one or more of them; what is not sent is left alone. */
  async setSchedulingPrefs(
    patch: Record<string, number | boolean>
  ): Promise<SchedulingPrefs> {
    const response = await this.client.post('/users/scheduling/', patch);
    return response.data;
  }

  async setSessionGap(minutes: number): Promise<SchedulingPrefs> {
    return this.setSchedulingPrefs({ session_gap_minutes: minutes });
  }

  /** What each session settled, and what this reader is owed for. */
  async getConclusions(): Promise<ConclusionPage> {
    const response = await this.client.get('/conclusions/');
    return response.data;
  }

  /**
   * Build a whole programme from a filled-in spreadsheet.
   *
   * ``dryRun`` reads it and says what it would make without making it, so
   * the organizer sees the day before committing to it.
   */
  async importProgrammeSheet(
    file: File, dryRun = false
  ): Promise<{
    dry_run?: boolean;
    created?: Event[];
    programmes: {
      title: string;
      event_date: string;
      venue: string;
      scheduled_start: string;
      sessions: {
        title: string; starts_at: string; duration_minutes: number;
        speaker_name: string; hall: string;
      }[];
    }[];
  }> {
    const body = new FormData();
    body.append('file', file);
    if (dryRun) body.append('dry_run', 'true');
    const response = await this.client.post('/events/import_sheet/', body, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  /** Where the blank template lives, for a plain download link. */
  programmeTemplateUrl(): string {
    return `${this.client.defaults.baseURL}/events/import_template/`;
  }

  /** The blank template, fetched with this person's sign-in. */
  /**
   * The blank programme template.
   *
   * The same three tables either way. The workbook adds the one thing a
   * CSV cannot carry: the sessions table picks its event and event from
   * the ids typed above rather than having them typed again.
   */
  async downloadProgrammeTemplate(shape: 'csv' | 'xlsx' = 'csv'): Promise<Blob> {
    const response = await this.client.get('/events/import_template/', {
      params: shape === 'xlsx' ? { shape: 'xlsx' } : undefined,
      responseType: 'blob',
    });
    return response.data;
  }

  /** The photographs of a event, by folder. */
  async getPhotos(eventRef: string): Promise<PhotoPage> {
    const response = await this.client.get(`/events/${eventRef}/photos/`);
    return response.data;
  }

  async createPhotoFolder(eventRef: string, name: string): Promise<PhotoFolder> {
    const response = await this.client.post(
      `/events/${eventRef}/photos/folders/`, { name }
    );
    return response.data;
  }

  async renamePhotoFolder(
    eventRef: string, folderId: string, name: string
  ): Promise<PhotoFolder> {
    const response = await this.client.post(
      `/events/${eventRef}/photos/folders/${folderId}/`, { name }
    );
    return response.data;
  }

  async deletePhotoFolder(eventRef: string, folderId: string): Promise<void> {
    await this.client.delete(`/events/${eventRef}/photos/folders/${folderId}/`);
  }

  async uploadPhoto(
    eventRef: string, folderId: string, file: File, caption = ''
  ): Promise<EventPhoto> {
    const body = new FormData();
    body.append('file', file);
    if (caption) body.append('caption', caption);
    const response = await this.client.post(
      `/events/${eventRef}/photos/folders/${folderId}/upload/`,
      body,
      { headers: { 'Content-Type': 'multipart/form-data' } }
    );
    return response.data;
  }

  async deletePhoto(photoId: string): Promise<void> {
    await this.client.delete(`/events/photos/${photoId}/file/`);
  }

  /**
   * The photograph itself, as something an <img> can show.
   *
   * Fetched rather than linked: the file is served by this backend on the
   * signed-in request, and an <img src> carries no Authorization header.
   * The caller owns the URL that comes back and must revoke it.
   */
  async getPhotoObjectUrl(photoId: string): Promise<string> {
    const response = await this.client.get(
      `/events/photos/${photoId}/file/`, { responseType: 'blob' }
    );
    return URL.createObjectURL(response.data);
  }

  /**
   * Put a report into this person's own Google Sheets.
   *
   * The rows are the ones on screen, so the sheet says what the reader was
   * shown. The link that comes back opens the file in their Drive.
   */
  async exportToSheet(
    kind: 'attendance' | 'report' | 'analytics',
    rows: (string | number)[][],
    subject = ''
  ): Promise<SheetExport> {
    const response = await this.client.post('/exports/sheet/', { kind, rows, subject });
    return response.data;
  }

  /** What this person is owed a nudge about, with diary links. */
  async getReminders(): Promise<ReminderPage> {
    const response = await this.client.get('/reminders/');
    return response.data;
  }

  async markRemindersRead(id?: string): Promise<{ marked: number }> {
    const response = await this.client.post('/reminders/read/', id ? { id } : {});
    return response.data;
  }

  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout/', {
        refresh: this.refreshToken,
      });
    } finally {
      this.clearTokens();
    }
  }

  // Event endpoints
  async listEventRooms(): Promise<Event[]> {
    const response = await this.client.get('/events/');
    return response.data.results || response.data;
  }

  /** Edit a event in place - used by the organizer's agenda. */
  async updateEventRoom(eventId: string, patch: Partial<Event>): Promise<Event> {
    const response = await this.client.patch(`/events/${eventId}/`, patch);
    return response.data;
  }

  async getActiveEvents(): Promise<Event[]> {
    const response = await this.client.get('/events/active/');
    return response.data;
  }

  async startEvent(eventId: string): Promise<Event> {
    const response = await this.client.post(`/events/${eventId}/start/`);
    return response.data;
  }

  async endEvent(eventId: string): Promise<Event> {
    const response = await this.client.post(`/events/${eventId}/end/`);
    return response.data;
  }

  /** Leave without ending the event for anyone else. */
  async leaveEvent(eventId: string): Promise<void> {
    await this.client.post(`/events/${eventId}/leave/`);
  }

  async joinEvent(eventCode: string, role: string = 'attendee'): Promise<any> {
    const response = await this.client.post(`/events/${eventCode}/join/`, { role });
    return response.data;
  }

  // Events: a day's programme of events, each with its own sessions

  async listEvents(): Promise<Event[]> {
    const response = await this.client.get('/events/');
    return response.data.results || response.data;
  }

  /** An event by its code or its id; the server accepts either. */
  async getEvent(eventCodeOrId: string): Promise<Event> {
    const response = await this.client.get(`/events/${eventCodeOrId}/`);
    return response.data;
  }

  /** Create the whole event at once, with the sessions inside it. */
  async createEvent(data: {
    title: string;
    description?: string;
    venue?: string;
    event_date: string;
    scheduled_start?: string;
    duration_minutes?: number;
    sessions?: SessionDraft[];
  }): Promise<Event> {
    const response = await this.client.post('/events/', data);
    return response.data;
  }

  async updateEvent(eventId: string, patch: Partial<Event>): Promise<Event> {
    const response = await this.client.patch(`/events/${eventId}/`, patch);
    return response.data;
  }

  async deleteEvent(eventId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}/`);
  }

  /**
   * Create a event with the sessions that make it up.
   *
   * Pass an event to file it under a programme, or leave it out and the
   * event stands on its own. Either way it must bring at least one
   * session, which the server enforces.
   */
  /** Who has been asked to this event, and how many have turned up. */
  async getEventInvites(eventId: string): Promise<EventInviteList> {
    const response = await this.client.get(`/events/${eventId}/invites/`);
    return response.data;
  }

  /**
   * Invite people to an event by email.
   *
   * The invitation is what lets them see the event at all, once they sign
   * in with that address. It comes back with the whole list, so a screen
   * showing it does not have to ask again.
   */
  async inviteToEvent(eventId: string, emails: string[]): Promise<EventInviteList> {
    const response = await this.client.post(`/events/${eventId}/invites/`, { emails });
    return response.data;
  }

  /** Take somebody off the list, correcting a headcount rather than living with it. */
  async withdrawEventInvite(eventId: string, email: string): Promise<EventInviteList> {
    const response = await this.client.delete(`/events/${eventId}/invites/`, {
      data: { email },
    });
    return response.data;
  }

  async createEventWithSessions(
    event: EventDraft,
    eventId?: string | null
  ): Promise<Event> {
    const response = await this.client.post('/events/with_sessions/', {
      ...event,
      ...(eventId ? { event: eventId } : {}),
    });
    return response.data;
  }

  /** Add a event, with its running order, to an event that already exists. */
  async addSessionsToEvent(eventId: string, event: EventDraft): Promise<Event> {
    const response = await this.client.post(`/events/${eventId}/events/`, event);
    return response.data;
  }

  // Sessions: the running order inside one event

  /** `eventRef` takes either the event's id or its room code. */
  async listSessions(eventRef: string): Promise<Session[]> {
    const response = await this.client.get('/sessions/', { params: { event: eventRef } });
    return response.data.results || response.data;
  }

  async createSession(data: {
    event: string;
    title: string;
    description?: string;
    speaker_name?: string;
    speaker_role?: string;
    speaker_email?: string;
    speaker_phone?: string;
    speaker_visibility?: 'public' | 'private';
    hall?: string;
    starts_at: string;
    duration_minutes: number;
  }): Promise<Session> {
    const response = await this.client.post('/sessions/', data);
    return response.data;
  }

  async updateSession(sessionId: string, patch: Partial<Session>): Promise<Session> {
    const response = await this.client.patch(`/sessions/${sessionId}/`, patch);
    return response.data;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.client.delete(`/sessions/${sessionId}/`);
  }

  /** Put a session on stage. Any other live session in the event closes. */
  async startSession(sessionId: string): Promise<Session> {
    const response = await this.client.post(`/sessions/${sessionId}/start/`);
    return response.data;
  }

  /** Close a session and record who was in the room for it. */
  async endSession(sessionId: string): Promise<Session & { attendance_recorded: number }> {
    const response = await this.client.post(`/sessions/${sessionId}/end/`);
    return response.data;
  }

  /**
   * How to reach a session's speaker.
   *
   * The server decides whether the details come back: a public speaker
   * once the session is over, a private one only with the host's blessing.
   */
  async getSpeakerContact(sessionId: string): Promise<SpeakerContact> {
    const response = await this.client.get(`/sessions/${sessionId}/contact/`);
    return response.data;
  }

  /** Ask the host to pass on a private speaker's details. */
  async requestSpeakerContact(sessionId: string, reason: string): Promise<ContactRequestRow> {
    const response = await this.client.post(`/sessions/${sessionId}/request_contact/`, { reason });
    return response.data;
  }

  /** Requests waiting on the host, for one event or the whole programme. */
  /**
   * List a speaker publicly, or take them back off the list.
   *
   * A speaker is one person across however many sessions they hold, so
   * every session of theirs moves together.
   */
  async setSpeakerVisibility(
    sessionIds: string[],
    visibility: 'public' | 'private'
  ): Promise<{ visibility: string; sessions: Session[]; changed: number }> {
    const response = await this.client.post('/sessions/set_visibility/', {
      session_ids: sessionIds,
      visibility,
    });
    return response.data;
  }

  async listContactRequests(
    params: { event?: string; status?: string } = {}
  ): Promise<ContactRequestRow[]> {
    const response = await this.client.get('/sessions/contact_requests/', { params });
    return response.data;
  }

  async decideContactRequest(
    sessionId: string,
    requestId: string,
    decision: 'approve' | 'decline'
  ): Promise<ContactRequestRow> {
    const response = await this.client.post(`/sessions/${sessionId}/decide_contact/`, {
      request_id: requestId,
      decision,
    });
    return response.data;
  }

  async getSessionAttendance(sessionId: string): Promise<SessionAttendanceRow[]> {
    const response = await this.client.get(`/sessions/${sessionId}/attendance/`);
    return response.data;
  }

  /** Tick somebody off by hand for a session the room did not see them in. */
  async markSessionAttendance(
    sessionId: string,
    who: { user_id?: string; guest_id?: string },
    present = true
  ): Promise<{ present: boolean }> {
    const response = await this.client.post(`/sessions/${sessionId}/mark/`, { ...who, present });
    return response.data;
  }

  // Participant endpoints
  /**
   * Who is in the event now.
   *
   * ``everyone`` asks a different question - who was in it at all - which
   * is what a team page wants: ending a event empties the room, so
   * asking the room's question there shows nobody.
   */
  async getParticipants(eventId: string, everyone = false): Promise<any[]> {
    const response = await this.client.get(
      `/events/${eventId}/participants/${everyone ? '?everyone=1' : ''}`
    );
    return response.data;
  }

  async updateParticipantState(eventId: string, userId: string, state: any): Promise<void> {
    await this.client.patch(`/events/${eventId}/participants/${userId}/`, state);
  }

  /** Change a participant's role. Host only; 'host' transfers ownership. */
  async updateParticipantRole(
    eventId: string,
    participantId: string,
    role: 'host' | 'co_host' | 'presenter' | 'attendee'
  ): Promise<EventParticipant> {
    const response = await this.client.patch(
      `/events/${eventId}/participants/${participantId}/role/`,
      { role }
    );
    return response.data;
  }

  /** Files shared in the event, for an admitted guest. */
  async guestResources(token: string): Promise<GuestResource[]> {
    const response = await axios.get(`${API_BASE_URL}/events/guest/resources/`, {
      params: { token },
    });
    return response.data;
  }

  /** Chat history and settings for an admitted guest. */
  async guestChat(token: string): Promise<{
    settings: ChatSettings;
    messages: ChatMessage[];
    me?: { id: string; name: string };
  }> {
    const response = await axios.get(`${API_BASE_URL}/events/guest/chat/`, {
      params: { token },
    });
    return response.data;
  }

  /** People an admitted guest may message directly. */
  async guestPresenters(token: string): Promise<ChatPerson[]> {
    const response = await axios.get(`${API_BASE_URL}/events/guest/presenters/`, {
      params: { token },
    });
    return response.data;
  }

  async getAttendance(eventId: string): Promise<AttendanceReport> {
    const response = await this.client.get(`/events/${eventId}/attendance/`);
    return response.data;
  }

  /**
   * Transcript lines already spoken, so joining late still shows the record.
   * The live stream itself arrives over the event websocket.
   */
  async getEventSegments(eventCode: string): Promise<TranscriptionSegment[]> {
    const response = await this.client.get(`/events/${eventCode}/segments/`);
    return response.data;
  }

  /** The same history, for a guest holding a signed token. */
  async getGuestSegments(
    eventCode: string,
    guestToken: string
  ): Promise<TranscriptionSegment[]> {
    const response = await axios.get(
      `${API_BASE_URL}/events/${eventCode}/segments/`,
      { params: { guest_token: guestToken } }
    );
    return response.data;
  }

  // Guest access - no account, host must admit
  /**
   * A guest asking to come in: a code and a name.
   *
   * ``token`` is what a guest already inside holds, and is how a reload
   * gets them back to their seat without the host being asked twice. A
   * name on its own never does that - it is not a credential.
   */
  async guestKnock(data: {
    code: string;
    full_name: string;
    token?: string;
  }): Promise<GuestSession> {
    // Deliberately bypasses the auth interceptor's token: guests have none.
    const response = await axios.post(`${API_BASE_URL}/events/guest/knock/`, data);
    return response.data;
  }

  async guestStatus(token: string): Promise<{ guest: GuestAttendee; event: any }> {
    const response = await axios.get(`${API_BASE_URL}/events/guest/status/`, {
      params: { token },
    });
    return response.data;
  }

  async guestLeave(token: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/events/guest/leave/`, { token });
  }

  /** Guests in the waiting room. Host only. */
  async getGuests(eventId: string): Promise<GuestAttendee[]> {
    const response = await this.client.get(`/events/${eventId}/guests/`);
    return response.data;
  }

  /** Admit or deny a waiting guest. Host only. */
  async admitGuest(
    eventId: string,
    guestId: string,
    decision: 'admit' | 'deny'
  ): Promise<GuestAttendee> {
    const response = await this.client.post(`/events/${eventId}/admit_guest/`, {
      guest_id: guestId,
      decision,
    });
    return response.data;
  }

  // Event chat (host-gated)
  async getChatSettings(eventId: string): Promise<ChatSettings> {
    const response = await this.client.get(`/events/${eventId}/chat_settings/`);
    return response.data;
  }

  async updateChatSettings(eventId: string, settings: Partial<ChatSettings>): Promise<ChatSettings> {
    const response = await this.client.patch(`/events/${eventId}/chat_settings/`, settings);
    return response.data;
  }

  async getChatMessages(eventId: string): Promise<ChatMessage[]> {
    const response = await this.client.get(`/events/${eventId}/messages/`);
    return response.data;
  }

  /** Messages held for host review. Host only. */
  async getPendingMessages(eventId: string): Promise<ChatMessage[]> {
    const response = await this.client.get(`/events/${eventId}/pending_messages/`);
    return response.data;
  }

  /** Approve, decline or remove a held message. Host only. */
  /**
   * Let a held message through, turn it down, or discard it.
   *
   * A topic may be given alongside an approval, which puts the message on
   * the board in the same breath - which is when the host has just read it.
   */
  async moderateMessage(
    eventId: string,
    messageId: string,
    decision: 'approve' | 'decline' | 'remove',
    topic?: MessageTopic
  ): Promise<ChatMessage> {
    const response = await this.client.post(
      `/events/${eventId}/moderate_message/`,
      { message_id: messageId, decision, ...(topic ? { topic } : {}) }
    );
    return response.data;
  }

  // Shared event resources (stored in the host's Google Drive)
  async getResources(eventId: string): Promise<Artifact[]> {
    const response = await this.client.get(`/events/${eventId}/resources/`);
    return response.data;
  }

  /**
   * Share a file with the event.
   *
   * A session may be named, which files the document against that talk
   * rather than against whatever is on stage when it is sent - how an
   * organizer stages a speaker's handouts before the day.
   */
  async uploadResource(
    eventId: string,
    file: File,
    onProgress?: (percent: number) => void,
    sessionId?: string
  ): Promise<Artifact> {
    const formData = new FormData();
    formData.append('file', file);
    if (sessionId) formData.append('session', sessionId);

    const response = await this.client.post(
      `/events/${eventId}/resources/`,
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (event) => {
          if (onProgress && event.total) {
            onProgress(Math.round((event.loaded * 100) / event.total));
          }
        },
      }
    );
    return response.data;
  }

  /**
   * Close this account, to be removed a week from now.
   *
   * Nothing is deleted on the spot. The account is shut - it cannot be
   * signed into again - and the row goes a week later, which is the
   * promise the confirmation makes.
   */
  async requestAccountDeletion(): Promise<{
    requested_at: string;
    removed_on: string;
    hosted_events: number;
  }> {
    const response = await this.client.post('/users/request_deletion/');
    return response.data;
  }

  /** Take a shared file off the event, and out of the host's Drive. */
  async deleteResource(eventId: string, resourceId: string): Promise<void> {
    await this.client.delete(`/events/${eventId}/resources/`, {
      params: { resource_id: resourceId },
    });
  }

  // Artifact endpoints
  async getArtifacts(eventId: string): Promise<Artifact[]> {
    const response = await this.client.get(`/events/${eventId}/artifacts/`);
    return response.data;
  }

  async getTranscript(eventId: string): Promise<Transcript> {
    const response = await this.client.get(`/events/${eventId}/transcript/`);
    return response.data;
  }

  async getSummary(eventId: string): Promise<TranscriptSummary> {
    const response = await this.client.get(`/events/${eventId}/summary/`);
    return response.data;
  }

  // Analytics endpoints
  async getEventAnalytics(eventId: string): Promise<any> {
    const response = await this.client.get(`/admin/event/${eventId}/analytics/`);
    return response.data;
  }

  async getPlatformStats(): Promise<any> {
    const response = await this.client.get('/admin/platform_stats/');
    return response.data;
  }

  async getAttendanceReport(eventId: string): Promise<any> {
    const response = await this.client.get(`/admin/attendance/${eventId}/`);
    return response.data;
  }

  // Organization endpoints
  async getOrganizations(): Promise<Organization[]> {
    const response = await this.client.get('/organizations/');
    return response.data.results || response.data;
  }

  async createOrganization(data: Partial<Organization>): Promise<Organization> {
    const response = await this.client.post('/organizations/', data);
    return response.data;
  }

  async updateOrganization(id: string, data: Partial<Organization>): Promise<Organization> {
    const response = await this.client.patch(`/organizations/${id}/`, data);
    return response.data;
  }

  async deleteOrganization(id: string): Promise<void> {
    await this.client.delete(`/organizations/${id}/`);
  }

  // Team endpoints
  async getTeams(orgId: string): Promise<Team[]> {
    const response = await this.client.get(`/organizations/${orgId}/teams/`);
    return response.data.results || response.data;
  }

  async createTeam(orgId: string, data: Partial<Team>): Promise<Team> {
    const response = await this.client.post(`/organizations/${orgId}/teams/`, data);
    return response.data;
  }

  // Member endpoints
  async getMembers(orgId: string): Promise<OrganizationMember[]> {
    const response = await this.client.get(`/organizations/${orgId}/members/`);
    return response.data.results || response.data;
  }

  async addMember(orgId: string, email: string, role: string): Promise<void> {
    await this.client.post(`/organizations/${orgId}/members/add/`, { email, role });
  }

  async removeMember(orgId: string, memberId: string): Promise<void> {
    await this.client.delete(`/organizations/${orgId}/members/${memberId}/`);
  }

  // Invite endpoints
  async getInvites(orgId: string): Promise<OrganizationInvite[]> {
    const response = await this.client.get(`/organizations/${orgId}/invites/`);
    return response.data.results || response.data;
  }

  async sendInvite(orgId: string, email: string, role: string): Promise<OrganizationInvite> {
    const response = await this.client.post(`/organizations/${orgId}/invites/`, { email, role });
    return response.data;
  }

  async acceptInvite(inviteId: string): Promise<void> {
    await this.client.post(`/invites/${inviteId}/accept/`);
  }

  async rejectInvite(inviteId: string): Promise<void> {
    await this.client.post(`/invites/${inviteId}/reject/`);
  }

  // Recording endpoints
  async getRecordings(eventId?: string): Promise<Recording[]> {
    const url = eventId ? `/recordings/?event_id=${eventId}` : '/recordings/';
    const response = await this.client.get(url);
    return response.data.results || response.data;
  }

  async deleteRecording(id: string): Promise<void> {
    await this.client.delete(`/recordings/${id}/`);
  }

  async shareRecording(id: string, recipients: string[]): Promise<void> {
    await this.client.post(`/recordings/${id}/share/`, { recipients });
  }

  // Transcription endpoints
  async editTranscriptSegment(eventId: string, segmentIdx: number, text: string): Promise<void> {
    await this.client.patch(`/events/${eventId}/transcript/segments/${segmentIdx}/`, { text });
  }

  async exportTranscript(eventId: string, format: 'pdf' | 'docx' | 'txt'): Promise<Blob> {
    const response = await this.client.get(`/events/${eventId}/transcript/export/`, {
      params: { format },
      responseType: 'blob',
    });
    return response.data;
  }

  async searchTranscript(eventId: string, query: string): Promise<any[]> {
    const response = await this.client.get(`/events/${eventId}/transcript/search/`, {
      params: { q: query },
    });
    return response.data;
  }

  // Drive endpoints
  async connectDrive(): Promise<{ auth_url: string }> {
    const response = await this.client.post('/drive/connect/');
    return response.data;
  }

  async disconnectDrive(): Promise<void> {
    await this.client.post('/drive/disconnect/');
  }

  async getDriveFiles(folderId?: string): Promise<DriveFile[]> {
    const url = folderId ? `/drive/files/?folder_id=${folderId}` : '/drive/files/';
    const response = await this.client.get(url);
    return response.data;
  }

  async createDriveFolder(folderName: string): Promise<DriveFile> {
    const response = await this.client.post('/drive/folders/', { name: folderName });
    return response.data;
  }

  async uploadToDrive(file: File, folderId?: string): Promise<DriveFile> {
    const formData = new FormData();
    formData.append('file', file);
    if (folderId) formData.append('folder_id', folderId);
    const response = await this.client.post('/drive/upload/', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  }

  async getDriveSyncStatus(eventId: string): Promise<DriveSyncStatus> {
    const response = await this.client.get(`/drive/sync-status/${eventId}/`);
    return response.data;
  }

  async setSyncEnabled(eventId: string, enabled: boolean): Promise<void> {
    await this.client.patch(`/drive/sync-status/${eventId}/`, { sync_enabled: enabled });
  }

  // Analytics endpoints
  async getOrgAnalytics(orgId: string, from?: string, to?: string): Promise<OrganizationAnalytics> {
    const response = await this.client.get(`/organizations/${orgId}/analytics/`, {
      params: { from, to },
    });
    return response.data;
  }

  async exportAnalytics(orgId: string, format: 'csv' | 'pdf'): Promise<Blob> {
    const response = await this.client.get(`/organizations/${orgId}/analytics/export/`, {
      params: { format },
      responseType: 'blob',
    });
    return response.data;
  }

  // Subscription endpoints
  async getSubscription(orgId: string): Promise<SubscriptionData> {
    const response = await this.client.get(`/organizations/${orgId}/subscription/`);
    return response.data;
  }

  async updateSubscription(orgId: string, tier: string): Promise<SubscriptionData> {
    const response = await this.client.patch(`/organizations/${orgId}/subscription/`, { tier });
    return response.data;
  }

  async cancelSubscription(orgId: string): Promise<void> {
    await this.client.post(`/organizations/${orgId}/subscription/cancel/`);
  }

  // Billing endpoints
  async getInvoices(orgId: string): Promise<Invoice[]> {
    const response = await this.client.get(`/organizations/${orgId}/invoices/`);
    return response.data.results || response.data;
  }

  async downloadInvoice(invoiceId: string): Promise<Blob> {
    const response = await this.client.get(`/invoices/${invoiceId}/download/`, {
      responseType: 'blob',
    });
    return response.data;
  }

  async getPaymentMethods(orgId: string): Promise<PaymentMethod[]> {
    const response = await this.client.get(`/organizations/${orgId}/payment-methods/`);
    return response.data.results || response.data;
  }

  async initiatePayment(orderId: string, amount: string, paymentChannel = 'esewa'): Promise<{
    order_id: string;
    transaction_id: string;
    gateway_url: string;
    payload: Record<string, string>;
  }> {
    const response = await fetch(`${PAYMENT_API_ROOT}/api/payments/initiate/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken ?? ''}`,
      },
      body: JSON.stringify({ order_id: orderId, amount, payment_channel: paymentChannel }),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data?.error ?? 'Could not start payment') as Error & {
        response?: { data: unknown };
      };
      error.response = { data };
      throw error;
    }
    return data;
  }

  async submitManualQrPayment(orderId: string, referenceNumber: string): Promise<{
    order_id: string;
    status: string;
  }> {
    const response = await fetch(`${PAYMENT_API_ROOT}/api/payments/submit-manual-qr/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken ?? ''}`,
      },
      body: JSON.stringify({ order_id: orderId, reference_number: referenceNumber }),
    });
    const data = await response.json();
    if (!response.ok) {
      const error = new Error(data?.error ?? 'Could not submit payment reference') as Error & {
        response?: { data: unknown };
      };
      error.response = { data };
      throw error;
    }
    return data;
  }

  async addPaymentMethod(orgId: string, data: Partial<PaymentMethod>): Promise<PaymentMethod> {
    const response = await this.client.post(`/organizations/${orgId}/payment-methods/`, data);
    return response.data;
  }

  async removePaymentMethod(methodId: string): Promise<void> {
    await this.client.delete(`/payment-methods/${methodId}/`);
  }

  async setDefaultPaymentMethod(methodId: string): Promise<void> {
    await this.client.patch(`/payment-methods/${methodId}/`, { is_default: true });
  }

  async payInvoice(invoiceId: string, methodId: string): Promise<void> {
    await this.client.post(`/invoices/${invoiceId}/pay/`, { payment_method_id: methodId });
  }

  // User endpoints
  /**
   * Write what somebody put on their own profile.
   *
   * The address is not among it: it is what the account is, and what
   * Google signed them in as. The server ignores it either way.
   */
  async updateProfile(data: {
    first_name?: string;
    last_name?: string;
    phone?: string;
    position?: string;
    organization_name?: string;
    billing_address?: string;
    preferred_language?: string;
    timezone?: string;
  }): Promise<User> {
    const response = await this.client.patch('/users/profile/', data);
    return response.data;
  }
}

export const apiClient = new ApiClient();
