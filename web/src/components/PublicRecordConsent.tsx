"use client";
// D32 F3: recording a check on chain is opt-in. The warning comes before the button, and the button stays off until
// the box is ticked. Measured on 44005 (evidence/privacy-audit.md): the three records put threshold, count and range
// in clear, and with the public deposits they pinned the recipient's total to exactly 4 tUSD8.
export function PublicRecordConsent({ agreed, onChange }: { agreed: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="notice warn stack tight public-record">
      <p>
        Recording is public and permanent. It writes this proof&apos;s threshold, payment count and ledger range on chain, for
        anyone to read. Together with the public deposits that can reveal the holder&apos;s exact total, and which payer paid
        them. Checking on-chain sends nothing and leaves no record.
      </p>
      <label className="opt-in">
        <input type="checkbox" name="publish" checked={agreed} onChange={(e) => onChange(e.target.checked)} />
        <span>I understand. Let me publish this check.</span>
      </label>
    </div>
  );
}
