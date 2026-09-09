// Authentication
export interface User {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  avatar_url?: string;
  is_verified: boolean;
  created_at: string;
}

export interface AuthTokens {
  access: string;
  refresh: string;
}

// Meeting
export interface Meeting {
  /**
   * The session the room is holding. A room is a session, not a meeting:
   * the clock counts this, and the door shuts when it ends.
   */
  current_session?: {
    id: string | null;
    title: string;
    starts_at?: string;
    started_at: string | null;
    ends_at: string | null;
    duration_minutes?: number;
    status?: string;
    is_over: boolean;
  };
  /** When the room opens, and whether it may be started yet. Server-decided. */
  entry?: {
    opens_at: string;
    scheduled_start: string;
    is_open: boolean;
    can_start: boolean;
    entry_window_minutes: number;
  };

  id: string;
  meeting_code: string;
  title: string;
  description: string;
  host: User;
  status: 'scheduled' | 'active' | 'ended' | 'cancelled';
  scheduled_start: string;
  scheduled_end: string;
  started_at?: string;
  ended_at?: string;
  max_participants: number;
  allow_recording: boolean;
  require_authentication: boolean;
  participant_count: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  chat_enabled?: boolean;
  direct_messages_enabled?: boolean;
}

export interface MeetingParticipant {
  id: string;
  user: User;
  role: 'host' | 'co_host' | 'presenter' | 'attendee';
  session_id: string;
  joined_at: string;
  left_at?: string;
  is_active: boolean;
  is_muted: boolean;
  is_video_on: boolean;
  is_screen_sharing: boolean;
}

// Transcription
export interface TranscriptionSegment {
  speaker_name: string;
  text: string;
  start_time: number;
  end_time: number;
  is_final: boolean;
  confidence: number;
  language?: string;
  /** Present on stored lines; live broadcasts carry it too. */
  created_at?: string;
  /** Which part of the running order this was said during. */
  session_id?: string | null;
  session_title?: string | null;
}

export interface Transcript {
  id: string;
  meeting_id: string;
  full_text: string;
  word_count: number;
  is_complete: boolean;
}

export interface TranscriptSummary {
  id: string;
  meeting_id: string;
  summary_text: string;
  key_points: string[];
  action_items: string[];
  attendee_summary: Record<string, string>;
  is_complete: boolean;
}

// Artifacts
/** Who may read a shared file, and from when. */
export type ResourceVisibility = 'now' | 'after_session' | 'public' | 'organizers';

export interface Artifact {
  id: string;
  meeting_id: string;
  artifact_type: string;
  display_name: string;
  drive_file_id?: string;
  web_view_link?: string;
  mime_type?: string;
  file_size?: number | null;
  metadata?: Record<string, any>;
  sync_status: 'pending' | 'syncing' | 'synced' | 'failed';
  /** The part of the running order this was shared during, if any. */
  session?: string | null;
  session_title?: string | null;
  /** False while its session is still to come, or still running. */
  is_released?: boolean;
  /** Who may read it, and from when. */
  visibility?: ResourceVisibility;
  /** Where it sits in the order attendees see. */
  position?: number;
  created_at: string;
}

// Analytics
export interface MeetingAnalytics {
  total_participants: number;
  duration_minutes: number;
  engagement_score: number;
  messages: number;
  screen_shares: number;
  bandwidth_mb: number;
}

// Organization
export interface Organization {
  id: string;
  name: string;
  slug: string;
  owner_id: string;
  logo_url?: string;
  is_active: boolean;
  created_at: string;
}

export interface Subscription {
  tier: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'canceled' | 'expired';
  current_period_end?: string;
}

// Recording
export interface Recording {
  id: string;
  meeting_id: string;
  meeting_title: string;
  drive_file_id?: string;
  duration_seconds: number;
  file_size_bytes: number;
  status: 'processing' | 'ready' | 'failed';
  web_view_link?: string;
  created_at: string;
  updated_at: string;
}

// Transcription Editor
export interface TranscriptEdit {
  id: string;
  segment_index: number;
  original_text: string;
  edited_text: string;
  edited_by: User;
  edited_at: string;
}

