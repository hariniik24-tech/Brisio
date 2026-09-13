import type { ApiDonationAcknowledgment } from '@/constants/api';

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function formatMoney(value: number, currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(value || 0);
}

function detail(label: string, value: unknown) {
  return `<div class="detail"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value || 'Not provided')}</strong></div>`;
}

export function buildDonationAcknowledgmentHtml(receipt: ApiDonationAcknowledgment) {
  const receivedDate = receipt.receivedAt
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(receipt.receivedAt))
    : 'Not provided';

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(receipt.acknowledgmentId)}</title>
  <style>
    @page { margin: 44px; }
    * { box-sizing: border-box; }
    body { margin: 0; color: #1c2735; font-family: Georgia, 'Times New Roman', serif; font-size: 14px; line-height: 1.5; }
    header { border-bottom: 3px solid #315f57; padding-bottom: 18px; margin-bottom: 24px; }
    .brand { color: #315f57; font-family: Helvetica, Arial, sans-serif; font-size: 28px; font-weight: 700; }
    h1 { font-size: 22px; margin: 8px 0 0; }
    h2 { font-family: Helvetica, Arial, sans-serif; font-size: 13px; letter-spacing: 0; margin: 24px 0 10px; text-transform: uppercase; }
    .id { color: #52616e; font-family: Helvetica, Arial, sans-serif; margin-top: 4px; }
    .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .panel { border: 1px solid #cfd8d5; padding: 14px; }
    .detail { border-bottom: 1px solid #e7ecea; display: flex; gap: 18px; justify-content: space-between; padding: 8px 0; }
    .detail span { color: #52616e; }
    .detail strong { max-width: 65%; text-align: right; }
    .statement { background: #f2f7f5; border-left: 4px solid #315f57; padding: 14px 16px; }
    .notice { color: #52616e; font-size: 11px; margin-top: 24px; }
    footer { border-top: 1px solid #cfd8d5; color: #52616e; font-size: 11px; margin-top: 28px; padding-top: 12px; }
  </style>
</head>
<body>
  <header>
    <div class="brand">Brisio</div>
    <h1>Donation Acknowledgment</h1>
    <div class="id">${escapeHtml(receipt.acknowledgmentId)}</div>
  </header>

  <div class="grid">
    <section class="panel">
      <h2>Donor</h2>
      ${detail('Organization', receipt.donor.name)}
      ${detail('Location', receipt.donor.location)}
    </section>
    <section class="panel">
      <h2>Recipient</h2>
      ${detail('Organization', receipt.recipient.name)}
      ${detail('Location', receipt.recipient.location)}
    </section>
  </div>

  <h2>Confirmed Transfer</h2>
  ${detail('Received', receivedDate)}
  ${detail('Description', [receipt.item.brand, receipt.item.name].filter(Boolean).join(' '))}
  ${detail('Quantity received', `${receipt.item.quantity} ${receipt.item.unit}`)}
  ${detail('UPC / GTIN', receipt.item.upc || receipt.item.gtin)}
  ${detail('Condition', receipt.item.conditionNotes)}
  ${detail('Donor-reported value', formatMoney(receipt.donorReportedValue.totalValue, receipt.donorReportedValue.currency))}
  ${receipt.receiptNote ? detail('Receipt note', receipt.receiptNote) : ''}

  <h2>Recipient Acknowledgment</h2>
  <div class="statement">
    The recipient confirms receipt of the property described above.${receipt.certification.noGoodsOrServicesProvided ? ' No goods or services were provided in exchange for this contribution.' : ''}${receipt.certification.foodUseCertified ? ' The recipient certified that the donated food will be used only for the care of the ill, needy, or infants, in a manner related to its exempt purpose, and will not be transferred for money, property, or services.' : ''}
  </div>

  <p class="notice">
    The value shown is donor-reported and is not a valuation by Brisio or the recipient. This acknowledgment documents the transfer and does not determine tax eligibility or the deductible amount. The donor should retain supporting inventory records and consult a qualified tax professional. Additional IRS forms or substantiation may be required.
  </p>

  <footer>
    Donation record ${escapeHtml(receipt.donationId)} · Recipient-confirmed through a one-time Brisio QR handoff
  </footer>
</body>
</html>`;
}