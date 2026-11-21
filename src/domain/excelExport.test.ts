import { describe, expect, it } from 'vitest';
import {
  buildCustomersSheet,
  buildOrdersSheet,
  buildShiftsSheets,
  buildXlsxBytes,
} from './excelExport';
import { createExampleState } from './examples';

describe('excelExport (.xlsx OOXML generator)', () => {
  it('builds a valid PKZip archive with OOXML workbook, styles, and sheets', () => {
    const bytes = buildXlsxBytes([
      {
        name: 'Órdenes / Hoy',
        headers: ['Folio', 'Teléfono', 'Total MXN', 'Cantidad'],
        rows: [
          [
            { value: 'LOM-0001', format: 'text' },
            { value: '8681234567', format: 'text' },
            { value: 145.5, format: 'currency' },
            { value: 2, format: 'integer' },
          ],
          ['A&B <Lavado>', '0012345678', 70, 1],
        ],
      },
      {
        name: 'Resumen',
        headers: ['Concepto', 'Valor'],
        rows: [['Total', { value: 215.5, format: 'currency' }]],
      },
    ]);

    // Check PKZip local file header magic bytes (PK\x03\x04)
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);
    expect(bytes[2]).toBe(0x03);
    expect(bytes[3]).toBe(0x04);

    // Check End of Central Directory signature near the tail (PK\x05\x06)
    const eocdOffset = bytes.length - 22;
    expect(bytes[eocdOffset]).toBe(0x50);
    expect(bytes[eocdOffset + 1]).toBe(0x4b);
    expect(bytes[eocdOffset + 2]).toBe(0x05);
    expect(bytes[eocdOffset + 3]).toBe(0x06);

    // Decode raw uncompressed text (ZIP method 0) to verify XML structure and escaping
    const text = new TextDecoder().decode(bytes);
    expect(text).toContain('[Content_Types].xml');
    expect(text).toContain('xl/workbook.xml');
    expect(text).toContain('xl/styles.xml');
    expect(text).toContain('xl/worksheets/sheet1.xml');
    expect(text).toContain('xl/worksheets/sheet2.xml');
    // Sheet name invalid chars stripped ('/' removed)
    expect(text).toContain('name="Órdenes  Hoy"');
    // Phone number stored as inlineStr (not numeric scientific notation)
    expect(text).toContain('t="inlineStr" s="0"><is><t xml:space="preserve">8681234567</t></is>');
    // XML escaping applied
    expect(text).toContain('A&amp;B &lt;Lavado&gt;');
    // Currency cell formatted with style 2
    expect(text).toContain('s="2"><v>145.5</v>');
  });

  it('builds domain sheets for orders, shifts, and customers from DemoState', () => {
    const state = createExampleState();
    const ordersSheet = buildOrdersSheet(state, state.orders);
    expect(ordersSheet.name).toBe('Órdenes');
    expect(ordersSheet.headers).toContain('Folio');
    expect(ordersSheet.rows.length).toBe(state.orders.length);

    const shiftSheets = buildShiftsSheets(state, state.shifts);
    expect(shiftSheets.map((s) => s.name)).toEqual(['Turnos', 'Movimientos caja']);
    expect(shiftSheets[0].rows.length).toBe(state.shifts.length);

    const customersSheet = buildCustomersSheet(state, state.customers ?? []);
    expect(customersSheet.name).toBe('Clientes');
    expect(customersSheet.headers).toContain('Teléfono');
  });
});
