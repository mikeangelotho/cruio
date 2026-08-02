import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { getDb } from "../../../db";
import { aiConversations, aiMessages, aiUsage, member } from "../../../db/schema";
import { getSession } from "../../../lib/guard";
import { runAsActor } from "../../../lib/actor";
import type { OrgRole } from "../../../lib/permissions";
import { runAgentLoop, type LoopEvent } from "../../../lib/ai/loop";
import { MODEL, aiConfigured } from "../../../lib/ai/model";

type Msg = Anthropic.Beta.BetaMessageParam;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST({ request }: { request: Request }) {
  const session = await getSession(request.headers);
  if (!session) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const orgId = session.activeOrganizationId;
  if (!orgId) {
    return Response.json({ error: "No active workspace." }, { status: 400 });
  }

  const db = await getDb();
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, session.userId)));
  if (!m) return Response.json({ error: "Forbidden" }, { status: 403 });

  // Guests are external client reviewers — no assistant, by design.
  const role = m.role as OrgRole;
  if (role === "guest") {
    return Response.json({ error: "The assistant is not available to guests." }, { status: 403 });
  }

  if (!aiConfigured) {
    return Response.json(
      { error: "The assistant is not configured. Set ANTHROPIC_API_KEY or AI_BASE_URL." },
      { status: 503 },
    );
  }

  const body = (await request.json().catch(() => null)) as {
    message?: string;
    conversationId?: string | null;
    pathname?: string;
  } | null;

  const text = body?.message?.trim();
  if (!text) return Response.json({ error: "message is required" }, { status: 400 });

  const now = Date.now();

  // Resume or start a conversation. Ownership is checked on resume so a
  // guessed id cannot read someone else's thread.
  let conversationId = body?.conversationId ?? null;
  let history: Msg[] = [];
  let seq = 0;

  if (conversationId) {
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
    if (!conv) conversationId = null;
  }

  if (conversationId) {
    const rows = await db
      .select({ role: aiMessages.role, content: aiMessages.content, seq: aiMessages.seq })
      .from(aiMessages)
      .where(eq(aiMessages.conversationId, conversationId))
      .orderBy(asc(aiMessages.seq));
    history = rows.map(r => ({ role: r.role, content: JSON.parse(r.content) }) as Msg);
    seq = rows.length ? rows[rows.length - 1].seq + 1 : 0;
  } else {
    conversationId = randomUUID();
    await db.insert(aiConversations).values({
      id: conversationId,
      organizationId: orgId,
      userId: session.userId,
      title: text.slice(0, 80),
      state: "running",
      createdAt: now,
      updatedAt: now,
    });
  }

  const convId = conversationId;
  const userMessage: Msg = { role: "user", content: [{ type: "text", text }] };
  await db.insert(aiMessages).values({
    id: randomUUID(),
    conversationId: convId,
    seq: seq++,
    role: "user",
    content: JSON.stringify(userMessage.content),
    createdAt: now,
  });

  const encoder = new TextEncoder();
  const abort = new AbortController();
  request.signal?.addEventListener("abort", () => abort.abort(), { once: true });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const write = (event: string, data: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(sse(event, data)));
        } catch {
          closed = true;
        }
      };

      write("conversation", { id: convId });

      const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
      const emit = (e: LoopEvent) => {
        if (e.type === "usage") {
          totals.input += e.inputTokens;
          totals.output += e.outputTokens;
          totals.cacheRead += e.cacheReadTokens;
          totals.cacheWrite += e.cacheWriteTokens;
          return;
        }
        const { type, ...rest } = e;
        write(type, rest);
      };

      try {
        // Explicit actor rather than relying on the ambient request event:
        // this stream outlives the handler that created it.
        const outcome = await runAsActor(
          {
            userId: session.userId,
            name: session.name,
            email: session.email,
            organizationId: orgId,
            role,
            source: "chat",
          },
          () =>
            runAgentLoop({
              messages: [...history, userMessage],
              pathname: body?.pathname ?? "/",
              emit,
              signal: abort.signal,
            }),
        );

        // Persist everything the loop appended after the user's turn.
        const appended = outcome.messages.slice(history.length + 1);
        for (const msg of appended) {
          // The page-context system message is per-request, not history.
          if (msg.role === "system") continue;
          await db.insert(aiMessages).values({
            id: randomUUID(),
            conversationId: convId,
            seq: seq++,
            role: msg.role,
            content: JSON.stringify(msg.content),
            createdAt: Date.now(),
          });
        }

        if (totals.input || totals.output) {
          await db.insert(aiUsage).values({
            id: randomUUID(),
            organizationId: orgId,
            userId: session.userId,
            conversationId: convId,
            model: MODEL,
            inputTokens: totals.input,
            outputTokens: totals.output,
            cacheReadTokens: totals.cacheRead,
            cacheWriteTokens: totals.cacheWrite,
            createdAt: Date.now(),
          });
        }

        await db
          .update(aiConversations)
          .set({ state: "idle", updatedAt: Date.now() })
          .where(eq(aiConversations.id, convId));

        write("done", { stopped: outcome.stopped });
      } catch (e) {
        write("error", { message: e instanceof Error ? e.message : String(e) });
        await db
          .update(aiConversations)
          .set({ state: "error", updatedAt: Date.now() })
          .where(eq(aiConversations.id, convId));
      } finally {
        closed = true;
        try {
          controller.close();
        } catch {
          /* already closed by the client disconnecting */
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      // no-transform stops intermediaries recompressing (and so buffering) it.
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
