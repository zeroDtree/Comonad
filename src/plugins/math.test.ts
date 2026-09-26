import { describe, expect, it } from 'vitest'
import { convert, evaluate, formatSummary, percentile, summarize } from './math.ts'

describe('evaluate', () => {
  it('respects precedence, parentheses, and right-associative powers', () => {
    expect(evaluate('1+2*3')).toBe(7)
    expect(evaluate('(1+2)*3')).toBe(9)
    expect(evaluate('2^3^2')).toBe(512)
    expect(evaluate('-2^2')).toBe(-4)
    expect(evaluate('7%4')).toBe(3)
  })

  it('evaluates functions and constants', () => {
    expect(evaluate('sqrt(9)')).toBe(3)
    expect(evaluate('sin(pi/2)')).toBeCloseTo(1)
    expect(evaluate('log(100)')).toBe(2)
    expect(evaluate('log(8, 2)')).toBe(3)
    expect(evaluate('min(3, 1, 2)')).toBe(1)
    expect(evaluate('abs(-4) + floor(1.9)')).toBe(5)
  })

  it('rejects empty, junk, and non-finite results', () => {
    expect(() => evaluate('')).toThrow('empty expression')
    expect(() => evaluate('1+')).toThrow('unexpected end of expression')
    expect(() => evaluate('1/0')).toThrow('result is not finite')
    expect(() => evaluate('foo(1)')).toThrow("unknown function 'foo'")
  })
})

describe('summarize', () => {
  it('reports sample variance and the interpolated median', () => {
    const summary = summarize([1, 2, 3, 4])
    expect(summary).toMatchObject({ count: 4, sum: 10, min: 1, max: 4, mean: 2.5, median: 2.5 })
    expect(summary.variance).toBeCloseTo(5 / 3)
    expect(summary.stddev).toBeCloseTo(Math.sqrt(5 / 3))
    expect(formatSummary(summary)).toContain('variance: ')
  })

  it('leaves variance undefined for a single value and rejects an empty list', () => {
    expect(summarize([3])).toMatchObject({ count: 1, mean: 3, variance: null, stddev: null })
    expect(formatSummary(summarize([3]))).toContain('variance: n/a')
    expect(() => summarize([])).toThrow('numbers must not be empty')
  })
})

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4], 0)).toBe(1)
    expect(percentile([1, 2, 3, 4], 100)).toBe(4)
    expect(percentile([1, 2, 3, 4], 50)).toBe(2.5)
    expect(percentile([8], 40)).toBe(8)
  })

  it('rejects an out-of-range percentile', () => {
    expect(() => percentile([1], 101)).toThrow('p must be between 0 and 100')
  })
})

describe('convert', () => {
  it('converts length, temperature, and byte size', () => {
    expect(convert(1, 'km', 'm')).toBe(1000)
    expect(convert(32, 'F', 'C')).toBeCloseTo(0)
    expect(convert(0, 'C', 'K')).toBeCloseTo(273.15)
    expect(convert(1, 'KB', 'B')).toBe(1024)
  })

  it('rejects unknown units and mixed kinds', () => {
    expect(() => convert(1, 'm', 'kg')).toThrow('cannot convert m to kg')
    expect(() => convert(1, 'foo', 'm')).toThrow("unknown unit 'foo'")
  })
})
