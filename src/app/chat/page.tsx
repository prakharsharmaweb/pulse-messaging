import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { listConversations } from "@/server/conversations";
import ChatApp from "@/components/chat/ChatApp";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const me = await getSessionUser();
  if (!me) redirect("/login");

  const conversations = await listConversations(me.id);

  return <ChatApp me={me} initialConversations={conversations} />;
}
