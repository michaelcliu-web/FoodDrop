import pg from 'pg'

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL
    ?? 'postgres://fooddrop:dev@localhost:5433/fooddrop',
})