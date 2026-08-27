import axios, { AxiosInstance, AxiosError } from 'axios';
import {
  User,
  Meeting,
  AuthTokens,
  Transcript,
  TranscriptSummary,
  Artifact,
  Recording,
  Organization,
  Team,
  OrganizationMember,
  OrganizationInvite,
  SubscriptionData,
  Invoice,
  PaymentMethod,
  DriveFile,
  DriveSyncStatus,
  OrganizationAnalytics,
  ChatSettings,
  ChatMessage,
  MeetingParticipant,
  GuestAttendee,
  GuestSession,
  MeetingInvite,
  AttendanceReport,
  ChatPerson,
  GuestResource,
} from '../types';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:8000/api/v1';

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
        const originalRequest = error.config;
        if (error.response?.status === 401 && originalRequest) {
          if (this.refreshToken) {
            try {
              const response = await this.refreshAccessToken();
              this.setTokens(response.access, this.refreshToken);
              return this.client(originalRequest);
            } catch {
              this.logout();
            }
          }
        }
        return Promise.reject(error);
      }
    );

    this.loadTokens();
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

  private async refreshAccessToken(): Promise<{ access: string }> {
    const response = await this.client.post('/auth/token_refresh/', {
      refresh: this.refreshToken,
    });
    return response.data;
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

  async logout(): Promise<void> {
    try {
      await this.client.post('/auth/logout/', {
        refresh: this.refreshToken,
      });
    } finally {
      this.clearTokens();
    }
  }

  // Meeting endpoints
  async createMeeting(data: {
    title: string;
    description?: string;
    scheduled_start: string;
    scheduled_end: string;
  }): Promise<Meeting> {
    const response = await this.client.post('/meetings/', data);
    return response.data;
  }

  async getMeeting(meetingCodeOrId: string): Promise<Meeting> {
    const response = await this.client.get(`/meetings/${meetingCodeOrId}/`);
    return response.data;
  }

  async listMeetings(): Promise<Meeting[]> {
    const response = await this.client.get('/meetings/');
    return response.data.results || response.data;
  }

  async getActiveMeetings(): Promise<Meeting[]> {
    const response = await this.client.get('/meetings/active/');
    return response.data;
  }

  async startMeeting(meetingId: string): Promise<Meeting> {
    const response = await this.client.post(`/meetings/${meetingId}/start/`);
    return response.data;
  }

  async endMeeting(meetingId: string): Promise<Meeting> {
    const response = await this.client.post(`/meetings/${meetingId}/end/`);
    return response.data;
  }

  /** Leave without ending the meeting for anyone else. */
  async leaveMeeting(meetingId: string): Promise<void> {
    await this.client.post(`/meetings/${meetingId}/leave/`);
  }

  async joinMeeting(meetingCode: string, role: string = 'attendee'): Promise<any> {
    const response = await this.client.post(`/meetings/${meetingCode}/join/`, { role });
    return response.data;
  }

  // Participant endpoints
  async getParticipants(meetingId: string): Promise<any[]> {
    const response = await this.client.get(`/meetings/${meetingId}/participants/`);
    return response.data;
  }

  async updateParticipantState(meetingId: string, userId: string, state: any): Promise<void> {
    await this.client.patch(`/meetings/${meetingId}/participants/${userId}/`, state);
  }

  /** Change a participant's role. Host only; 'host' transfers ownership. */
  async updateParticipantRole(
    meetingId: string,
    participantId: string,
    role: 'host' | 'co_host' | 'presenter' | 'attendee'
  ): Promise<MeetingParticipant> {
    const response = await this.client.patch(
      `/meetings/${meetingId}/participants/${participantId}/role/`,
      { role }
    );
    return response.data;
  }

  /** Files shared in the meeting, for an admitted guest. */
  async guestResources(token: string): Promise<GuestResource[]> {
    const response = await axios.get(`${API_BASE_URL}/meetings/guest/resources/`, {
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
    const response = await axios.get(`${API_BASE_URL}/meetings/guest/chat/`, {
      params: { token },
    });
    return response.data;
  }

  /** People an admitted guest may message directly. */
  async guestPresenters(token: string): Promise<ChatPerson[]> {
    const response = await axios.get(`${API_BASE_URL}/meetings/guest/presenters/`, {
      params: { token },
    });
    return response.data;
  }

  // Invitations - each shared link counts toward expected attendance
  async getMeetingInvites(meetingId: string): Promise<MeetingInvite[]> {
    const response = await this.client.get(`/meetings/${meetingId}/invites/`);
    return response.data;
  }

  async addMeetingInvites(
    meetingId: string,
    emails: string[]
  ): Promise<{ added: MeetingInvite[]; already_invited: MeetingInvite[]; total_invited: number }> {
    const response = await this.client.post(`/meetings/${meetingId}/invites/`, { emails });
    return response.data;
  }

  async getAttendance(meetingId: string): Promise<AttendanceReport> {
    const response = await this.client.get(`/meetings/${meetingId}/attendance/`);
    return response.data;
  }

  // Guest access - no account, host must admit
  async guestKnock(data: {
    meeting_code: string;
    full_name: string;
    phone: string;
  }): Promise<GuestSession> {
    // Deliberately bypasses the auth interceptor's token: guests have none.
    const response = await axios.post(`${API_BASE_URL}/meetings/guest/knock/`, data);
    return response.data;
  }

  async guestStatus(token: string): Promise<{ guest: GuestAttendee; meeting: any }> {
    const response = await axios.get(`${API_BASE_URL}/meetings/guest/status/`, {
      params: { token },
    });
    return response.data;
  }

  async guestLeave(token: string): Promise<void> {
    await axios.post(`${API_BASE_URL}/meetings/guest/leave/`, { token });
  }

  /** Guests in the waiting room. Host only. */
  async getGuests(meetingId: string): Promise<GuestAttendee[]> {
    const response = await this.client.get(`/meetings/${meetingId}/guests/`);
    return response.data;
  }

  /** Admit or deny a waiting guest. Host only. */
  async admitGuest(
    meetingId: string,
    guestId: string,
    decision: 'admit' | 'deny'
  ): Promise<GuestAttendee> {
    const response = await this.client.post(`/meetings/${meetingId}/admit_guest/`, {
      guest_id: guestId,
      decision,
    });
    return response.data;
  }

  // Meeting chat (host-gated)
  async getChatSettings(meetingId: string): Promise<ChatSettings> {
    const response = await this.client.get(`/meetings/${meetingId}/chat_settings/`);
    return response.data;
  }

  async updateChatSettings(meetingId: string, settings: Partial<ChatSettings>): Promise<ChatSettings> {
    const response = await this.client.patch(`/meetings/${meetingId}/chat_settings/`, settings);
    return response.data;
  }

  async getChatMessages(meetingId: string): Promise<ChatMessage[]> {
    const response = await this.client.get(`/meetings/${meetingId}/messages/`);
    return response.data;
  }

  /** Messages held for host review. Host only. */
  async getPendingMessages(meetingId: string): Promise<ChatMessage[]> {
    const response = await this.client.get(`/meetings/${meetingId}/pending_messages/`);
    return response.data;
  }

  /** Approve, decline or remove a held message. Host only. */
  async moderateMessage(
    meetingId: string,
    messageId: string,
    decision: 'approve' | 'decline' | 'remove'
  ): Promise<ChatMessage> {
    const response = await this.client.post(
      `/meetings/${meetingId}/moderate_message/`,
      { message_id: messageId, decision }
    );
    return response.data;
  }

  // Shared meeting resources (stored in the host's Google Drive)
  async getResources(meetingId: string): Promise<Artifact[]> {
    const response = await this.client.get(`/meetings/${meetingId}/resources/`);
    return response.data;
  }

  async uploadResource(
    meetingId: string,
    file: File,
    onProgress?: (percent: number) => void
  ): Promise<Artifact> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await this.client.post(
      `/meetings/${meetingId}/resources/`,
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

  // Artifact endpoints
  async getArtifacts(meetingId: string): Promise<Artifact[]> {
    const response = await this.client.get(`/meetings/${meetingId}/artifacts/`);
    return response.data;
  }

  async getTranscript(meetingId: string): Promise<Transcript> {
    const response = await this.client.get(`/meetings/${meetingId}/transcript/`);
    return response.data;
  }

  async getSummary(meetingId: string): Promise<TranscriptSummary> {
    const response = await this.client.get(`/meetings/${meetingId}/summary/`);
    return response.data;
  }

  // Analytics endpoints
  async getMeetingAnalytics(meetingId: string): Promise<any> {
    const response = await this.client.get(`/admin/meeting/${meetingId}/analytics/`);
    return response.data;
  }

  async getPlatformStats(): Promise<any> {
    const response = await this.client.get('/admin/platform_stats/');
    return response.data;
  }

  async getAttendanceReport(meetingId: string): Promise<any> {
    const response = await this.client.get(`/admin/attendance/${meetingId}/`);
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
  async getRecordings(meetingId?: string): Promise<Recording[]> {
    const url = meetingId ? `/recordings/?meeting_id=${meetingId}` : '/recordings/';
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
  async editTranscriptSegment(meetingId: string, segmentIdx: number, text: string): Promise<void> {
    await this.client.patch(`/meetings/${meetingId}/transcript/segments/${segmentIdx}/`, { text });
  }

  async exportTranscript(meetingId: string, format: 'pdf' | 'docx' | 'txt'): Promise<Blob> {
    const response = await this.client.get(`/meetings/${meetingId}/transcript/export/`, {
      params: { format },
      responseType: 'blob',
    });
    return response.data;
  }

  async searchTranscript(meetingId: string, query: string): Promise<any[]> {
    const response = await this.client.get(`/meetings/${meetingId}/transcript/search/`, {
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

  async getDriveSyncStatus(meetingId: string): Promise<DriveSyncStatus> {
    const response = await this.client.get(`/drive/sync-status/${meetingId}/`);
    return response.data;
  }

  async setSyncEnabled(meetingId: string, enabled: boolean): Promise<void> {
    await this.client.patch(`/drive/sync-status/${meetingId}/`, { sync_enabled: enabled });
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
  async updateProfile(data: Partial<User>): Promise<User> {
    const response = await this.client.patch('/users/profile/', data);
    return response.data;
  }
}

export const apiClient = new ApiClient();
