import React, { useEffect, useMemo, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api from '../utils/api';
import { useT } from '../i18n';
import Icon from './Icon';
import { Button, IconButton, Spinner, EmptyState } from './ui';

/**
 * Taking money off a customer's balance.
 *
 * The shopkeeper types one number. Which bills it lands on is the system's
 * problem, not theirs — so this shows, before they commit, exactly which
 * invoices the amount will settle and what will be left. Oldest first, which
 * is what both sides of the counter assume.
 *
 * The preview is computed here purely for display; the server does its own
 * allocation inside a transaction and is the authority. They use the same rule,
 * and the server's answer is what gets shown afterwards.
 */
export default function CollectDueModal({ customer, onClose, onDone }) {
  const { t, money, dateOnly, errorMessage } = useT();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState(null);
  const [amount, setAmount] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get(`/customers/${customer.id}/due`);
      setData(res.data.data);
    } catch (err) {
      toast.error(errorMessage(err));
      onClose();
    } finally {
      setLoading(false);
    }
  }, [customer.id, errorMessage, onClose]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !saving) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  const outstanding = data ? Number(data.outstanding) : 0;
  const entered = Number.parseFloat(amount);
  const valid = Number.isFinite(entered) && entered > 0 && entered <= outstanding + 0.005;
  const tooMuch = Number.isFinite(entered) && entered > outstanding + 0.005;

  /** Mirror of the server's oldest-first allocation, for the preview only. */
  const preview = useMemo(() => {
    if (!data || !Number.isFinite(entered) || entered <= 0) return [];
    let left = entered;
    const out = [];
    for (const inv of data.invoices) {
      if (left <= 0.005) break;
      const due = Number(inv.due);
      const applied = Math.min(left, due);
      out.push({ ...inv, applied, settled: applied >= due - 0.005 });
      left = Math.round((left - applied) * 100) / 100;
    }
    return out;
  }, [data, entered]);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    try {
      const res = await api.post(`/customers/${customer.id}/collect-due`, { amount: entered });
      toast.success(t('due.collected', { amount: money(res.data.data.collected), name: customer.name }));
      onDone(res.data.data);
    } catch (err) {
      toast.error(errorMessage(err));
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">{t('due.title', { name: customer.name })}</span>
          <IconButton icon={<Icon name="close" />} label={t('common.close')}
                      variant="ghost" onClick={onClose} disabled={saving} />
        </div>

        {loading ? (
          <div className="modal-body"><Spinner label={t('common.loading')} /></div>
        ) : outstanding <= 0 ? (
          <div className="modal-body">
            <EmptyState icon={<Icon name="check" size={30} />} title={t('status.cleared')}
                        message={t('due.noInvoices')} />
          </div>
        ) : (
          <form onSubmit={submit}>
            <div className="modal-body">
              <div className="due-summary">
                <span className="due-summary-label">{t('due.outstanding')}</span>
                <span className="due-summary-value">{money(outstanding)}</span>
              </div>

              <label className="field-label" htmlFor="due-amount">{t('due.amountToTake')}</label>
              <div className="due-input-row">
                <input
                  id="due-amount"
                  className="form-control"
                  type="number" inputMode="decimal" step="0.01" min="0" max={outstanding}
                  value={amount}
                  autoFocus
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.00"
                />
                <Button type="button" variant="secondary"
                        onClick={() => setAmount(String(outstanding))}>
                  {t('due.payAll')}
                </Button>
              </div>
              {tooMuch && <div className="due-warn">{t('due.tooMuch', { name: customer.name })}</div>}

              <div className="due-hint">{t('due.oldestFirst')}</div>

              {preview.length > 0 && (
                <div className="due-preview">
                  <div className="due-preview-title">{t('due.willSettle')}</div>
                  {preview.map((inv) => (
                    <div className="due-preview-row" key={inv.id}>
                      <span className="cell-code">{inv.invoiceNo}</span>
                      <span className="cell-sub">{dateOnly(inv.createdAt)}</span>
                      <span className={inv.settled ? 'due-settled' : 'due-partial'}>
                        {money(inv.applied)}{inv.settled ? '' : ` · ${t('status.partial')}`}
                      </span>
                    </div>
                  ))}
                  <div className="due-remaining">
                    {t('due.remainingAfter', {
                      amount: money(Math.max(0, Math.round((outstanding - entered) * 100) / 100)),
                    })}
                  </div>
                </div>
              )}

              {/* Every unpaid bill, so the number above can be checked. */}
              <div className="due-list">
                {data.invoices.map((inv) => (
                  <div className="due-list-row" key={inv.id}>
                    <span className="cell-code">{inv.invoiceNo}</span>
                    <span className="cell-sub">{dateOnly(inv.createdAt)}</span>
                    <span className="cell-price">{money(inv.due)}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="modal-footer">
              <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" loading={saving} disabled={!valid}>
                {valid ? `${t('due.takePayment')} — ${money(entered)}` : t('due.takePayment')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
