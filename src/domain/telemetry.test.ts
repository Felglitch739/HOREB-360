import { describe, expect, it } from 'vitest';
import { getMatamorosDateAndHour } from './reconciliation';
import {
  buildMockThinqPreviewFeed,
  formatThinqStateLabel,
  mapThinqRunStateToMachineStatus,
} from './telemetry';

describe('Telemetría LG ThinQ (MockUp / Demo) y horario Matamoros', () => {
  it('calcula correctamente la hora de verano e invierno de America/Matamoros', () => {
    // 18 nov 2026 (horario estándar UTC-6): 05:05Z -> 23:05 del día 17 en Matamoros
    expect(getMatamorosDateAndHour('2026-11-18T05:05:00Z')).toEqual({
      localDate: '2026-11-17',
      hour: 23,
    });
    // 15 jul 2026 (horario de verano frontera UTC-5): 04:05Z -> 23:05 del día 14 en Matamoros
    expect(getMatamorosDateAndHour('2026-07-15T04:05:00Z')).toEqual({
      localDate: '2026-07-14',
      hour: 23,
    });
  });

  it('mapea estados de LG ThinQ Connect y genera feed MockUp / Demo', () => {
    expect(mapThinqRunStateToMachineStatus('RUNNING')).toBe('en_uso');
    expect(mapThinqRunStateToMachineStatus('END')).toBe('disponible');
    expect(mapThinqRunStateToMachineStatus('ERROR')).toBe('fuera_de_servicio');

    const demoFeed = buildMockThinqPreviewFeed([], []);
    expect(demoFeed).toHaveLength(2);
    expect(demoFeed.every((item) => item.isMockDemo)).toBe(true);
    expect(formatThinqStateLabel(demoFeed[0])).toContain('En ciclo');
  });
});