// Drive Integration
export interface DriveFile {
  id: string;
  name: string;
  mime_type: string;
  size_bytes: number;
  web_view_link: string;
  download_link: string;
  created_time: string;
  modified_time: string;
}

export interface DriveSyncStatus {
  meeting_id: string;
  sync_enabled: boolean;
  folder_id?: string;
  folder_name?: string;
  last_sync: string;
  status: 'active' | 'paused' | 'failed';
}

// Organization & Team
export interface Team {
  id: string;
  organization_id: string;
  name: string;
  description?: string;
  member_count: number;
  created_at: string;
  updated_at: string;
}

export interface OrganizationMember {
  id: string;
  organization_id: string;
  user: User;
  role: 'owner' | 'admin' | 'member' | 'guest';
  teams: Team[];
  joined_at: string;
  status: 'active' | 'invited' | 'inactive';
}

export interface OrganizationInvite {
  id: string;
  organization_id: string;
  email: string;
  role: 'admin' | 'member' | 'guest';
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
  expires_at: string;
}

export interface SubscriptionData {
  id: string;
  organization_id: string;
  tier: 'free' | 'pro' | 'enterprise';
  status: 'active' | 'canceled' | 'expired';
  current_period_start: string;
  current_period_end: string;
  auto_renew: boolean;
  features: SubscriptionFeature[];
}

export interface SubscriptionFeature {
  name: string;
  limit: number;
  usage: number;
  enabled: boolean;
}

// Billing
export interface Invoice {
  id: string;
  organization_id: string;
  amount_cents: number;
  currency: string;
  status: 'draft' | 'sent' | 'paid' | 'failed';
  issue_date: string;
  due_date: string;
  items: InvoiceItem[];
}

export interface InvoiceItem {
  description: string;
  quantity: number;
  unit_price_cents: number;
  total_cents: number;
}

export interface PaymentMethod {
  id: string;
  organization_id: string;
  type: 'card' | 'bank_transfer';
  last_four: string;
  is_default: boolean;
  expires_at?: string;
}

// Analytics
export interface OrganizationAnalytics {
  total_meetings: number;
  total_participants: number;
  total_hours: number;
  active_users: number;
  storage_used_gb: number;
  meetings_this_month: number;
  avg_meeting_duration: number;
  growth_rate: number;
}

// Monitoring
export interface SystemMetrics {
  timestamp: string;
  cpu_usage: number;
  memory_usage: number;
  disk_usage: number;
  active_connections: number;
  request_rate: number;
  error_rate: number;
  latency_ms: number;
}

export interface AuditLog {
  id: string;
  organization_id?: string;
  user: User;
  action: string;
  resource_type: string;
  resource_id: string;
  changes: Record<string, any>;
  timestamp: string;
  ip_address?: string;
}

// WebSocket Messages
export interface WebSocketMessage<T = any> {
  type: string;
  timestamp: string;
  data?: T;
}

export interface ParticipantStateUpdate {
  user_id: string;
  user_name: string;
  is_muted?: boolean;
  is_video_on?: boolean;
  is_screen_sharing?: boolean;
}

export interface TranscriptionUpdate {
  segment: TranscriptionSegment;
  timestamp: string;
}


// Meeting chat
export interface ChatSettings {
  chat_enabled: boolean;
  direct_messages_enabled: boolean;
}

export type ModerationStatus =
  | 'not_required'
  | 'pending'
  | 'approved'
  | 'declined'
  | 'removed';

export interface ChatMessage {
  id: string;
  body: string;
  moderation_status?: ModerationStatus;
  created_at: string;
  is_direct: boolean;
  /** Id of the sender, whether an account holder or a guest. */
  sender_id: string;
  sender_name: string;
  sender_email: string | null;
  sender_is_guest: boolean;
  recipient_id: string | null;
  recipient_name: string | null;
  recipient_is_guest: boolean;
  /** Where the host filed it: on the board as a question, a suggestion, or not at all. */
  topic?: MessageTopic;
}

export interface ChatPerson {
  id: string;
  name: string;
  role: string;
}


// Guests (join by code, no account)
export type GuestStatus = 'pending' | 'admitted' | 'denied' | 'left';

export interface GuestAttendee {
  id: string;
  full_name: string;
  phone: string;
  status: GuestStatus;
  created_at: string;
  decided_at: string | null;
}

