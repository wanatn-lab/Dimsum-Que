import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

const MIN_BASKETS = 1;
const MAX_BASKETS = 50;
const MIN_DURATION = 60;
const MAX_DURATION = 1800;
const OVERDUE_LIMIT_AFTER_ZERO = 60;
const AUTO_CLOSE_OVERDUE_SECONDS = 40 * 60;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export const getPots = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db.query("pots").withIndex("by_reservedAt").collect();
  },
});

export const getHistory = query({
  args: {
    dayStart: v.number(),
    dayEnd: v.number(),
  },
  handler: async (ctx, { dayStart, dayEnd }) => {
    return await ctx.db
      .query("history")
      .withIndex("by_servedAt", (q) => q.gte("servedAt", dayStart).lt("servedAt", dayEnd))
      .collect();
  },
});

export const createPot = mutation({
  args: {
    potId: v.string(),
    table: v.string(),
    duration: v.number(),
    isFix: v.boolean(),
    isTakeaway: v.boolean(),
  },
  handler: async (ctx, args) => {
    const table = args.table.trim();
    if (!table) throw new Error("กรุณาใส่หมายเลขโต๊ะ");
    return await ctx.db.insert("pots", {
      potId: args.potId,
      status: "reserved",
      table,
      baskets: 1,
      duration: clamp(args.duration, MIN_DURATION, MAX_DURATION),
      reservedAt: Date.now(),
      isFix: args.isFix,
      isTakeaway: args.isTakeaway,
      wasMoved: false,
    });
  },
});

export const adjustBaskets = mutation({
  args: { id: v.id("pots"), delta: v.number() },
  handler: async (ctx, { id, delta }) => {
    const pot = await ctx.db.get(id);
    if (!pot || pot.status !== "reserved") return false;
    const baskets = clamp(pot.baskets + Math.trunc(delta), MIN_BASKETS, MAX_BASKETS);
    if (baskets !== pot.baskets) await ctx.db.patch(id, { baskets });
    return true;
  },
});

export const adjustDuration = mutation({
  args: { id: v.id("pots"), delta: v.number() },
  handler: async (ctx, { id, delta }) => {
    const pot = await ctx.db.get(id);
    if (!pot || pot.status !== "reserved") return false;
    const duration = clamp(pot.duration + Math.trunc(delta), MIN_DURATION, MAX_DURATION);
    if (duration !== pot.duration) await ctx.db.patch(id, { duration });
    return true;
  },
});

export const startSteaming = mutation({
  args: { id: v.id("pots") },
  handler: async (ctx, { id }) => {
    const pot = await ctx.db.get(id);
    if (!pot || pot.status !== "reserved") return false;
    await ctx.db.patch(id, { status: "active", startedAt: Date.now() });
    return true;
  },
});

export const editTable = mutation({
  args: { id: v.id("pots"), table: v.string() },
  handler: async (ctx, { id, table }) => {
    const pot = await ctx.db.get(id);
    const cleanTable = table.trim();
    if (!pot || !cleanTable) return false;
    if (pot.table !== cleanTable) {
      await ctx.db.patch(id, { table: cleanTable, wasMoved: true });
    }
    return true;
  },
});

export const removePot = mutation({
  args: { id: v.id("pots") },
  handler: async (ctx, { id }) => {
    const pot = await ctx.db.get(id);
    if (!pot) return false;
    await ctx.db.delete(id);
    return true;
  },
});

export const completePot = mutation({
  args: { id: v.id("pots") },
  handler: async (ctx, { id }) => {
    const pot = await ctx.db.get(id);
    if (!pot || pot.status !== "active" || !pot.startedAt) return false;

    const servedAt = Date.now();
    const cookSeconds = Math.max(0, Math.floor((servedAt - pot.startedAt) / 1000));
    await ctx.db.insert("history", {
      potId: pot.potId,
      table: pot.table,
      baskets: pot.baskets,
      isFix: !!pot.isFix,
      isTakeaway: !!pot.isTakeaway,
      wasMoved: !!pot.wasMoved,
      wasOverdue: cookSeconds - pot.duration > OVERDUE_LIMIT_AFTER_ZERO,
      autoClose: false,
      startedAt: pot.startedAt,
      servedAt,
      cookSeconds,
    });
    await ctx.db.delete(id);
    return true;
  },
});

export const autoClosePot = mutation({
  args: { id: v.id("pots") },
  handler: async (ctx, { id }) => {
    const pot = await ctx.db.get(id);
    if (!pot || pot.status !== "active" || !pot.startedAt) return false;

    const servedAt = Date.now();
    const cookSeconds = Math.max(0, Math.floor((servedAt - pot.startedAt) / 1000));
    if (cookSeconds - pot.duration < AUTO_CLOSE_OVERDUE_SECONDS) return false;

    await ctx.db.insert("history", {
      potId: pot.potId,
      table: pot.table,
      baskets: pot.baskets,
      isFix: !!pot.isFix,
      isTakeaway: !!pot.isTakeaway,
      wasMoved: !!pot.wasMoved,
      wasOverdue: true,
      autoClose: true,
      startedAt: pot.startedAt,
      servedAt,
      cookSeconds,
    });
    await ctx.db.delete(id);
    return true;
  },
});
