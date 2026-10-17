-- Support Tickets.
--
-- The customer center's ticket screens have existed for a while with no
-- backend behind them — everything lived in the browser's localStorage. This
-- gives them a real table.
--
-- A ticket belongs to the User who raised it, not to a Team: this is a person
-- asking a question, and it carries none of the team-billing machinery the
-- rest of the customer API runs through.
--
-- `support_tickets.number` is a separate sequential integer purely for
-- display ("TCK-1001"), kept apart from the real `id` primary key the same
-- way every other resource in this app keeps its public id apart from its
-- internal one.
--
-- `assigned_admin_id` on the ticket and `author_id` on each message are both
-- nullable and SET NULL on delete, with the name denormalised alongside them
-- — the same shape `customer_notes.author_id` / `author_name` already uses:
-- an assignment, or a message, must stay readable and attributable after the
-- person who made it is no longer an account on the platform.
--
-- `user_id` on the ticket itself is deliberately left to the database
-- default (RESTRICT, no ON DELETE clause) — exactly how `customer_notes.
-- customer_id` is today — so permanently deleting a customer has to clear
-- their tickets explicitly first (services/support/supportTicketService.js
-- gains a deleteAllForUsers, wired into userDeletionService.js's single
-- transaction the same way customerNoteService's already is).

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "number" SERIAL,
    "user_id" UUID NOT NULL,
    "subject" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "assigned_admin_id" UUID,
    "assigned_admin_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_user_id_created_at_idx" ON "support_tickets"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "support_tickets_status_last_message_at_idx" ON "support_tickets"("status", "last_message_at" DESC);

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_status_check"
    CHECK ("status" IN ('open', 'pending', 'solved'));

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON UPDATE CASCADE;

ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assigned_admin_id_fkey"
    FOREIGN KEY ("assigned_admin_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "support_ticket_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ticket_id" UUID NOT NULL,
    "author_type" TEXT NOT NULL,
    "author_id" UUID,
    "author_name" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "support_ticket_messages_ticket_id_created_at_idx" ON "support_ticket_messages"("ticket_id", "created_at" ASC);

ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_author_type_check"
    CHECK ("author_type" IN ('customer', 'admin'));

-- AddForeignKey
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_fkey"
    FOREIGN KEY ("ticket_id") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