export interface GuestSession {
  guest_token: string;
  guest: GuestAttendee;
  meeting: { meeting_code: string; title: string };
}


// Invitations & attendance
export interface MeetingInvite {
  id: string;
  email: string;
  created_at: string;
  joined_at: string | null;
  has_joined: boolean;
  invited_by_email?: string;
}

export interface AttendanceEntry {
  type: 'user' | 'guest';
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  joined_at: string;
  left_at: string | null;
  /** Still in the meeting, as opposed to having attended and left. */
  is_active: boolean;
  was_invited: boolean;
}

export interface SessionTurnout {
  id: string;
  title: string;
  starts_at: string;
  status: string;
  attended_count: number;
}

export interface AttendanceReport {
  expected_from_invites: number;
  /** Invitations, plus the guests and anyone else who turned up. */
  expected_total: number;
  /** What is left of that total once the people who came are taken off. */
  absent_count: number;
  walked_in_uninvited: number;
  /** Every seat filled across the running order, session by session. */
  session_attendance_total: number;
  sessions: SessionTurnout[];
  attended_count: number;
  active_count: number;
  inactive_count: number;
  invited_who_attended: number;
  invited_who_did_not: number;
  guests_admitted: number;
  attended: AttendanceEntry[];
  did_not_attend: { email: string; invited_at: string }[];
}


export interface GuestResource {
  id: string;
  display_name: string;
  mime_type: string | null;
  file_size: number | null;
  created_at: string;
  uploaded_by: string | null;
  /** Served by our backend, since guests have no Drive access. */
  download_url: string;
}


// --- Events, meetings and sessions -----------------------------------------
// An event is a day's programme. It holds meetings, which are the rooms
// people join, and each meeting holds the sessions that make up its
// running order.

export type SessionStatus = 'scheduled' | 'live' | 'done' | 'skipped';

export interface Session {
  id: string;
  meeting: string;
  title: string;
  description: string;
  speaker_name: string;
  /** Which room in the venue this runs in. */
  hall: string;
  /** Whether attendees may simply read the speaker's details, or must ask. */
  speaker_visibility: 'public' | 'private';
  /**
   * The speaker's details, sent only to the host of the meeting.
   * Null for everybody else, who read them through the contact endpoint.
   */
  speaker_contact?: { email: string; phone: string } | null;
  starts_at: string;
  duration_minutes: number;
  ends_at: string;
  position: number;
  status: SessionStatus;
  started_at: string | null;
  ended_at: string | null;
  attendance_count: number;
  created_at: string;
  updated_at: string;
}

export interface EventMeeting {
  id: string;
  meeting_code: string;
  title: string;
  description: string;
  status: Meeting['status'];
  scheduled_start: string;
  scheduled_end: string;
  started_at?: string | null;
  ended_at?: string | null;
  participant_count: number;
  sessions: Session[];
  session_count: number;
}

export type EventStatus = 'draft' | 'scheduled' | 'active' | 'ended' | 'cancelled';

export interface EventProgramme {
  id: string;
  title: string;
  description: string;
  venue: string;
  event_date: string;
  status: EventStatus;
  organizer_email: string;
  meetings: EventMeeting[];
  meeting_count: number;
  session_count: number;
  created_at: string;
  updated_at: string;
}

/** A session as typed into the create form, before it exists. */
export interface SessionDraft {
  title: string;
  speaker_name?: string;
  /** Compulsory: a speaker has to be reachable after the event. */
  speaker_email?: string;
  speaker_phone?: string;
  speaker_visibility?: 'public' | 'private';
  hall?: string;
  starts_at: string;
  duration_minutes: number;
  description?: string;
}

/** A meeting as typed into the create form, with its running order. */
export interface MeetingDraft {
  title: string;
  description?: string;
  scheduled_start: string;
  duration_minutes: number;
  sessions: SessionDraft[];
}

export interface SessionAttendanceRow {
  id: string;
  session: string;
  /** Who this is, across sessions - two people may share a name. */
  person_id: string;
  name: string;
  is_guest: boolean;
  marked_manually: boolean;
  recorded_at: string;
}


