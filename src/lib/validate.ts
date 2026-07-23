import * as v from "valibot";

// Server-side input validation shared by all "use server" functions.
// Client-generated ids are allowed (optimistic inserts) but must be UUIDs.

export const Id = v.pipe(v.string(), v.uuid());

/** better-auth generated ids (user/org/member/invitation) are nanoid-style, not UUIDs. */
export const AuthId = v.pipe(v.string(), v.regex(/^[A-Za-z0-9_-]{1,64}$/));

/** Trimmed single-line name/title: 1–120 chars. */
export const ShortText = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(120));

/** Free text (notes, specs): up to 4000 chars, may be empty. */
export const LongText = v.pipe(v.string(), v.maxLength(4000));

/** Comment bodies: non-empty after trim, capped. */
export const CommentBody = v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(4000));

export const FiniteNumber = v.pipe(v.number(), v.finite());

/** Normalized 0–1 coordinate (annotation pins). */
export const Norm01 = v.pipe(v.number(), v.minValue(0), v.maxValue(1));

export const DecisionSchema = v.picklist(["approved", "revision_requested"]);

export const AnnotationStatusSchema = v.picklist([
  "open",
  "resolved_approved",
  "resolved_revision",
]);

export const OrgRoleSchema = v.picklist(["owner", "admin", "member", "guest"]);

export const NoteColorSchema = v.picklist(["yellow", "pink", "blue", "green"]);

/** Free-text sticky-note tags: up to 8, each a short trimmed label. */
export const TagList = v.pipe(
  v.array(v.pipe(v.string(), v.trim(), v.minLength(1), v.maxLength(30))),
  v.maxLength(8),
);

export const PersonalPositionKindSchema = v.picklist(["deliverable", "note"]);

/** Global search box input, including any `key:value` tokens. */
export const SearchQuery = v.pipe(v.string(), v.trim(), v.maxLength(200));

export function parseOrThrow<TSchema extends v.GenericSchema>(
  schema: TSchema,
  value: unknown,
): v.InferOutput<TSchema> {
  const result = v.safeParse(schema, value);
  if (!result.success) throw new Error("Invalid input");
  return result.output;
}
