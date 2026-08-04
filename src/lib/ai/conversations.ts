import { and, asc, desc, eq } from "drizzle-orm";
import { getDb } from "../../db";
import { aiConversations, aiMessages } from "../../db/schema";
import { requireSession } from "../guard";
import { hydrateMessages } from "./hydrate";
import type { UiMessage } from "./useChat";

// App-UI plumbing for the chat history dropdown — deliberately outside the
// action registry (src/lib/actions/): this is something the UI needs to show
// the user their own past conversations, not a capability the assistant
// itself should be able to invoke as a tool.

export type ConversationSummary = {
  id: string;
  title: string;
  updatedAt: number;
  state: string;
};

/** The current user's own conversations in the active workspace, newest first. */
export async function listMyConversations(): Promise<ConversationSummary[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];
  const rows = await (await getDb())
    .select({
      id: aiConversations.id,
      title: aiConversations.title,
      updatedAt: aiConversations.updatedAt,
      state: aiConversations.state,
    })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.userId, session.userId),
        eq(aiConversations.organizationId, orgId),
      ),
    )
    .orderBy(desc(aiConversations.updatedAt))
    .limit(50);
  return rows;
}

export type StoredMessage = {
  role: string;
  content: unknown;
};

/**
 * One conversation's persisted messages, in order. Same ownership check as
 * the resume path in routes/api/ai/chat.ts — this reads potentially
 * sensitive tool-result content, so the guard is not optional.
 */
export async function getConversationMessages(
  conversationId: string,
): Promise<StoredMessage[]> {
  "use server";
  const session = await requireSession();
  const orgId = session.activeOrganizationId;
  if (!orgId) return [];

  const db = await getDb();
  const [conv] = await db
    .select({ id: aiConversations.id })
    .from(aiConversations)
    .where(
      and(
        eq(aiConversations.id, conversationId),
        eq(aiConversations.userId, session.userId),
        eq(aiConversations.organizationId, orgId),
      ),
    );
  if (!conv) return [];

  const rows = await db
    .select({ role: aiMessages.role, content: aiMessages.content })
    .from(aiMessages)
    .where(eq(aiMessages.conversationId, conversationId))
    .orderBy(asc(aiMessages.seq));

  return rows.map(r => ({ role: r.role, content: JSON.parse(r.content) }));
}

/** The one call the chat panel actually needs: raw persisted blocks, mapped
 *  into the shape MessageList already knows how to render. */
export async function loadConversation(conversationId: string): Promise<UiMessage[]> {
  "use server";
  const rows = await getConversationMessages(conversationId);
  return hydrateMessages(rows);
}
