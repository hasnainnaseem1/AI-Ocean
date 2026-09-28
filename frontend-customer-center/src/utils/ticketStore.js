/**
 * Local-only support ticket store. There's no backend for tickets yet, so
 * this persists to localStorage — enough to build and demo the full create
 * → reply → resolve flow now, and swap for real API calls later without
 * touching the pages that call it.
 */
const STORAGE_KEY = 'aio_support_tickets';

const read = () => {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
};

const write = (tickets) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tickets));
  } catch {
    // Ignore — worst case this session's tickets just don't persist.
  }
};

export const listTickets = () =>
  read().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

export const getTicket = (id) => read().find((t) => t.id === id) || null;

export const createTicket = ({ subject, category, message }) => {
  const tickets = read();
  const ticket = {
    id: `TCK-${1000 + tickets.length + 1}`,
    subject,
    category,
    status: 'open',
    createdAt: new Date().toISOString(),
    messages: [{ id: 1, from: 'user', body: message, at: new Date().toISOString() }],
  };
  write([...tickets, ticket]);
  return ticket;
};

export const addReply = (id, body) => {
  const tickets = read();
  const idx = tickets.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  const lastId = tickets[idx].messages[tickets[idx].messages.length - 1]?.id || 0;
  tickets[idx].messages.push({ id: lastId + 1, from: 'user', body, at: new Date().toISOString() });
  write(tickets);
  return tickets[idx];
};

export const setStatus = (id, status) => {
  const tickets = read();
  const idx = tickets.findIndex((t) => t.id === id);
  if (idx === -1) return null;
  tickets[idx].status = status;
  write(tickets);
  return tickets[idx];
};
