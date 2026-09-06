import { apiError, json, requireUser } from "@/lib/api";
import { getMessages, MessageError } from "@/server/messages";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const cursor = new URL(req.url).searchParams.get("cursor");

  try {
    const page = await getMessages(params.id, auth.user.id, cursor);
    return json(page);
  } catch (err) {
    if (err instanceof MessageError) {
      return apiError(err.code === "FORBIDDEN" ? 403 : 400, err.message);
    }
    throw err;
  }
}
