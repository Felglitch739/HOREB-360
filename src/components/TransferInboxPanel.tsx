import { useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { formatMxn } from '../domain/money';
import {
  getPendingTransfersForBranch,
  matchBankTransfersCsv,
  type CsvMatchResult,
} from '../domain/reconciliation';
import { getBranchInfo } from '../domain/rules';
import type { BranchId, DemoState } from '../domain/types';
import { usePendingAction } from './usePendingAction';

interface TransferInboxPanelProps {
  state: DemoState;
  branchId: BranchId;
  onConfirmPaymentLine: (lineId: string, reference?: string) => Promise<{ ok: boolean; error?: string }>;
  onConfirmTransferBatch: (
    branchId: BranchId,
    items: Array<{ lineId: string; reference?: string }>,
  ) => Promise<{ ok: boolean; error?: string }>;
}

export function TransferInboxPanel({
  state,
  branchId,
  onConfirmPaymentLine,
  onConfirmTransferBatch,
}: TransferInboxPanelProps) {
  const branch = getBranchInfo(branchId);
  const pendingTransfers = getPendingTransfersForBranch(state, branchId);
  const [refDrafts, setRefDrafts] = useState<Record<string, string>>({});
  const [csvMatches, setCsvMatches] = useState<CsvMatchResult[] | null>(null);
  const { pending, run } = usePendingAction();
  const fileInput = useRef<HTMLInputElement>(null);
  const [feedback, setFeedback] = useState<{ type: 'error' | 'success'; text: string } | null>(null);

  function processCsvContent(text: string) {
    setFeedback(null);
    const parsed = matchBankTransfersCsv(state, branchId, text);
    if (!parsed.ok) {
      setCsvMatches(null);
      setFeedback({ type: 'error', text: parsed.error });
      return;
    }
    setCsvMatches(parsed.rows);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void run('file', async () => {
      setFeedback(null);
      setCsvMatches(null);
      processCsvContent(await file.text());
    }, () => setFeedback({ type: 'error', text: 'No se pudo leer el archivo. Vuelve a seleccionar el CSV.' }));
  }

  function verifyTransfers(
    action: string,
    save: () => Promise<{ ok: boolean; error?: string }>,
    success: string,
  ) {
    return run(action, async () => {
      setFeedback(null);
      const result = await save();
      if (result.ok) {
        setFeedback({ type: 'success', text: success });
        setCsvMatches(null);
      } else {
        setFeedback({ type: 'error', text: result.error ?? 'No se pudieron comprobar las transferencias.' });
      }
    }, () => setFeedback({
      type: 'error',
      text: 'No se pudo verificar el resultado. Revisa las transferencias pendientes antes de confirmar de nuevo.',
    }));
  }

  function loadDevSampleCsv() {
    const first = pendingTransfers[0];
    const second = pendingTransfers[1];
    const sampleRows = ['fecha,referencia,importe,concepto'];
    if (first) {
      sampleRows.push(
        `${new Date().toISOString().slice(0, 10)},NU-9001,${(first.line.amountCents / 100).toFixed(2)},Pago ${first.order.folio}`,
      );
      if (second) {
        sampleRows.push(
          `${new Date().toISOString().slice(0, 10)},NU-AMBIG,${(second.line.amountCents / 100).toFixed(2)},Transferencia sin folio`,
        );
      }
      sampleRows.push(
        `${new Date().toISOString().slice(0, 10)},NU-SINMATCH,125.00,Abono externo no identificado`,
      );
    } else {
      sampleRows.push(`${new Date().toISOString().slice(0, 10)},NU-TEST-1,40.00,Folio LOM-0001`);
    }
    processCsvContent(sampleRows.join('\n'));
  }

  const exactMatches = (csvMatches ?? []).filter(
    (row): row is CsvMatchResult & { matchedLineId: string } =>
      row.status === 'exact' && Boolean(row.matchedLineId),
  );
  const ambiguousMatches = (csvMatches ?? []).filter((row) => row.status === 'ambiguous');

  return (
    <section className="card">
      <h2 className="card-title">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <FileSpreadsheet size={18} aria-hidden="true" />
          Bandeja de transferencias pendientes · {branch.name}
        </span>
        <span className={`badge ${pendingTransfers.length > 0 ? 'badge-warning' : 'badge-success'}`}>
          {pendingTransfers.length} pendiente(s)
        </span>
      </h2>

      {feedback && (
        <div className={`alert alert-${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
          {feedback.text}
        </div>
      )}

      {pendingTransfers.length === 0 ? (
        <p className="muted" style={{ marginTop: 0 }}>
          No hay transferencias pendientes por verificar en {branch.name}.
        </p>
      ) : (
        <div style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
          {pendingTransfers.map(({ line, order }) => (
            <div key={line.id} className="payment-chip">
              <div className="payment-chip-main">
                <div>
                  <strong>{order.folio}</strong> · {order.customerAlias}{' '}
                  <span className="muted">
                    ({new Date(line.createdAt).toLocaleString('es-MX', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })})
                  </span>
                </div>
                <strong>{formatMxn(line.amountCents)}</strong>
              </div>
              <div className="payment-confirm-inline">
                <input
                  className="input input-sm"
                  placeholder="Referencia Nu (opcional)"
                  aria-label={`Referencia transferencia ${order.folio}`}
                  value={refDrafts[line.id] ?? ''}
                  onChange={(e) => setRefDrafts((prev) => ({ ...prev, [line.id]: e.target.value }))}
                  maxLength={60}
                />
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={pending !== null}
                  onClick={() => void verifyTransfers(
                    `line-${line.id}`,
                    () => onConfirmPaymentLine(line.id, refDrafts[line.id]?.trim() || undefined),
                    `Transferencia de ${order.folio} marcada como verificada.`,
                  )}
                >
                  {pending === `line-${line.id}` ? 'Verificando…' : 'Marcar transferencia verificada'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="csv-import-box">
        <div className="catalog-head-row">
          <strong>Importar archivo CSV de movimientos (Nu)</strong>
          <small className="muted">Columnas: fecha, referencia, importe, concepto</small>
        </div>
        <div className="order-actions">
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            disabled={pending !== null}
            onClick={() => fileInput.current?.click()}
          >
            <Upload size={15} />
            {pending === 'file' ? 'Leyendo CSV…' : 'Seleccionar CSV'}
          </button>
          <input ref={fileInput} type="file" accept=".csv,text/csv" onChange={handleFileChange} hidden />
          {import.meta.env.DEV && (
            <button type="button" className="btn btn-secondary btn-sm" disabled={pending !== null} onClick={loadDevSampleCsv}>
              Probar con CSV ficticio (desarrollo)
            </button>
          )}
        </div>

        {csvMatches && (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div className="table-wrap stacked-table">
              <table role="table">
                <thead role="rowgroup">
                  <tr role="row">
                    <th role="columnheader">Fila</th>
                    <th role="columnheader">Ref. CSV</th>
                    <th role="columnheader" className="num">Importe</th>
                    <th role="columnheader">Resultado</th>
                  </tr>
                </thead>
                <tbody role="rowgroup">
                  {csvMatches.map((row) => (
                    <tr role="row" key={`${row.rowNumber}-${row.referencia}`}>
                      <td role="cell" data-row-heading>#{row.rowNumber}</td>
                      <td role="cell" data-label="Referencia CSV">
                        <strong>{row.referencia}</strong>
                        {row.concepto && <div className="muted" style={{ fontSize: '0.78rem' }}>{row.concepto}</div>}
                      </td>
                      <td role="cell" data-label="Importe" className="num">{formatMxn(row.amountCents)}</td>
                      <td role="cell" data-label="Resultado">
                        {row.status === 'exact' ? (
                          <span className="badge badge-success">
                            <CheckCircle2 size={12} /> Exacta: {row.matchedFolio}
                          </span>
                        ) : row.status === 'ambiguous' ? (
                          <div>
                            <span className="badge badge-warning">
                              <AlertTriangle size={12} /> Ambigua · Revisión manual
                            </span>
                            <div className="muted" style={{ fontSize: '0.76rem', marginTop: 2 }}>
                              {row.reason} ({row.candidateFolios.join(', ')})
                            </div>
                          </div>
                        ) : (
                          <span className="badge badge-danger">{row.reason}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {ambiguousMatches.length > 0 && (
              <div className="alert alert-info" style={{ marginBottom: 0 }}>
                Las coincidencias ambiguas no se confirman en automático; verifícalas manualmente en la lista superior.
              </div>
            )}

            {exactMatches.length > 0 && (
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending !== null}
                onClick={() => void verifyTransfers(
                  'batch',
                  () => onConfirmTransferBatch(
                    branchId,
                    exactMatches.map((m) => ({ lineId: m.matchedLineId, reference: m.referencia })),
                  ),
                  `${exactMatches.length} transferencia(s) verificada(s) desde el CSV.`,
                )}
              >
                {pending === 'batch' ? 'Confirmando coincidencias…' : `Confirmar ${exactMatches.length} coincidencia(s) exacta(s)`}
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
