import { useState } from 'react';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Upload } from 'lucide-react';
import { formatMxn } from '../domain/money';
import {
  getPendingTransfersForBranch,
  matchBankTransfersCsv,
  type CsvMatchResult,
} from '../domain/reconciliation';
import { getBranchInfo } from '../domain/rules';
import type { BranchId, DemoState } from '../domain/types';

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
  const [busy, setBusy] = useState(false);
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

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    processCsvContent(text);
    event.target.value = '';
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
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setFeedback(null);
                    const res = await onConfirmPaymentLine(line.id, refDrafts[line.id]?.trim() || undefined);
                    setBusy(false);
                    if (!res.ok) {
                      setFeedback({ type: 'error', text: res.error ?? 'No se pudo confirmar la transferencia.' });
                    } else {
                      setFeedback({ type: 'success', text: `Transferencia de ${order.folio} marcada como verificada.` });
                      setCsvMatches(null);
                    }
                  }}
                >
                  Marcar transferencia verificada
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
          <label className="btn btn-secondary btn-sm" style={{ cursor: 'pointer' }}>
            <Upload size={15} />
            Seleccionar CSV
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void handleFileChange(e)}
              style={{ display: 'none' }}
            />
          </label>
          {import.meta.env.DEV && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={loadDevSampleCsv}>
              Probar con CSV ficticio (desarrollo)
            </button>
          )}
        </div>

        {csvMatches && (
          <div style={{ marginTop: 10, display: 'grid', gap: 8 }}>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Fila</th>
                    <th>Ref. CSV</th>
                    <th className="num">Importe</th>
                    <th>Resultado</th>
                  </tr>
                </thead>
                <tbody>
                  {csvMatches.map((row) => (
                    <tr key={`${row.rowNumber}-${row.referencia}`}>
                      <td>#{row.rowNumber}</td>
                      <td>
                        <strong>{row.referencia}</strong>
                        {row.concepto && <div className="muted" style={{ fontSize: '0.78rem' }}>{row.concepto}</div>}
                      </td>
                      <td className="num">{formatMxn(row.amountCents)}</td>
                      <td>
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
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setFeedback(null);
                  const res = await onConfirmTransferBatch(
                    branchId,
                    exactMatches.map((m) => ({ lineId: m.matchedLineId, reference: m.referencia })),
                  );
                  setBusy(false);
                  if (!res.ok) {
                    setFeedback({ type: 'error', text: res.error ?? 'No se pudieron confirmar las coincidencias.' });
                  } else {
                    setFeedback({
                      type: 'success',
                      text: `${exactMatches.length} transferencia(s) verificada(s) desde el CSV.`,
                    });
                    setCsvMatches(null);
                  }
                }}
              >
                Confirmar {exactMatches.length} coincidencia(s) exacta(s)
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
