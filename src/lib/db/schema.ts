import { sql } from 'drizzle-orm'
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core'

/**
 * Identity is an anonymous browser id, not an account. It scopes "my functions"
 * without a login wall; swapping it for a real user id later is a column
 * rename, not a schema rewrite.
 */
export const owners = pgTable('owners', {
  id: uuid('id').primaryKey(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const functions = pgTable(
  'functions',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id'),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    code: text('code').notNull(),
    params: jsonb('params').notNull().default({}),
    isBuiltin: boolean('is_builtin').notNull().default(false),
    /** Editing a saved function writes a new row pointing at the old one, so a
     *  historical run always resolves to the code that actually ran. */
    version: integer('version').notNull().default(1),
    parentId: uuid('parent_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    byOwner: index('functions_owner_kind_idx').on(t.ownerId, t.kind),
  })
)

export const configs = pgTable(
  'configs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id'),
    name: text('name').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byOwner: index('configs_owner_idx').on(t.ownerId) })
)

/**
 * The full per-replication result is stored, not just a summary. It is the
 * expensive thing to recompute, and the paired tests in Compare need the
 * individual replications — a mean cannot be un-averaged. A 500-replication run
 * is a few hundred KB of JSON.
 */
export const runs = pgTable(
  'runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    ownerId: uuid('owner_id'),
    label: text('label').notNull(),
    config: jsonb('config').notNull(),
    result: jsonb('result').notNull(),
    /** Denormalised for cheap listing and sorting without parsing the payload. */
    seed: integer('seed').notNull(),
    replications: integer('replications').notNull(),
    kendallTau: doublePrecision('kendall_tau'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byOwner: index('runs_owner_idx').on(t.ownerId, t.createdAt) })
)
