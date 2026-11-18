import type { Machine, MachineStatus, Order } from './types.ts';

/**
 * Adaptador de telemetría preparado para LG ThinQ Connect Open API
 * (https://smartsolution.developer.lge.com) mediante Personal Access Token (PAT).
 * En la etapa actual opera exclusivamente en modo MockUp / Demo sin conexión real.
 */
export type TelemetryProvider = 'lg_thinq_connect' | 'samsung_smartthings' | 'manual';

export type ThinqRunState =
  | 'POWER_OFF'
  | 'STANDBY'
  | 'RUNNING'
  | 'PAUSE'
  | 'END'
  | 'ERROR';

export type ThinqProcessPhase =
  | 'DETECTING'
  | 'WASHING'
  | 'RINSING'
  | 'SPINNING'
  | 'DRYING'
  | 'COOL_DOWN'
  | 'COMPLETE'
  | null;

export interface MachineTelemetrySnapshot {
  machineId: string;
  code: string;
  name: string;
  kind: Machine['kind'];
  provider: TelemetryProvider;
  deviceProfile: 'Washer' | 'Dryer';
  runState: ThinqRunState;
  processPhase: ThinqProcessPhase;
  remainingMinutes: number;
  remoteStartEnabled: boolean;
  linkedFolio?: string | null;
  lastEventAt: string;
  isMockDemo: true;
}

const RUN_STATE_LABELS: Record<ThinqRunState, string> = {
  POWER_OFF: 'Apagada',
  STANDBY: 'En espera',
  RUNNING: 'En ciclo',
  PAUSE: 'Pausada',
  END: 'Ciclo terminado',
  ERROR: 'Alerta / error',
};

const PHASE_LABELS: Record<Exclude<ThinqProcessPhase, null>, string> = {
  DETECTING: 'Detectando carga',
  WASHING: 'Lavando',
  RINSING: 'Enjuagando',
  SPINNING: 'Centrifugando',
  DRYING: 'Secando',
  COOL_DOWN: 'Enfriamiento',
  COMPLETE: 'Listo para descargar',
};

export function formatThinqStateLabel(snapshot: MachineTelemetrySnapshot): string {
  const base = RUN_STATE_LABELS[snapshot.runState];
  if (!snapshot.processPhase) return base;
  return `${base} · ${PHASE_LABELS[snapshot.processPhase]}`;
}

/**
 * Traduce un evento oficial de LG ThinQ Connect al estado operativo interno de HOREB 360.
 */
export function mapThinqRunStateToMachineStatus(runState: ThinqRunState): MachineStatus {
  if (runState === 'ERROR') return 'fuera_de_servicio';
  if (runState === 'RUNNING' || runState === 'PAUSE') return 'en_uso';
  return 'disponible';
}

export function buildMockThinqPreviewFeed(
  machines: Machine[],
  orders: Order[],
  now = new Date().toISOString(),
): MachineTelemetrySnapshot[] {
  if (machines.length === 0) {
    return [
      {
        machineId: 'mock-lg-l1',
        code: 'L1 (Demo)',
        name: 'Lavadora LG ThinQ',
        kind: 'lavadora',
        provider: 'lg_thinq_connect',
        deviceProfile: 'Washer',
        runState: 'RUNNING',
        processPhase: 'SPINNING',
        remainingMinutes: 11,
        remoteStartEnabled: false,
        linkedFolio: 'Ejemplo',
        lastEventAt: now,
        isMockDemo: true,
      },
      {
        machineId: 'mock-lg-s1',
        code: 'S1 (Demo)',
        name: 'Secadora LG ThinQ',
        kind: 'secadora',
        provider: 'lg_thinq_connect',
        deviceProfile: 'Dryer',
        runState: 'END',
        processPhase: 'COMPLETE',
        remainingMinutes: 0,
        remoteStartEnabled: false,
        linkedFolio: null,
        lastEventAt: now,
        isMockDemo: true,
      },
    ];
  }

  return machines.map((machine, idx) => {
    const order = machine.currentOrderId
      ? orders.find((o) => o.id === machine.currentOrderId)
      : undefined;

    if (machine.status === 'fuera_de_servicio') {
      return {
        machineId: machine.id,
        code: machine.code,
        name: machine.name,
        kind: machine.kind,
        provider: 'lg_thinq_connect',
        deviceProfile: machine.kind === 'lavadora' ? 'Washer' : 'Dryer',
        runState: 'ERROR',
        processPhase: null,
        remainingMinutes: 0,
        remoteStartEnabled: false,
        linkedFolio: machine.currentOrderFolio ?? null,
        lastEventAt: now,
        isMockDemo: true,
      };
    }

    if (machine.status === 'en_uso') {
      const isWasher = machine.kind === 'lavadora';
      return {
        machineId: machine.id,
        code: machine.code,
        name: machine.name,
        kind: machine.kind,
        provider: 'lg_thinq_connect',
        deviceProfile: isWasher ? 'Washer' : 'Dryer',
        runState: 'RUNNING',
        processPhase: isWasher ? (idx % 2 === 0 ? 'WASHING' : 'SPINNING') : 'DRYING',
        remainingMinutes: isWasher ? 18 : 24,
        remoteStartEnabled: false,
        linkedFolio: order?.folio ?? machine.currentOrderFolio ?? null,
        lastEventAt: now,
        isMockDemo: true,
      };
    }

    return {
      machineId: machine.id,
      code: machine.code,
      name: machine.name,
      kind: machine.kind,
      provider: 'lg_thinq_connect',
      deviceProfile: machine.kind === 'lavadora' ? 'Washer' : 'Dryer',
      runState: 'STANDBY',
      processPhase: null,
      remainingMinutes: 0,
      remoteStartEnabled: false,
      linkedFolio: null,
      lastEventAt: now,
      isMockDemo: true,
    };
  });
}
