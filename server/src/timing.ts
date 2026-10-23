import type { Response } from 'express'

//Per-step durations (ms) collected since the last reset, keyed like "claim.postgres"
const samples = new Map<string, number[]>()
const MAX_SAMPLES = 100_000

function record(key: string, ms: number) {
    const arr = samples.get(key) ?? []
    if (arr.length < MAX_SAMPLES) arr.push(ms)
    samples.set(key, arr)
}

//Times the steps of one request: call mark('step') after each await, then done() right before sending the response
export function startTimer(route: string, res: Response) {
    const start = performance.now()
    let last = start
    const steps: string[] = []

    return {
        mark(step: string) {
            const now = performance.now()
            record(`${route}.${step}`, now - last)
            steps.push(`${step};dur=${(now - last).toFixed(2)}`)
            last = now
        },
        //Also sets the Server-Timing header, which shows up in browser DevTools > Network > Timing
        done() {
            const total = performance.now() - start
            record(`${route}.total`, total)
            steps.push(`total;dur=${total.toFixed(2)}`)
            res.set('Server-Timing', steps.join(', '))
            if (process.env.TIMING_LOG) console.log(route, steps.join(' | '))
        },
    }
}

function percentile(sorted: number[], p: number) {
    return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]
}

const round = (n: number) => Math.round(n * 100) / 100

//p50/p99/avg per step, used by the benchmark script (GET /api/debug/timings)
export function timingSummary() {
    const out: Record<string, { count: number; p50: number; p99: number; avg: number }> = {}
    for (const [key, arr] of samples) {
        const sorted = [...arr].sort((a, b) => a - b)
        const avg = sorted.reduce((sum, n) => sum + n, 0) / sorted.length
        out[key] = { count: sorted.length, p50: round(percentile(sorted, 0.5)), p99: round(percentile(sorted, 0.99)), avg: round(avg) }
    }
    return out
}

export function resetTimings() {
    samples.clear()
}
