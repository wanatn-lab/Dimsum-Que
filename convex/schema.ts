import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  pots: defineTable({
    potId: v.string(),
    status: v.union(v.literal("reserved"), v.literal("active")),
    table: v.string(),
    baskets: v.number(),
    duration: v.number(),
    reservedAt: v.number(),
    startedAt: v.optional(v.number()),
    isFix: v.optional(v.boolean()),
    isTakeaway: v.optional(v.boolean()),
    wasMoved: v.optional(v.boolean()),
  })
    .index("by_status", ["status"])
    .index("by_reservedAt", ["reservedAt"]),

  history: defineTable({
    potId: v.string(),
    table: v.string(),
    baskets: v.number(),
    isFix: v.boolean(),
    isTakeaway: v.boolean(),
    wasMoved: v.boolean(),
    wasOverdue: v.boolean(),
    autoClose: v.boolean(),
    startedAt: v.number(),
    servedAt: v.number(),
    cookSeconds: v.number(),
  }).index("by_servedAt", ["servedAt"]),
});
