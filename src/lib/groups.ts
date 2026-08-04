// Shared Prisma include for group payloads (members + open-ticket count).

import type { Prisma } from "@prisma/client";

export const groupInclude = {
  members: {
    include: {
      user: { select: { id: true, name: true, color: true, role: true } },
    },
    orderBy: { seniority: "asc" },
  },
  _count: {
    select: {
      tickets: { where: { status: { notIn: ["RESOLVED", "CLOSED"] } } },
    },
  },
} satisfies Prisma.GroupInclude;