/** How to reach a session's speaker, and whether you may yet. */
export interface SpeakerContact {
  speaker_name: string;
  visibility: 'public' | 'private';
  session_is_over: boolean;
  released: boolean;
  request_status: 'pending' | 'approved' | 'declined' | null;
  reason?: string;
  email?: string;
  phone?: string;
}

export interface ContactRequestRow {
  id: string;
  session: string;
  session_title: string;
  speaker_name: string;
  meeting_id: string;
  meeting_title: string;
  asker_name: string;
  asker_is_guest: boolean;
  reason: string;
  status: 'pending' | 'approved' | 'declined';
  created_at: string;
  decided_at: string | null;
}


/** The ceiling a plan puts on what a host may run. `null` means no ceiling. */
export interface PlanLimits {
  events: number | null;
  meetings: number | null;
  meetings_per_event: number | null;
  sessions_per_meeting: number | null;
  attendees: number | null;
}

export interface HostPlan {
  id: string;
  name: string;
  paid: boolean;
  limits: PlanLimits;
}

/**
 * Which portal a signed-in person belongs in.
 *
 * Guests never appear here: they reach a meeting by code or QR without an
 * account, so there is nothing to describe.
 */
export interface UserRoles {
  is_host: boolean;
  is_attendee: boolean;
  can_start_hosting: boolean;
  portals: Array<'host' | 'attendee'>;
  plan: HostPlan | null;
  usage: { events: number; meetings: number; sessions: number } | null;
  subscription: { status: string; current_period_end: string | null } | null;
}

/** How far a role reaches, and how long it lasts. */
export type RoleScope = 'event' | 'meeting' | 'session';

/**
 * A role the host has given somebody over one part of the programme.
 *
 * The scope is the whole point: a co-host of one meeting is nobody in the
 * next one until the host says otherwise.
 */
export interface RoleGrantRow {
  id: string;
  email: string;
  role: 'co_host' | 'presenter';
  scope: RoleScope;
  scope_id: string;
  scope_title: string;
  /** Whether that address has turned into a real account yet. */
  accepted: boolean;
  created_at: string;
}

/** Somebody presenting, read from the sessions that name them. */
export interface ProgrammeSpeaker {
  name: string;
  email: string;
  sessions: { id: string; title: string; meeting: string }[];
}

export interface ProgrammeRoles {
  granted: RoleGrantRow[];
  speakers: ProgrammeSpeaker[];
}

/** What the host decided a message really is. */
export type MessageTopic = 'none' | 'faq' | 'suggestion';

/** One message the host has put up for the room to read. */
export interface BoardEntry {
  id: string;
  body: string;
  asked_by: string;
  asker_is_guest: boolean;
  was_direct: boolean;
  /** Who a direct question was put to; null for a public one. */
  sent_to: string | null;
  /** Upvotes less downvotes — the room's sense of what wants answering. */
  score: number;
  /** How this reader voted: 1, -1, or 0 for not yet. */
  my_vote: number;
  /** The answer from the front of the room; empty until one is written. */
  answer: string;
  answered_by: string;
  answered_at: string | null;
  created_at: string;
}

export interface MeetingBoard {
  faq: BoardEntry[];
  suggestions: BoardEntry[];
}

/** A session's summary, and whether the host has let it out. */
export interface SessionSummary {
  session: string;
  session_title: string;
  body: string;
  /** What somebody has to go and do, out of this session. */
  actions: ConclusionAction[];
  status: 'needs_approval' | 'published';
  is_published: boolean;
  /** False for the draft offered before anything has been written. */
  saved: boolean;
  published_at: string | null;
  updated_at?: string;
}

/** What somebody put into the attendee hub. */
export type HubKind = 'question' | 'idea' | 'suggestion';

export type HubStatus = 'pending' | 'published' | 'declined' | 'looking' | 'addressed';

export interface HubPost {
  id: string;
  kind: HubKind;
  body: string;
  category: string;
  status: HubStatus;
  anonymous: boolean;
  author: string;
  author_is_guest: boolean;
  /** Whether this reader wrote it. */
  mine: boolean;
  session_id: string | null;
  session_title: string | null;
  /** Upvotes less downvotes. */
  score: number;
  /** How this reader voted: 1, -1, or 0 for not yet. */
  my_vote: number;
  answer: string;
  answered_by: string;
  created_at: string;
}

