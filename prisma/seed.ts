import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const USERS = [
  { username: "alice", displayName: "Alice Nguyen", avatarColor: "#5b8def" },
  { username: "bob", displayName: "Bob Martins", avatarColor: "#e0698b" },
  { username: "carol", displayName: "Carol Ferreira", avatarColor: "#4bb1a6" },
];

async function main() {
  const passwordHash = await bcrypt.hash("password", 10);

  const users = [];
  for (const u of USERS) {
    users.push(
      await prisma.user.upsert({
        where: { username: u.username },
        update: {},
        create: { ...u, passwordHash },
      })
    );
  }

  const [alice, bob] = users;

  const existing = await prisma.conversation.findFirst({
    where: {
      isGroup: false,
      AND: [
        { members: { some: { userId: alice.id } } },
        { members: { some: { userId: bob.id } } },
      ],
    },
  });

  if (!existing) {
    const convo = await prisma.conversation.create({
      data: {
        isGroup: false,
        members: { create: [{ userId: alice.id }, { userId: bob.id }] },
      },
    });

    const scripted = [
      { senderId: alice.id, body: "Hey Bob! Ready for the demo tomorrow?" },
      { senderId: bob.id, body: "Yep — just going through the reliability checklist now." },
      { senderId: alice.id, body: "Nice. Typing indicators and read receipts are both working." },
      { senderId: bob.id, body: "And reconnects replay the outbox. We're in good shape 🎉" },
    ];
    let t = Date.now() - scripted.length * 60_000;
    for (const m of scripted) {
      await prisma.message.create({
        data: {
          conversationId: convo.id,
          senderId: m.senderId,
          clientId: `seed_${t}`,
          kind: "TEXT",
          body: m.body,
          status: "READ",
          createdAt: new Date(t),
        },
      });
      t += 60_000;
    }
  }

  console.log("Seeded users: alice / bob / carol  (password: \"password\")");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
