import axiosInstance from './axiosInstance';

/**
 * Teams — shared accounts (see backend services/team). `teamId` on the calls
 * that act inside a team is sent as the `X-Team-Id` header, which is how the
 * backend knows which account a request is for; without it the request acts
 * on the customer's personal account.
 */
const inTeam = (teamId) => (teamId ? { headers: { 'X-Team-Id': teamId } } : {});

const teamsApi = {
  /** GET /api/v1/customer/teams — every account the customer belongs to */
  list: () => axiosInstance.get('/api/v1/customer/teams').then((r) => r.data),

  /** GET /api/v1/customer/teams/current — the active account, role and allowed actions */
  current: () => axiosInstance.get('/api/v1/customer/teams/current').then((r) => r.data),

  /** Members and pending invitations of the active team */
  members: () => axiosInstance.get('/api/v1/customer/teams/current/members').then((r) => r.data),
  invitations: () => axiosInstance.get('/api/v1/customer/teams/current/invitations').then((r) => r.data),
  revokeInvitation: (id) => axiosInstance.delete(`/api/v1/customer/teams/current/invitations/${id}`).then((r) => r.data),
  changeRole: (userId, role) => axiosInstance.patch(`/api/v1/customer/teams/current/members/${userId}`, { role }).then((r) => r.data),
  removeMember: (userId) => axiosInstance.delete(`/api/v1/customer/teams/current/members/${userId}`).then((r) => r.data),
  leave: () => axiosInstance.post('/api/v1/customer/teams/current/leave').then((r) => r.data),
  // The organization's company domain. Claiming is not proving: the claim is
  // worth nothing until the DNS record is found by `verifyDomain`.
  domain: () => axiosInstance.get('/api/v1/customer/teams/current/domain').then((r) => r.data),
  setDomain: (domain) => axiosInstance.put('/api/v1/customer/teams/current/domain', { domain }).then((r) => r.data),
  verifyDomain: () => axiosInstance.post('/api/v1/customer/teams/current/domain/verify').then((r) => r.data),
  setJoinRule: (rule) => axiosInstance.patch('/api/v1/customer/teams/current/domain/join-rule', rule).then((r) => r.data),
  removeDomain: () => axiosInstance.delete('/api/v1/customer/teams/current/domain').then((r) => r.data),

  // The team's join link. Issuing one returns the raw link exactly once —
  // only its hash is stored, so reading it back later never shows it again.
  joinLink: () => axiosInstance.get('/api/v1/customer/teams/current/join-link').then((r) => r.data),
  issueJoinLink: (opts = {}) => axiosInstance.post('/api/v1/customer/teams/current/join-link', opts).then((r) => r.data),
  revokeJoinLink: () => axiosInstance.delete('/api/v1/customer/teams/current/join-link').then((r) => r.data),
  // Public: what the landing page may show before anyone signs in.
  previewJoinLink: (token) => axiosInstance.get(`/api/v1/public/join/${token}`).then((r) => r.data),
  useJoinLink: (token) => axiosInstance.post(`/api/v1/customer/teams/join/${token}`).then((r) => r.data),

  /** Whether colleagues at the owner's own email domain may be shown this team. */
  setDiscoverability: (on) => axiosInstance
    .patch('/api/v1/customer/teams/current/discoverability', { discoverableByDomain: on })
    .then((r) => r.data),

  // "Somebody at your company is already here" — only ever about the caller's
  // own verified address.
  companyHint: () => axiosInstance.get('/api/v1/customer/teams/company-hint').then((r) => r.data),
  requestCompanyJoin: (teamId) => axiosInstance.post(`/api/v1/customer/teams/company-hint/${teamId}/request`).then((r) => r.data),
  myJoinRequests: () => axiosInstance.get('/api/v1/customer/teams/join-requests/mine').then((r) => r.data),

  // Colleagues asking to be let in, and the answers.
  joinRequests: () => axiosInstance.get('/api/v1/customer/teams/current/join-requests').then((r) => r.data),
  approveJoinRequest: (id) => axiosInstance.post(`/api/v1/customer/teams/current/join-requests/${id}/approve`).then((r) => r.data),
  declineJoinRequest: (id) => axiosInstance.post(`/api/v1/customer/teams/current/join-requests/${id}/decline`).then((r) => r.data),

  /** Organizations the signed-in customer could join because of their own email. */
  discover: () => axiosInstance.get('/api/v1/customer/teams/discover').then((r) => r.data),
  requestJoin: (teamId) => axiosInstance.post(`/api/v1/customer/teams/discover/${teamId}/request`).then((r) => r.data),

  /** What has happened in this team, newest first; `before` pages backwards. */
  activity: (params = {}) => axiosInstance.get('/api/v1/customer/teams/current/activity', { params }).then((r) => r.data),

  // Handing the team over. The owner offers and can take it back; the member
  // it was offered to answers it from `myOffers`.
  ownership: () => axiosInstance.get('/api/v1/customer/teams/current/ownership').then((r) => r.data),
  offerOwnership: (userId) => axiosInstance.post('/api/v1/customer/teams/current/ownership', { userId }).then((r) => r.data),
  cancelOwnership: () => axiosInstance.delete('/api/v1/customer/teams/current/ownership').then((r) => r.data),
  myOffers: () => axiosInstance.get('/api/v1/customer/teams/ownership/mine').then((r) => r.data),
  acceptOwnership: (id) => axiosInstance.post(`/api/v1/customer/teams/ownership/${id}/accept`).then((r) => r.data),
  declineOwnership: (id) => axiosInstance.post(`/api/v1/customer/teams/ownership/${id}/decline`).then((r) => r.data),

  /**
   * Close the team. The server refuses once when credit is left in the wallet
   * and names the amount; `forfeitBalance` is the customer saying yes to that.
   */
  closeTeam: ({ forfeitBalance = false } = {}) => axiosInstance
    .delete('/api/v1/customer/teams/current', { data: { forfeitBalance } })
    .then((r) => r.data),

  /** A Developer's monthly spend limit; `null` removes it. */
  setLimit: (userId, limit) => axiosInstance.patch(`/api/v1/customer/teams/current/members/${userId}/limit`, { limit }).then((r) => r.data),

  /** POST /api/v1/customer/teams — create a team owned by the caller */
  create: (name) => axiosInstance.post('/api/v1/customer/teams', { name }).then((r) => r.data),

  /** POST /api/v1/customer/teams/current/invitations */
  invite: (teamId, email, role) => axiosInstance
    .post('/api/v1/customer/teams/current/invitations', { email, role }, inTeam(teamId))
    .then((r) => r.data),

  /** GET /api/v1/public/invitations/:token — no sign-in needed */
  previewInvitation: (token) => axiosInstance
    .get(`/api/v1/public/invitations/${encodeURIComponent(token)}`)
    .then((r) => r.data),

  /** POST /api/v1/customer/invitations/accept */
  acceptInvitation: (token) => axiosInstance
    .post('/api/v1/customer/invitations/accept', { token })
    .then((r) => r.data),

  /** POST /api/v1/customer/invitations/decline */
  declineInvitation: (token) => axiosInstance
    .post('/api/v1/customer/invitations/decline', { token })
    .then((r) => r.data),

  /** PUT /api/v1/auth/customer/me/team-onboarding — finish or skip it */
  finishOnboarding: () => axiosInstance
    .put('/api/v1/auth/customer/me/team-onboarding')
    .then((r) => r.data),
};

export default teamsApi;