export interface HubBoard {
  questions: HubPost[];
  ideas: HubPost[];
  /** Only ever this reader's own — suggestions go to the organizer alone. */
  suggestions: HubPost[];
}

/** A nudge somebody is owed before something they are part of happens. */
export interface Reminder {
  id: string;
  kind: 'meeting' | 'session';
  meeting_id: string;
  meeting_code: string;
  meeting_title: string;
  session_id: string | null;
  session_title: string | null;
  speaker_name: string;
  hall: string;
  starts_at: string;
  ends_at: string;
  /** When the nudge is owed: an hour before a meeting, a quarter before a session. */
  due_at: string;
  is_due: boolean;
  read: boolean;
  lead_minutes: number;
  /** Puts it in a Google Calendar. Needs no tokens or consent screen. */
  calendar_url: string;
}

/** Something somebody has to go and do, out of a session. */
export interface ConclusionAction {
  task: string;
  owner: string;
  due: string;
  /** Present on the reader's own list, to say where it came from. */
  session_title?: string;
}

/** What one session settled. */
export interface Conclusion {
  session_id: string;
  session_title: string;
  session_starts_at: string;
  speaker_name: string;
  hall: string;
  meeting_id: string;
  meeting_title: string;
  event_id: string;
  event_title: string;
  findings: string[];
  actions: ConclusionAction[];
  published_at: string | null;
}

export interface ConclusionPage {
  conclusions: Conclusion[];
  /** The actions with this reader's name against them. */
  mine: ConclusionAction[];
}

/** How this host spaces their day, and how much warning it gives. */
export interface SchedulingPrefs {
  session_gap_minutes: number;
  meeting_reminder_minutes: number;
  session_reminder_minutes: number;
  reminders_enabled: boolean;
  defaults: {
    session_gap_minutes: number;
    meeting_reminder_minutes: number;
    session_reminder_minutes: number;
  };
  maximums: {
    session_gap_minutes: number;
    meeting_reminder_minutes: number;
    session_reminder_minutes: number;
  };
  default_session_gap_minutes: number;
  max_session_gap_minutes: number;
}

/**
 * A named place for the photographs of a meeting.
 *
 * Deliberately not an Artifact: files and summaries are working documents
 * with a release rule tied to their session, photographs are the record of
 * the day, and one set of rules over both would suit neither.
 */
export interface PhotoFolder {
  id: string;
  name: string;
  is_default: boolean;
  created_by: string;
  is_mine: boolean;
  photo_count: number;
  created_at: string;
}

export interface MeetingPhoto {
  id: string;
  folder_id: string;
  caption: string;
  mime_type: string;
  file_size: number | null;
  taken_by: string;
  taken_by_id: string;
  is_mine: boolean;
  created_at: string;
  /** Served by the backend, so it needs the signed-in request to fetch it. */
  url: string;
}

export interface PhotoPage {
  meeting_id: string;
  meeting_code: string;
  meeting_title: string;
  meeting_is_finished: boolean;
  /** Whether this person may add one now: the permission and the timing. */
  can_upload: boolean;
  /** Whether they are one of the people who may, once it has finished. */
  is_a_photographer: boolean;
  can_arrange: boolean;
  folders: PhotoFolder[];
  photos: MeetingPhoto[];
}

/** A report that has been written into somebody's own Google Drive. */
export interface SheetExport {
  id: string;
  name: string;
  url: string;
}

export interface ReminderPage {
  reminders: Reminder[];
  unread: number;
  meeting_lead_minutes: number;
  session_lead_minutes: number;
}

/** Everything a profile page shows, in one answer. */
export interface ProfileSummary extends UserRoles {
  user: {
    id: string;
    email: string;
    name: string;
    avatar_url: string | null;
    is_verified: boolean;
    joined: string;
    signed_in_with_google: boolean;
    language: string;
    timezone: string;
  };
  remaining: {
    events: number | null;
    meetings: number | null;
    sessions_per_meeting: number | null;
    attendees: number | null;
  };
  plans: HostPlan[];
}

export interface UpgradeRequestRow {
  id: string;
  plan: string;
  plan_name: string;
  from_plan: string;
  status: 'asked' | 'done' | 'declined';
  note: string;
  created_at: string;
}
