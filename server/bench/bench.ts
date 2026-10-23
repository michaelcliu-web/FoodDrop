//Load-tests the main routes and saves the results so you can compare before/after a change.
//
//  npm run bench -- --label before
//  (make a change)
//  npm run bench -- --label after          <- prints the change vs. the previous run
//
//Options: --label <name>  --duration <sec, default 10>  --connections <default 50>
//         --seed <n>  insert n expired drops first, to simulate a big table (e.g. to test an index)
//
//The server must be running (npm run dev). Everything the benchmark creates is tagged "[bench]" and deleted at the end.

import autocannon from 'autocannon'
import { execSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createClient } from 'redis'
import { pool } from '../src/db'

const BASE = process.env.BENCH_URL ?? 'http://localhost:3000'
const TAG = '[bench]'
const RESULTS_DIR = path.join(__dirname, 'results')

function arg(name: string, fallback: string) {
    const i = process.argv.indexOf(`--${name}`)
    return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const label = arg('label', 'run')
const duration = Number(arg('duration', '10'))
const connections = Number(arg('connections', '50'))
const seed = Number(arg('seed', '0'))

const redis = createClient({ url: 'redis://localhost:6379' })

type ScenarioResult = {
    rps: number
    p50: number
    p90: number
    p99: number
    max: number
    non2xx: number
    errors: number
    steps: Record<string, { count: number; p50: number; p99: number; avg: number }>
}

//route is the startTimer name in index.ts ('claim', 'list', 'post'); only that route's steps are kept
async function runScenario(title: string, route: string, opts: autocannon.Options): Promise<ScenarioResult> {
    console.log(`\n▶ ${title}`)
    await fetch(`${BASE}/api/debug/timings`, { method: 'DELETE' })
    const r = await autocannon({ connections, duration, ...opts })
    //let requests still in flight finish, so they don't leak into the next scenario's numbers
    await new Promise(resolve => setTimeout(resolve, 1000))
    const all: ScenarioResult['steps'] = await (await fetch(`${BASE}/api/debug/timings`)).json()
    const steps = Object.fromEntries(Object.entries(all).filter(([key]) => key.startsWith(`${route}.`)))
    return {
        rps: Math.round(r.requests.average),
        p50: r.latency.p50,
        p90: r.latency.p90,
        p99: r.latency.p99,
        max: r.latency.max,
        non2xx: r.non2xx,
        errors: r.errors + r.timeouts,
        steps,
    }
}

//Removes every row/key the benchmark made, so runs don't pile up and skew each other
async function cleanup() {
    const { rows } = await pool.query(`DELETE FROM drops WHERE title LIKE $1 RETURNING id`, [`${TAG}%`])
    const keys = rows.map(r => `drop:${r.id}`)
    for (let i = 0; i < keys.length; i += 1000) await redis.del(keys.slice(i, i + 1000))
    return rows.length
}

function gitVersion() {
    try {
        const hash = execSync('git rev-parse --short HEAD').toString().trim()
        const dirty = execSync('git status --porcelain').toString().trim() ? '+uncommitted' : ''
        return hash + dirty
    } catch {
        return 'unknown'
    }
}

function pct(before: number, after: number) {
    if (!before) return ''
    const change = ((after - before) / before) * 100
    return `${change > 0 ? '+' : ''}${change.toFixed(0)}%`
}

async function main() {
    await redis.connect()
    try {
        await fetch(`${BASE}/api/debug/timings`)
    } catch {
        throw new Error(`Server not reachable at ${BASE}. Start it with npm run dev first.`)
    }

    const leftover = await cleanup()
    if (leftover) console.log(`Removed ${leftover} leftover bench drops from a previous run`)

    if (seed) {
        await pool.query(
            `INSERT INTO drops (title, location, quantity, ends_at, created_at)
             SELECT $1, 'bench', 1, now() - interval '1 day', now() - interval '1 day' FROM generate_series(1, $2)`,
            [`${TAG} seed`, seed]
        )
        console.log(`Seeded ${seed} expired drops`)
    }
    const { rows: [{ count: tableRows }] } = await pool.query('SELECT count(*)::int AS count FROM drops')

    //One drop with a huge quantity so every claim succeeds: this measures the success path under contention on one row
    const hot = await (await fetch(`${BASE}/api/drops`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: `${TAG} hot`, loc: 'bench', desc: '', quantity: 10_000_000, time: 60 }),
    })).json()

    const json = { 'content-type': 'application/json' }
    const scenarios: Record<string, ScenarioResult> = {}
    try {
        scenarios['claim (one hot drop)'] = await runScenario('claim (one hot drop)', 'claim', {
            url: `${BASE}/api/claims`, method: 'POST', headers: json, body: JSON.stringify({ dropId: hot.dropId }),
        })
        scenarios['list drops'] = await runScenario('list drops', 'list', { url: `${BASE}/api/drops` })
        scenarios['post drop'] = await runScenario('post drop', 'post', {
            url: `${BASE}/api/drops`, method: 'POST', headers: json,
            body: JSON.stringify({ title: `${TAG} post`, loc: 'bench', desc: '', quantity: 1, time: 1 }),
        })
    } finally {
        const removed = await cleanup()
        console.log(`\nCleaned up ${removed} bench drops`)
    }

    //Overall results
    console.log(`\n=== ${label}: ${connections} connections × ${duration}s, ${tableRows} rows in drops ===`)
    console.table(Object.fromEntries(Object.entries(scenarios).map(([name, s]) =>
        [name, { 'req/s': s.rps, 'p50 ms': s.p50, 'p90 ms': s.p90, 'p99 ms': s.p99, 'max ms': s.max, 'non-2xx': s.non2xx, errors: s.errors }]
    )))

    //Where the time goes inside the server
    console.log('Server-side time per step (ms):')
    const stepRows: Record<string, object> = {}
    for (const s of Object.values(scenarios)) {
        for (const [step, t] of Object.entries(s.steps)) stepRows[step] = { p50: t.p50, p99: t.p99, avg: t.avg, count: t.count }
    }
    console.table(stepRows)

    //Save, then compare with the previous run
    fs.mkdirSync(RESULTS_DIR, { recursive: true })
    const previousFile = fs.readdirSync(RESULTS_DIR).filter(f => f.endsWith('.json')).sort().pop()
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const file = path.join(RESULTS_DIR, `${stamp}-${label}.json`)
    const config = { connections, duration, tableRows, seed }
    fs.writeFileSync(file, JSON.stringify({ label, date: new Date().toISOString(), git: gitVersion(), config, scenarios }, null, 2))
    console.log(`Saved ${path.relative(process.cwd(), file)}`)

    if (previousFile) {
        const prev = JSON.parse(fs.readFileSync(path.join(RESULTS_DIR, previousFile), 'utf8'))
        console.log(`\n=== Compared with previous run "${prev.label}" (${prev.git}) ===`)
        if (JSON.stringify(prev.config) !== JSON.stringify(config)) {
            console.log(`⚠ Settings differ (before ${JSON.stringify(prev.config)}, now ${JSON.stringify(config)}), so the comparison is not apples to apples`)
        }
        const diff: Record<string, object> = {}
        for (const [name, s] of Object.entries(scenarios)) {
            const p = prev.scenarios[name]
            if (!p) continue
            diff[name] = {
                'req/s': `${p.rps} → ${s.rps} (${pct(p.rps, s.rps)})`,
                'p50 ms': `${p.p50} → ${s.p50} (${pct(p.p50, s.p50)})`,
                'p99 ms': `${p.p99} → ${s.p99} (${pct(p.p99, s.p99)})`,
            }
        }
        console.table(diff)
        console.log('Lower ms and higher req/s are better. Run each a couple of times; differences under ~10% are usually noise.')
    }
}

main()
    .catch(err => { console.error(err.message ?? err); process.exitCode = 1 })
    .finally(async () => { await pool.end(); await redis.quit().catch(() => {}) })
