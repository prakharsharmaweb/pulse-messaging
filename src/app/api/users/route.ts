import { prisma } from "@/lib/prisma";
import { apiError, json, requireUser } from "@/lib/api";

/** User directory search — used to start new conversations. */
export async function GET(req: Request) {
  const auth = await requireUser();
  if ("response" in auth) return auth.response;

  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";

  const users = await prisma.user.findMany({
    where: {
      id: { not: auth.user.id },
      ...(q
        ? {
            OR: [
              { username: { contains: q, mode: "insensitive" } },
              { displayName: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, username: true, displayName: true, avatarColor: true },
    orderBy: { displayName: "asc" },
    take: 15,
  });

  return json({ users });
}

export async function POST() {
  return apiError(405, "Method not allowed.");
}
