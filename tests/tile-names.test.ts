/** Тесты имён тайлов SRTM и списка тайлов по трассе. */
import { describe, it, expect } from 'bun:test'
import { tileNameAt, requiredTilesForTrack } from '../src/lib/radio/terrain'

describe('Имя тайла SRTM (tileNameAt)', () => {
  it('север/восток с паддингом нулями', () => {
    expect(tileNameAt(44.5, 33.2)).toBe('N44E033')
    expect(tileNameAt(7.1, 5.4)).toBe('N07E005')
  })
  it('юг и запад: S/W и абсолютные значения', () => {
    // floor(-23.7) = −24 → тайл S24 (покрывает −24…−23), floor(-46.3) = −47 → W047
    expect(tileNameAt(-23.7, -46.3)).toBe('S24W047')
    expect(tileNameAt(0.5, -0.5)).toBe('N00W001')
  })
  it('граница целого градуса относится к южному тайлу', () => {
    // floor(45)=45 → N45 (тайл начинается в 45° и идёт к северу)
    expect(tileNameAt(45, 36)).toBe('N45E036')
    expect(tileNameAt(44.999, 36.999)).toBe('N44E036')
  })
})

describe('Тайлы по трассе (requiredTilesForTrack)', () => {
  it('короткая трасса внутри одного тайла — ровно один тайл', () => {
    const tiles = requiredTilesForTrack({ lat: 50.1, lon: 36.2 }, { lat: 50.5, lon: 36.6 })
    expect(tiles).toEqual(['N50E036'])
  })
  it('трасса через границу тайлов даёт несколько соседних имён', () => {
    // широта пересекает 51° на 25% трассы, долгота — на 50% → три тайла
    const tiles = requiredTilesForTrack({ lat: 50.9, lon: 36.5 }, { lat: 51.3, lon: 37.5 })
    expect(tiles.length).toBeGreaterThanOrEqual(3)
    expect(tiles).toContain('N50E036')
    expect(tiles).toContain('N51E036')
    expect(tiles).toContain('N51E037')
    // все имена валидного формата
    for (const t of tiles) expect(t).toMatch(/^[NS]\d{2}[EW]\d{3}$/)
  })
  it('трасса вдоль границы (вертикаль) не пропускает тайлы', () => {
    const tiles = requiredTilesForTrack({ lat: 50.2, lon: 37.0 }, { lat: 52.2, lon: 37.0 })
    for (const lat of [50, 51, 52]) expect(tiles).toContain(`N${String(lat).padStart(2, '0')}E037`)
  })
})
