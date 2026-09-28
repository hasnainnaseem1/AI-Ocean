-- DropForeignKey
ALTER TABLE "custom_roles" DROP CONSTRAINT "custom_roles_created_by_id_fkey";

-- DropForeignKey
ALTER TABLE "customer_notes" DROP CONSTRAINT "customer_notes_author_id_fkey";

-- AlterTable
ALTER TABLE "custom_roles" ALTER COLUMN "created_by_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "customer_notes" ALTER COLUMN "author_id" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "custom_roles" ADD CONSTRAINT "custom_roles_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_notes" ADD CONSTRAINT "customer_notes_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
