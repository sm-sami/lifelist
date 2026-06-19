import { HTTPException } from "hono/http-exception";
import type { DuplicateMatch } from "./dedup";

export class DuplicateItemError extends HTTPException {
  constructor(match: DuplicateMatch) {
    super(409, {
      res: new Response(
        JSON.stringify({
          error: "duplicate_item",
          message: `This looks like "${match.title}" which is already on your list.`,
          match: {
            id: match.id,
            title: match.title,
            similarity: match.similarity,
          },
        }),
        { status: 409, headers: { "Content-Type": "application/json" } },
      ),
    });
  }
}
